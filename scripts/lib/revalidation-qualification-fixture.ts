import type { QualificationCapture } from "../../experiments/revalidation/qualification-proof.ts";
import type { QualificationSchedule } from "../../experiments/revalidation/qualification-schedule.ts";

export function validQualificationCapture(schedule: QualificationSchedule): QualificationCapture {
  const zeroHash = "0".repeat(64);
  return {
    schemaVersion: 1,
    sourceCommit: "0".repeat(40),
    environmentId: "k0-h4-local-docker-arm64-v1",
    status: "complete",
    inputHashes: { environment: zeroHash, workload: zeroHash, baselines: zeroHash, schedule: zeroHash, golden: zeroHash, lock: zeroHash },
    preflight: { beforeAccepted: true, afterAccepted: true, beforeHostSha256: zeroHash, afterHostSha256: zeroHash, beforeContainerSha256: zeroHash, afterContainerSha256: zeroHash },
    correctness: { cycles: schedule.cycles.map((cycle) => ({
      id: cycle.id,
      path: cycle.path,
      readOrder: cycle.readOrder,
      beforeDigest: schedule.outputDigests.before,
      defaultDigest: cycle.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before,
      selectiveDigest: cycle.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before,
      defaultExecutions: cycle.path === "s" ? "111111" : "000000",
      selectiveExecutions: cycle.path === "s" ? "000001" : "000000",
      defaultActionStatus: cycle.path === "s" ? "success" : "expected-error",
      selectiveActionStatus: cycle.path === "s" ? "success" : "expected-error",
      stateIsolated: true,
      stale: false,
    })) },
    latency: { defaultNs: Array(1000).fill(100), selectiveNs: Array(1000).fill(100), outputsMatch: true },
    memory: { gcAvailable: true, gcRounds: 3, baselineRss: 1000, afterRss: 1050, baselineHeapUsed: 500, afterHeapUsed: 500, baselineCgroupMemory: 2000, afterCgroupMemory: 2050, checkpoints: Array(10).fill(1000) },
    controls: { unsafeKeepsDetected: 4, unsafeKeepsTotal: 4, comparisonPass: true, sensitiveValuesDisclosed: false },
    failures: [],
  };
}
