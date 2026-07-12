import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  addSchema(schema: unknown): void;
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
  validateSchema(schema: unknown): boolean;
  errors?: unknown;
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaNames = [
  "qualification-contract.schema.json",
  "qualification-attempt.schema.json",
  "qualification-capture.schema.json",
  "reference-identity.schema.json",
  "qualification-decision.schema.json",
  "qualification-result.schema.json",
];
const schemas = new Map(schemaNames.map((name) => [name, JSON.parse(readFileSync(join(experiment, name), "utf8"))]));
for (const [name, schema] of schemas) {
  if (!ajv.validateSchema(schema)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_SCHEMA:${name}:${JSON.stringify(ajv.errors)}`);
}
ajv.addSchema(schemas.get("qualification-decision.schema.json"));
const contract = JSON.parse(readFileSync(join(experiment, "qualification-contract.json"), "utf8")) as {
  inputs: Record<string, { path: string; sha256: string }>;
  environment: { path: string; sha256: string };
};
const validateContract = ajv.compile(schemas.get("qualification-contract.schema.json"));
if (!validateContract(contract)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_CONTRACT:${JSON.stringify(validateContract.errors)}`);
for (const input of [contract.environment, ...Object.values(contract.inputs)]) {
  const digest = createHash("sha256").update(readFileSync(join(root, input.path))).digest("hex");
  if (digest !== input.sha256) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_INPUT:${input.path}`);
}
const validateCapture = ajv.compile(schemas.get("qualification-capture.schema.json"));
const validateAttempt = ajv.compile(schemas.get("qualification-attempt.schema.json"));
const validateDecision = ajv.compile(schemas.get("qualification-decision.schema.json"));
const validateResult = ajv.compile(schemas.get("qualification-result.schema.json"));
const schedule = JSON.parse(readFileSync(join(experiment, "qualification-schedule.json"), "utf8")) as {
  cycles: readonly { id: string; path: "s" | "e"; readOrder: string; expectedDigest: "s" | "b" }[];
  outputDigests: { before: string; success: string };
};
const zeroHash = "0".repeat(64);
const attempt = { schemaVersion: 1, id: "20260712T000000Z-0000000-a1", attempt: 1, sourceCommit: "0".repeat(40), startedAt: "2026-07-12T00:00:00Z", status: "launched", phase: "allocated" };
if (!validateAttempt(attempt)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_ATTEMPT_SCHEMA:${JSON.stringify(validateAttempt.errors)}`);
const capture = {
  schemaVersion: 1,
  sourceCommit: "0".repeat(40),
  environmentId: "k0-h4-local-docker-arm64-v1",
  status: "complete",
  inputHashes: { environment: zeroHash, workload: zeroHash, baselines: zeroHash, schedule: zeroHash, scheduleGolden: zeroHash, dependencyLock: zeroHash },
  preflight: { identitySha256: zeroHash, beforeAccepted: true, afterAccepted: true, beforeHostSha256: zeroHash, afterHostSha256: zeroHash, beforeContainerSha256: zeroHash, afterContainerSha256: zeroHash },
  correctness: { cycles: schedule.cycles.map((cycle) => ({
    id: cycle.id,
    path: cycle.path,
    readOrder: cycle.readOrder,
    beforeDigest: schedule.outputDigests.before,
    defaultDigest: cycle.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before,
    selectiveDigest: cycle.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before,
    defaultExecutions: "111111",
    selectiveExecutions: "000001",
    defaultActionStatus: cycle.path === "s" ? "success" : "expected-error",
    selectiveActionStatus: cycle.path === "s" ? "success" : "expected-error",
    stateIsolated: true,
    stale: false,
  })) },
  latency: { defaultNs: Array(1000).fill(1), selectiveNs: Array(1000).fill(1), rounds: Array.from({ length: 1000 }, (_, round) => ({ round, firstPath: round % 2 === 0 ? "default" : "selective", defaultNs: 1, selectiveNs: 1, defaultOutputDigest: schedule.outputDigests.success, selectiveOutputDigest: schedule.outputDigests.success })), outputsMatch: true },
  memory: { gcAvailable: true, gcRounds: 3, baselineRss: 1, afterRss: 1, baselineHeapUsed: 1, afterHeapUsed: 1, baselineCgroupMemory: 1, afterCgroupMemory: 1, checkpoints: Array(10).fill(1) },
  controls: { unsafeKeepsDetected: 4, unsafeKeepsTotal: 4, comparisonPass: true, sensitiveValuesDisclosed: false },
  failures: [],
};
if (!validateCapture(capture)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_CAPTURE_SCHEMA:${JSON.stringify(validateCapture.errors)}`);
for (const mutate of [
  (value: typeof capture) => { value.correctness.cycles[0]!.stateIsolated = false; },
  (value: typeof capture) => { value.correctness.cycles[0]!.defaultExecutions = "111112"; },
  (value: typeof capture) => { value.latency.outputsMatch = false; },
  (value: typeof capture) => { value.controls.unsafeKeepsDetected = 3; },
  (value: typeof capture) => { value.controls.sensitiveValuesDisclosed = true; },
]) {
  const productFailure = structuredClone(capture);
  mutate(productFailure);
  if (!validateCapture(productFailure)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_PIVOT_SCHEMA:${JSON.stringify(validateCapture.errors)}`);
}
const decision = {
  schemaVersion: 1,
  outcome: "go",
  productDecision: true,
  gates: { correctness: true, deduplication: true, latencyRatio: true, latencyAbsolute: true, memory: true, unsafeKeeps: true, comparison: true, environment: true, integrity: true },
  reasons: [],
};
if (!validateDecision(decision)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_DECISION_SCHEMA:${JSON.stringify(validateDecision.errors)}`);
const result = {
  schemaVersion: 1,
  sourceCommit: "0".repeat(40),
  captureSha256: zeroHash,
  metrics: { correctnessCycles: 10000, staleCycles: 0, deduplicationFailures: 0, defaultP95Ns: 1, selectiveP95Ns: 1, defaultToSelectiveP95Ratio: 1, defaultP95Milliseconds: 0.000001, memoryGrowthRatio: 0, unsafeKeepDetectionRatio: 1 },
  decision,
};
if (!validateResult(result)) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_RESULT_SCHEMA:${JSON.stringify(validateResult.errors)}`);
const registry = JSON.parse(readFileSync(join(root, "experiments/registry.json"), "utf8")) as { experiments: readonly { id: string; status: string; decision?: string }[] };
const revalidation = registry.experiments.find(({ id }) => id === "revalidation");
if (revalidation?.status !== "qualified" || revalidation.decision !== "go") throw new Error("FADENO_REVALIDATION_QUALIFICATION_DECISION_REGISTRY");
console.log("revalidation qualification contract passed (GO/PIVOT/INCONCLUSIVE, immutable GO result)");
