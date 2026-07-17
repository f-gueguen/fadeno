import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sha256, verifyFeedbackContract, verifyFeedbackRun } from "./lib/v1-analyzer-feedback-verifier.ts";

const contractBytes = readFileSync(fileURLToPath(new URL("../fixtures/v1-analyzer/feedback-contract.json", import.meta.url)));
const contract = verifyFeedbackContract(JSON.parse(contractBytes.toString("utf8")) as unknown);
const contractRefuses = (mutate: (copy: any) => void, code: RegExp): void => {
  const copy = JSON.parse(contractBytes.toString("utf8")) as any;
  mutate(copy);
  assert.throws(() => verifyFeedbackContract(copy), code);
};
contractRefuses((copy) => { copy.schedule.warmups = 3; }, /FADENO_FEEDBACK_CONTRACT_SCHEDULE_SIZE/u);
contractRefuses((copy) => { copy.workloads[0].mutation.path = "src/routes/other/handler.ts"; }, /FADENO_FEEDBACK_CONTRACT_WORKLOADS/u);
contractRefuses((copy) => { copy.workloads[0].mutation.sha256 = "0".repeat(64); }, /FADENO_FEEDBACK_CONTRACT_WORKLOADS/u);
const digest = "a".repeat(64);
const identity = Object.freeze({
  sourceCommit: "b".repeat(40),
  sourceTreeSha256: digest,
  tarballSha256: digest,
  installedPackageTreeSha256: digest,
  runtimeVersion: "v22.17.0",
  runtimeExecutableSha256: digest,
  compilerVersion: "7.0.2",
  compilerPackageSha256: digest,
  platform: "test",
  architecture: "test",
  environmentSha256: digest,
});
const attempts = [];
let now = 1n;
for (let round = 0; round < contract.schedule.warmups + contract.schedule.repetitions; round += 1) {
  for (const workloadId of contract.schedule.order) {
    const stage = round < contract.schedule.warmups ? "warmup" : "sample";
    const repetition = stage === "warmup" ? round + 1 : round - contract.schedule.warmups + 1;
    const workload = contract.workloads.find(({ id }) => id === workloadId)!;
    const diskArtifacts = contract.generatedArtifacts.map((path) => ({ path, sha256: digest }));
    const publicationArtifacts = workloadId === "cleared-replacement"
      ? diskArtifacts.map((artifact) => ({ ...artifact }))
      : [];
    const start = now;
    now += 10n;
    attempts.push({
      attemptId: `${stage}-${repetition}-${workloadId}`,
      stage,
      repetition,
      workloadId,
      startNs: start.toString(),
      acceptedNs: now.toString(),
      elapsedNs: (now - start).toString(),
      acceptedEvent: {
        kind: workload.acceptedEvent,
        operationId: `operation-${attempts.length + 1}`,
        diagnosticOperationId: `operation-${attempts.length + 1}`,
        publicationOperationId: `operation-${attempts.length + 1}`,
        workspaceEpoch: attempts.length + 1,
        configurationEpoch: 1,
        diagnosticCodes: workload.diagnosticCodes,
        diagnosticCompleteness: "complete",
        diagnosticTruncated: false,
        publicationArtifacts,
        removedArtifactPaths: workloadId === "diagnostic-replacement" ? contract.generatedArtifacts : [],
        diskArtifacts,
        publicationSha256: digest,
        diskSha256: digest,
      },
      phaseTiming: null,
    });
  }
}
const valid = {
  schema: "fadeno.private.feedback-run",
  version: 1,
  contractSha256: sha256(contractBytes),
  mode: "dry-run",
  deepTiming: false,
  identity,
  clock: contract.clock,
  attempts,
  validity: Object.fromEntries(contract.validity.map((key) => [key, true])),
  cleanup: {
    activeOperations: 0,
    compilerValidations: 0,
    coordinatorActiveOperations: 0,
    coordinatorDrainWorkers: 0,
    coordinatorPendingAnalysisOperations: 0,
    coordinatorQueuedOperations: 0,
    currentAnalysisTokens: 0,
    latestAnalysisRequests: 0,
    observers: 0,
    pendingApplicationRecoveries: 0,
    pendingBytes: 0,
    pendingCleanups: 0,
    pendingHints: 0,
    pendingNotifications: 0,
    pendingRollbacks: 0,
    retainedCycles: 0,
    timers: 0,
    waiters: 0,
  },
  complete: true,
  selection: "all-attempts-no-retry",
};
assert.deepEqual(verifyFeedbackRun(valid, contract, sha256(contractBytes), identity), { mode: "dry-run", attempts: 14, deepTiming: false });

const refuses = (mutate: (copy: any) => void, code: RegExp): void => {
  const copy = structuredClone(valid);
  mutate(copy);
  assert.throws(() => verifyFeedbackRun(copy, contract, sha256(contractBytes), identity), code);
};
refuses((copy) => { copy.validity["stale-output-canary"] = false; }, /FADENO_FEEDBACK_RUN_INVALID/u);
refuses((copy) => { copy.attempts.splice(1, 1); }, /FADENO_FEEDBACK_RUN_ATTEMPT_COUNT/u);
refuses((copy) => { copy.attempts[2].attemptId = copy.attempts[0].attemptId; }, /FADENO_FEEDBACK_ATTEMPT_ORDER/u);
refuses((copy) => { copy.attempts[0].acceptedNs = copy.attempts[0].startNs; }, /FADENO_FEEDBACK_ATTEMPT_CLOCK/u);
refuses((copy) => { copy.attempts[1].acceptedEvent.diagnosticCodes = ["stale"]; }, /FADENO_FEEDBACK_ATTEMPT_DIAGNOSTICS/u);
refuses((copy) => { copy.attempts[1].acceptedEvent.diskArtifacts[0].sha256 = "c".repeat(64); }, /FADENO_FEEDBACK_ATTEMPT_ARTIFACT_MISMATCH/u);
refuses((copy) => { copy.cleanup.activeOperations = 1; }, /FADENO_FEEDBACK_RUN_CLEANUP/u);
refuses((copy) => { copy.attempts[0].phaseTiming = {}; }, /FADENO_FEEDBACK_ATTEMPT_DEEP_DISABLED/u);
refuses((copy) => { copy.selection = "best-attempt"; }, /FADENO_FEEDBACK_RUN_COMPLETENESS/u);
refuses((copy) => { copy.contractSha256 = "c".repeat(64); }, /FADENO_FEEDBACK_RUN_CONTRACT_IDENTITY/u);

console.log("V1 analyzer feedback contract passed (workloads, schedule, identities, monotonic endpoints, refusals)");
