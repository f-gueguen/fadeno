export type FeedbackEvidenceSummary = Readonly<{
  schema: "fadeno.private.feedback-summary";
  version: 1;
  resultId: string;
  sourceCommit: string;
  conclusion: "baseline-only-no-budget";
  warmupsPerWorkload: number;
  samplesPerWorkload: number;
  workloads: readonly Readonly<{
    id: string;
    endToEnd: FeedbackTimingSummary;
    phases: Readonly<Record<string, FeedbackTimingSummary>>;
  }>[];
}>;

type FeedbackTimingSummary = Readonly<{
  completed: number;
  skipped: number;
  skipReasons: readonly string[];
  minimumNs: string | null;
  medianNs: string | null;
  p95Ns: string | null;
}>;

function record(value: unknown, code: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(code);
  return value as Record<string, any>;
}

function summarize(values: readonly bigint[], skipped: number, skipReasons: readonly string[]): FeedbackTimingSummary {
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const nearestRank = (quantile: number): bigint | null => sorted.length === 0
    ? null
    : sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
  return Object.freeze({
    completed: sorted.length,
    skipped,
    skipReasons: Object.freeze([...new Set(skipReasons)].sort()),
    minimumNs: sorted[0]?.toString() ?? null,
    medianNs: nearestRank(0.5)?.toString() ?? null,
    p95Ns: nearestRank(0.95)?.toString() ?? null,
  });
}

export function deriveFeedbackEvidenceSummary(
  rawValue: unknown,
  resultId: string,
  workloadOrder: readonly string[],
  phaseOrder: readonly string[],
): FeedbackEvidenceSummary {
  const raw = record(rawValue, "FADENO_FEEDBACK_EVIDENCE_RAW");
  if (!Array.isArray(raw["attempts"])) throw new TypeError("FADENO_FEEDBACK_EVIDENCE_ATTEMPTS");
  const samples = raw["attempts"].map((attempt: unknown) => record(attempt, "FADENO_FEEDBACK_EVIDENCE_ATTEMPT"))
    .filter((attempt: Record<string, any>) => attempt["stage"] === "sample");
  const workloads = workloadOrder.map((id) => {
    const attempts = samples.filter((attempt: Record<string, any>) => attempt["workloadId"] === id);
    const endToEnd = summarize(attempts.map((attempt: Record<string, any>) => BigInt(attempt["elapsedNs"])), 0, []);
    const phases = Object.fromEntries(phaseOrder.map((phase) => {
      const completed: bigint[] = [];
      const reasons: string[] = [];
      let skipped = 0;
      for (const attempt of attempts) {
        const detail = record(record(attempt["phaseTiming"], "FADENO_FEEDBACK_EVIDENCE_PHASES")[phase], "FADENO_FEEDBACK_EVIDENCE_PHASE");
        if (detail["status"] === "completed") completed.push(BigInt(detail["elapsedNs"]));
        else {
          skipped += 1;
          if (typeof detail["reason"] === "string") reasons.push(detail["reason"]);
        }
      }
      return [phase, summarize(completed, skipped, reasons)];
    }));
    return Object.freeze({ id, endToEnd, phases: Object.freeze(phases) });
  });
  return Object.freeze({
    schema: "fadeno.private.feedback-summary",
    version: 1,
    resultId,
    sourceCommit: String(record(raw["identity"], "FADENO_FEEDBACK_EVIDENCE_IDENTITY")["sourceCommit"]),
    conclusion: "baseline-only-no-budget",
    warmupsPerWorkload: 2,
    samplesPerWorkload: 5,
    workloads: Object.freeze(workloads),
  });
}
