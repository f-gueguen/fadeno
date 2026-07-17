import { createHash } from "node:crypto";

export type FeedbackContract = Readonly<{
  schema: "fadeno.private.feedback-contract";
  version: 1;
  clock: Readonly<{
    kind: "monotonic";
    source: "process.hrtime.bigint";
    unit: "ns";
    start: "after-save-before-notification";
    end: "matching-final-accepted-consumer-event";
  }>;
  schedule: Readonly<{
    warmups: number;
    repetitions: number;
    order: readonly ("diagnostic-replacement" | "cleared-replacement")[];
    retryPolicy: "none";
    selectionPolicy: "all-attempts-in-declared-order";
  }>;
  identity: readonly string[];
  workloads: readonly Readonly<{
    id: "diagnostic-replacement" | "cleared-replacement";
    acceptedEvent: "diagnostic-replacement" | "success-replacement";
    diagnosticCodes: readonly string[];
  }>[];
  phases: readonly string[];
  deepTiming: Readonly<{
    default: false;
    flag: "--deep-timing";
    maximumRecordsPerAttempt: number;
    profiles: "explicit-only";
  }>;
  validity: readonly string[];
}>;

export type VerifiedFeedbackRun = Readonly<{
  mode: "dry-run" | "measurement";
  attempts: number;
  deepTiming: boolean;
}>;

const sha256Pattern = /^[0-9a-f]{64}$/u;
const decimalPattern = /^(0|[1-9][0-9]*)$/u;
const exactIdentity = Object.freeze([
  "source-commit",
  "source-tree",
  "tarball-bytes",
  "installed-package-tree",
  "runtime-version",
  "runtime-executable",
  "compiler-version",
  "compiler-package",
  "platform",
  "architecture",
  "environment",
]);
const exactPhases = Object.freeze([
  "invalidation",
  "fadeno-analysis-and-generation",
  "typescript-refresh",
  "accepted-consumer-replacement",
]);
const exactValidity = Object.freeze([
  "exact-identities",
  "stale-output-canary",
  "expected-final-event",
  "complete-replacement",
  "monotonic-endpoints",
  "zero-private-ownership",
]);
const ownershipKeys = Object.freeze([
  "activeOperations",
  "compilerValidations",
  "coordinatorActiveOperations",
  "coordinatorDrainWorkers",
  "coordinatorPendingAnalysisOperations",
  "coordinatorQueuedOperations",
  "currentAnalysisTokens",
  "latestAnalysisRequests",
  "observers",
  "pendingApplicationRecoveries",
  "pendingBytes",
  "pendingCleanups",
  "pendingHints",
  "pendingNotifications",
  "pendingRollbacks",
  "retainedCycles",
  "timers",
  "waiters",
]);

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(code);
}

function strings(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new TypeError(code);
  return value;
}

function same(actual: unknown, expected: unknown, code: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(code);
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(code);
  return value as number;
}

function decimal(value: unknown, code: string): bigint {
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new TypeError(code);
  return BigInt(value);
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyFeedbackContract(value: unknown): FeedbackContract {
  const contract = record(value, "FADENO_FEEDBACK_CONTRACT_OBJECT");
  exactKeys(contract, ["schema", "version", "clock", "schedule", "identity", "workloads", "phases", "deepTiming", "validity"], "FADENO_FEEDBACK_CONTRACT_KEYS");
  if (contract["schema"] !== "fadeno.private.feedback-contract" || contract["version"] !== 1) {
    throw new TypeError("FADENO_FEEDBACK_CONTRACT_VERSION");
  }
  const clock = record(contract["clock"], "FADENO_FEEDBACK_CONTRACT_CLOCK");
  same(clock, {
    kind: "monotonic",
    source: "process.hrtime.bigint",
    unit: "ns",
    start: "after-save-before-notification",
    end: "matching-final-accepted-consumer-event",
  }, "FADENO_FEEDBACK_CONTRACT_CLOCK");
  const schedule = record(contract["schedule"], "FADENO_FEEDBACK_CONTRACT_SCHEDULE");
  exactKeys(schedule, ["warmups", "repetitions", "order", "retryPolicy", "selectionPolicy"], "FADENO_FEEDBACK_CONTRACT_SCHEDULE");
  positiveInteger(schedule["warmups"], "FADENO_FEEDBACK_CONTRACT_WARMUPS");
  positiveInteger(schedule["repetitions"], "FADENO_FEEDBACK_CONTRACT_REPETITIONS");
  same(schedule["order"], ["diagnostic-replacement", "cleared-replacement"], "FADENO_FEEDBACK_CONTRACT_ORDER");
  if (schedule["retryPolicy"] !== "none" || schedule["selectionPolicy"] !== "all-attempts-in-declared-order") {
    throw new TypeError("FADENO_FEEDBACK_CONTRACT_SELECTION");
  }
  same(contract["identity"], exactIdentity, "FADENO_FEEDBACK_CONTRACT_IDENTITY");
  same(contract["phases"], exactPhases, "FADENO_FEEDBACK_CONTRACT_PHASES");
  same(contract["validity"], exactValidity, "FADENO_FEEDBACK_CONTRACT_VALIDITY");
  const deep = record(contract["deepTiming"], "FADENO_FEEDBACK_CONTRACT_DEEP");
  exactKeys(deep, ["default", "flag", "maximumRecordsPerAttempt", "profiles"], "FADENO_FEEDBACK_CONTRACT_DEEP");
  if (deep["default"] !== false || deep["flag"] !== "--deep-timing" || deep["profiles"] !== "explicit-only") {
    throw new TypeError("FADENO_FEEDBACK_CONTRACT_DEEP");
  }
  positiveInteger(deep["maximumRecordsPerAttempt"], "FADENO_FEEDBACK_CONTRACT_DEEP");
  if (!Array.isArray(contract["workloads"]) || contract["workloads"].length !== 2) {
    throw new TypeError("FADENO_FEEDBACK_CONTRACT_WORKLOADS");
  }
  const workloads = contract["workloads"].map((entry) => record(entry, "FADENO_FEEDBACK_CONTRACT_WORKLOAD"));
  same(workloads.map(({ id, acceptedEvent, diagnosticCodes }) => ({ id, acceptedEvent, diagnosticCodes })), [
    {
      id: "diagnostic-replacement",
      acceptedEvent: "diagnostic-replacement",
      diagnosticCodes: [
        "FADENO_ROUTE_ROUTE_ROLE_OWNER",
        "FADENO_ROUTE_ROUTE_ROLE_OWNER",
        "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
      ],
    },
    { id: "cleared-replacement", acceptedEvent: "success-replacement", diagnosticCodes: [] },
  ], "FADENO_FEEDBACK_CONTRACT_WORKLOADS");
  return contract as FeedbackContract;
}

export function verifyFeedbackRun(
  value: unknown,
  contract: FeedbackContract,
  expectedContractSha256: string,
  expectedIdentity: unknown,
): VerifiedFeedbackRun {
  const run = record(value, "FADENO_FEEDBACK_RUN_OBJECT");
  exactKeys(run, ["schema", "version", "contractSha256", "mode", "deepTiming", "identity", "clock", "attempts", "complete", "selection"], "FADENO_FEEDBACK_RUN_KEYS");
  if (run["schema"] !== "fadeno.private.feedback-run" || run["version"] !== 1) throw new TypeError("FADENO_FEEDBACK_RUN_VERSION");
  if (run["contractSha256"] !== expectedContractSha256 || !sha256Pattern.test(expectedContractSha256)) {
    throw new TypeError("FADENO_FEEDBACK_RUN_CONTRACT_IDENTITY");
  }
  if (run["mode"] !== "dry-run" && run["mode"] !== "measurement") throw new TypeError("FADENO_FEEDBACK_RUN_MODE");
  if (typeof run["deepTiming"] !== "boolean") throw new TypeError("FADENO_FEEDBACK_RUN_DEEP");
  if (run["complete"] !== true || run["selection"] !== "all-attempts-no-retry") throw new TypeError("FADENO_FEEDBACK_RUN_COMPLETENESS");

  const identity = record(run["identity"], "FADENO_FEEDBACK_RUN_IDENTITY");
  exactKeys(identity, ["sourceCommit", "sourceTreeSha256", "tarballSha256", "installedPackageTreeSha256", "runtimeVersion", "runtimeExecutableSha256", "compilerVersion", "compilerPackageSha256", "platform", "architecture", "environmentSha256"], "FADENO_FEEDBACK_RUN_IDENTITY");
  if (typeof identity["sourceCommit"] !== "string" || !/^[0-9a-f]{40}$/u.test(identity["sourceCommit"])) throw new TypeError("FADENO_FEEDBACK_RUN_SOURCE");
  for (const key of ["sourceTreeSha256", "tarballSha256", "installedPackageTreeSha256", "runtimeExecutableSha256", "compilerPackageSha256", "environmentSha256"] as const) {
    if (typeof identity[key] !== "string" || !sha256Pattern.test(identity[key] as string)) throw new TypeError("FADENO_FEEDBACK_RUN_IDENTITY_DIGEST");
  }
  for (const key of ["runtimeVersion", "compilerVersion", "platform", "architecture"] as const) {
    if (typeof identity[key] !== "string" || identity[key].length === 0) throw new TypeError("FADENO_FEEDBACK_RUN_IDENTITY_VALUE");
  }
  same(identity, expectedIdentity, "FADENO_FEEDBACK_RUN_IDENTITY_MISMATCH");
  same(run["clock"], contract.clock, "FADENO_FEEDBACK_RUN_CLOCK");

  if (!Array.isArray(run["attempts"])) throw new TypeError("FADENO_FEEDBACK_RUN_ATTEMPTS");
  const rounds = contract.schedule.warmups + contract.schedule.repetitions;
  if (run["attempts"].length !== rounds * contract.schedule.order.length) throw new TypeError("FADENO_FEEDBACK_RUN_ATTEMPT_COUNT");
  const byId = new Map(contract.workloads.map((workload) => [workload.id, workload]));
  for (let index = 0; index < run["attempts"].length; index += 1) {
    const attempt = record(run["attempts"][index], "FADENO_FEEDBACK_ATTEMPT_OBJECT");
    exactKeys(attempt, ["attemptId", "stage", "repetition", "workloadId", "startNs", "acceptedNs", "elapsedNs", "acceptedEvent", "validity", "cleanup", "phaseTiming"], "FADENO_FEEDBACK_ATTEMPT_KEYS");
    const workloadId = contract.schedule.order[index % contract.schedule.order.length]!;
    const round = Math.floor(index / contract.schedule.order.length);
    const stage = round < contract.schedule.warmups ? "warmup" : "sample";
    const repetition = stage === "warmup" ? round + 1 : round - contract.schedule.warmups + 1;
    if (attempt["attemptId"] !== `${stage}-${repetition}-${workloadId}` || attempt["stage"] !== stage || attempt["repetition"] !== repetition || attempt["workloadId"] !== workloadId) {
      throw new TypeError("FADENO_FEEDBACK_ATTEMPT_ORDER");
    }
    const start = decimal(attempt["startNs"], "FADENO_FEEDBACK_ATTEMPT_CLOCK");
    const accepted = decimal(attempt["acceptedNs"], "FADENO_FEEDBACK_ATTEMPT_CLOCK");
    const elapsed = decimal(attempt["elapsedNs"], "FADENO_FEEDBACK_ATTEMPT_CLOCK");
    if (accepted < start || accepted - start !== elapsed) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_CLOCK");
    const event = record(attempt["acceptedEvent"], "FADENO_FEEDBACK_ATTEMPT_EVENT");
    exactKeys(event, ["kind", "operationId", "workspaceEpoch", "configurationEpoch", "diagnosticCodes", "publicationSha256", "diskSha256"], "FADENO_FEEDBACK_ATTEMPT_EVENT");
    const workload = byId.get(workloadId)!;
    if (event["kind"] !== workload.acceptedEvent || typeof event["operationId"] !== "string" || event["operationId"].length === 0) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_EVENT");
    positiveInteger(event["workspaceEpoch"], "FADENO_FEEDBACK_ATTEMPT_EVENT");
    positiveInteger(event["configurationEpoch"], "FADENO_FEEDBACK_ATTEMPT_EVENT");
    same(strings(event["diagnosticCodes"], "FADENO_FEEDBACK_ATTEMPT_DIAGNOSTICS"), workload.diagnosticCodes, "FADENO_FEEDBACK_ATTEMPT_DIAGNOSTICS");
    for (const key of ["publicationSha256", "diskSha256"] as const) if (typeof event[key] !== "string" || !sha256Pattern.test(event[key] as string)) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_EVENT_DIGEST");
    const validity = record(attempt["validity"], "FADENO_FEEDBACK_ATTEMPT_VALIDITY");
    same(Object.keys(validity).sort(), [...exactValidity].sort(), "FADENO_FEEDBACK_ATTEMPT_VALIDITY");
    if (Object.values(validity).some((entry) => entry !== true)) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_INVALID");
    const cleanup = record(attempt["cleanup"], "FADENO_FEEDBACK_ATTEMPT_CLEANUP");
    same(Object.keys(cleanup).sort(), [...ownershipKeys].sort(), "FADENO_FEEDBACK_ATTEMPT_CLEANUP");
    if (Object.values(cleanup).some((entry) => entry !== 0)) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_CLEANUP");
    if (run["deepTiming"] === false) {
      if (attempt["phaseTiming"] !== null) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_DEEP_DISABLED");
    } else {
      const phases = record(attempt["phaseTiming"], "FADENO_FEEDBACK_ATTEMPT_PHASES");
      same(Object.keys(phases), contract.phases, "FADENO_FEEDBACK_ATTEMPT_PHASES");
      if (Object.keys(phases).length > contract.deepTiming.maximumRecordsPerAttempt) throw new TypeError("FADENO_FEEDBACK_ATTEMPT_PHASE_LIMIT");
      for (const [phase, value] of Object.entries(phases)) {
        const detail = record(value, "FADENO_FEEDBACK_ATTEMPT_PHASES");
        exactKeys(detail, ["status", "elapsedNs", "reason"], "FADENO_FEEDBACK_ATTEMPT_PHASES");
        decimal(detail["elapsedNs"], "FADENO_FEEDBACK_ATTEMPT_PHASES");
        const skipped = phase === "typescript-refresh" && workloadId === "diagnostic-replacement";
        if (skipped) {
          if (detail["status"] !== "skipped" || detail["elapsedNs"] !== "0" || detail["reason"] !== "framework-diagnostic") {
            throw new TypeError("FADENO_FEEDBACK_ATTEMPT_PHASES");
          }
        } else if (detail["status"] !== "completed" || detail["reason"] !== null) {
          throw new TypeError("FADENO_FEEDBACK_ATTEMPT_PHASES");
        }
      }
    }
  }
  return Object.freeze({ mode: run["mode"] as "dry-run" | "measurement", attempts: run["attempts"].length, deepTiming: run["deepTiming"] });
}
