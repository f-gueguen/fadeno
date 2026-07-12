import type { QualificationCycleRecord } from "./qualification-runner.ts";
import type { QualificationSchedule } from "./qualification-schedule.ts";

export type QualificationCapture = Readonly<{
  schemaVersion: 1;
  sourceCommit: string;
  environmentId: "k0-h4-local-docker-arm64-v1";
  status: "complete" | "inconclusive";
  inputHashes: Readonly<Record<string, string>>;
  preflight: Readonly<{
    identitySha256: string;
    beforeAccepted: boolean;
    afterAccepted: boolean;
    beforeHostSha256: string;
    afterHostSha256: string;
    beforeContainerSha256: string;
    afterContainerSha256: string;
  }>;
  correctness?: Readonly<{ cycles: readonly QualificationCycleRecord[] }>;
  latency?: Readonly<{ defaultNs: readonly number[]; selectiveNs: readonly number[]; outputsMatch: boolean }>;
  memory?: Readonly<{
    gcAvailable: boolean;
    gcRounds: number;
    baselineRss: number;
    afterRss: number;
    baselineHeapUsed: number;
    afterHeapUsed: number;
    baselineCgroupMemory: number;
    afterCgroupMemory: number;
    checkpoints: readonly number[];
  }>;
  controls?: Readonly<{ unsafeKeepsDetected: number; unsafeKeepsTotal: number; comparisonPass: boolean; sensitiveValuesDisclosed: boolean }>;
  failures: readonly Readonly<{ code: string; cycleId?: string }>[];
}>;

export type QualificationGates = Readonly<{
  correctness: boolean;
  deduplication: boolean;
  latencyRatio: boolean;
  latencyAbsolute: boolean;
  memory: boolean;
  unsafeKeeps: boolean;
  comparison: boolean;
  environment: boolean;
  integrity: boolean;
}>;

export type QualificationResult = Readonly<{
  schemaVersion: 1;
  sourceCommit: string;
  captureSha256: string;
  metrics: Readonly<{
    correctnessCycles: 10000;
    staleCycles: number;
    deduplicationFailures: number;
    defaultP95Ns: number;
    selectiveP95Ns: number;
    defaultToSelectiveP95Ratio: number;
    defaultP95Milliseconds: number;
    memoryGrowthRatio: number;
    unsafeKeepDetectionRatio: number;
  }>;
  decision: Readonly<{
    schemaVersion: 1;
    outcome: "go" | "pivot" | "inconclusive";
    productDecision: boolean;
    gates: QualificationGates;
    reasons: readonly string[];
  }>;
}>;

export type QualificationProofPolicy = Readonly<{
  correctnessCycles: 10000;
  latencySamples: number;
  latencyMaximumRatio: number;
  latencyMaximumMilliseconds: number;
  memoryCheckpoints: number;
  memoryMaximumGrowthRatio: number;
  gcRounds: number;
}>;

const root = dirname(fileURLToPath(import.meta.url));

export function loadQualificationProofPolicy(): QualificationProofPolicy {
  const contract = JSON.parse(readFileSync(join(root, "qualification-contract.json"), "utf8")) as {
    correctness: { cycles: 10000 };
    latency: { samplesPerPath: number; thresholds: { defaultToSelectiveP95MaximumRatio: number; defaultP95MaximumMilliseconds: number } };
    memory: { measuredCycles: number; checkpointInterval: number; maximumGrowthRatio: number; gc: { rounds: number } };
  };
  return {
    correctnessCycles: contract.correctness.cycles,
    latencySamples: contract.latency.samplesPerPath,
    latencyMaximumRatio: contract.latency.thresholds.defaultToSelectiveP95MaximumRatio,
    latencyMaximumMilliseconds: contract.latency.thresholds.defaultP95MaximumMilliseconds,
    memoryCheckpoints: contract.memory.measuredCycles / contract.memory.checkpointInterval,
    memoryMaximumGrowthRatio: contract.memory.maximumGrowthRatio,
    gcRounds: contract.memory.gc.rounds,
  };
}

export function nearestRank95(values: readonly number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("FADENO_REVALIDATION_QUALIFICATION_SAMPLES");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

function scheduleAligned(cycles: readonly QualificationCycleRecord[], schedule: QualificationSchedule, policy: QualificationProofPolicy): boolean {
  return cycles.length === policy.correctnessCycles && schedule.cycles.length === policy.correctnessCycles && cycles.every((cycle, index) => {
    const expected = schedule.cycles[index];
    return expected !== undefined && cycle.id === expected.id && cycle.path === expected.path && cycle.readOrder === expected.readOrder;
  });
}

export function deriveQualificationResult(
  capture: QualificationCapture,
  schedule: QualificationSchedule,
  captureSha256: string,
  environmentEvidenceValid: boolean,
  artifactIntegrityValid: boolean,
  policy: QualificationProofPolicy = loadQualificationProofPolicy(),
): QualificationResult {
  const cycles = capture.correctness?.cycles ?? [];
  const aligned = scheduleAligned(cycles, schedule, policy);
  const latencyShape = capture.latency?.defaultNs.length === policy.latencySamples && capture.latency.selectiveNs.length === policy.latencySamples;
  const memoryShape = capture.memory?.checkpoints.length === policy.memoryCheckpoints;
  const integrity = artifactIntegrityValid && aligned && latencyShape && memoryShape && /^[a-f0-9]{64}$/u.test(captureSha256);
  const environment = environmentEvidenceValid && capture.status === "complete" && capture.preflight.beforeAccepted &&
    capture.preflight.afterAccepted && capture.memory?.gcAvailable === true && capture.memory.gcRounds === policy.gcRounds;

  let staleCycles = 0;
  let deduplicationFailures = 0;
  if (aligned) {
    for (let index = 0; index < cycles.length; index += 1) {
      const cycle = cycles[index]!;
      const expected = schedule.cycles[index]!;
      const expectedDigest = expected.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before;
      const expectedStatus = expected.path === "s" ? "success" : "expected-error";
      const expectedDefaultExecutions = expected.path === "s" ? "111111" : "000000";
      const expectedSelectiveExecutions = expected.path === "s" ? "000001" : "000000";
      if (
        cycle.stale || !cycle.stateIsolated || cycle.beforeDigest !== schedule.outputDigests.before ||
        cycle.defaultDigest !== expectedDigest || cycle.selectiveDigest !== expectedDigest ||
        cycle.defaultActionStatus !== expectedStatus || cycle.selectiveActionStatus !== expectedStatus
      ) staleCycles += 1;
      if (cycle.defaultExecutions !== expectedDefaultExecutions || cycle.selectiveExecutions !== expectedSelectiveExecutions) {
        deduplicationFailures += 1;
      }
    }
  }

  let defaultP95Ns = 1;
  let selectiveP95Ns = 1;
  if (latencyShape) {
    defaultP95Ns = nearestRank95(capture.latency!.defaultNs);
    selectiveP95Ns = nearestRank95(capture.latency!.selectiveNs);
  }
  const defaultToSelectiveP95Ratio = defaultP95Ns / selectiveP95Ns;
  const defaultP95Milliseconds = defaultP95Ns / 1_000_000;
  const baselineRss = capture.memory?.baselineRss ?? 0;
  const afterRss = capture.memory?.afterRss ?? 0;
  const memoryGrowthRatio = baselineRss > 0 ? (afterRss - baselineRss) / baselineRss : Number.POSITIVE_INFINITY;
  const unsafeKeepDetectionRatio = capture.controls && capture.controls.unsafeKeepsTotal > 0
    ? capture.controls.unsafeKeepsDetected / capture.controls.unsafeKeepsTotal
    : 0;
  const gates: QualificationGates = {
    correctness: aligned && staleCycles === 0 && capture.failures.length === 0,
    deduplication: aligned && deduplicationFailures === 0,
    latencyRatio: latencyShape && capture.latency?.outputsMatch === true && defaultToSelectiveP95Ratio <= policy.latencyMaximumRatio,
    latencyAbsolute: latencyShape && defaultP95Milliseconds <= policy.latencyMaximumMilliseconds,
    memory: memoryShape && Number.isFinite(memoryGrowthRatio) && memoryGrowthRatio <= policy.memoryMaximumGrowthRatio,
    unsafeKeeps: unsafeKeepDetectionRatio === 1,
    comparison: capture.controls?.comparisonPass === true && capture.controls.sensitiveValuesDisclosed === false,
    environment,
    integrity,
  };
  const productGateNames = ["correctness", "deduplication", "latencyRatio", "latencyAbsolute", "memory", "unsafeKeeps", "comparison"] as const;
  const failedProductGates = productGateNames.filter((name) => !gates[name]);
  const outcome = !gates.environment || !gates.integrity
    ? "inconclusive"
    : failedProductGates.length === 0 ? "go" : "pivot";
  const reasons = outcome === "inconclusive"
    ? ([!gates.environment ? "environment" : undefined, !gates.integrity ? "integrity" : undefined].filter(Boolean) as string[])
    : failedProductGates.map((name) => name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`));
  return {
    schemaVersion: 1,
    sourceCommit: capture.sourceCommit,
    captureSha256,
    metrics: {
      correctnessCycles: 10_000,
      staleCycles,
      deduplicationFailures,
      defaultP95Ns,
      selectiveP95Ns,
      defaultToSelectiveP95Ratio,
      defaultP95Milliseconds,
      memoryGrowthRatio,
      unsafeKeepDetectionRatio,
    },
    decision: { schemaVersion: 1, outcome, productDecision: outcome !== "inconclusive", gates, reasons },
  };
}
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
