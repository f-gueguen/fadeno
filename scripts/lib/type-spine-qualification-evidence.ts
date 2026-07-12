import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { deriveQualificationMetrics, projectQualificationDecision, type QualificationMetrics, type TimingSample } from "../../experiments/type-spine/qualification-runner.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
type Capture = {
  beforeContainer: { nrPeriods: number; nrThrottled: number; oom: number; oomKill: number };
  afterContainer: { nrPeriods: number; nrThrottled: number; oom: number; oomKill: number };
  cpuThrottledRatio: number;
  proof: string;
  samples: TimingSample[];
};
const EXPECTED_PROOF = [
  "type-spine qualification corpus passed (1000 routes, 800 parameterized, A:eb98472c8a9bfa5c1902fa2c127d0343be9e9dba27377453909441d26fbff421, B:3033291eb9cb6875ceca30b17e1fcc4829f9d86658af41ba5ceb3cde71da2037)",
  "type-spine qualification contract passed (5 warmups, 20 samples, no result)",
  "type-spine stock-tool controls passed (tsc + TypeScript 7 LSP, eb98472c8a9bfa5c1902fa2c127d0343be9e9dba27377453909441d26fbff421)",
  "type-spine timing runner passed (fresh children, interleaved A/B smoke schedule)",
  "type-spine qualification capability passed (no result or decision)",
].join("\n");

export type QualificationConclusion = Readonly<{ metrics: QualificationMetrics; decision: "go" | "narrow" | "pivot" | "inconclusive"; gates: Readonly<Record<string, boolean>> }>;

export function verifyQualificationCapture(value: unknown): QualificationConclusion {
  const schema = JSON.parse(readFileSync(join(root, "experiments/type-spine/qualification-capture.schema.json"), "utf8"));
  const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): ((document: unknown) => boolean) & { errors?: unknown } };
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(value)) throw new Error(`FADENO_TYPE_SPINE_CAPTURE_SCHEMA:${JSON.stringify(validate.errors)}`);
  const capture = value as Capture;
  const periods = capture.afterContainer.nrPeriods - capture.beforeContainer.nrPeriods;
  const throttled = capture.afterContainer.nrThrottled - capture.beforeContainer.nrThrottled;
  const ratio = periods === 0 ? 0 : throttled / periods;
  if (Math.abs(ratio - capture.cpuThrottledRatio) > Number.EPSILON || capture.afterContainer.oom !== capture.beforeContainer.oom || capture.afterContainer.oomKill !== capture.beforeContainer.oomKill) {
    throw new Error("FADENO_TYPE_SPINE_CAPTURE_CGROUP");
  }
  const metrics = deriveQualificationMetrics(capture.samples);
  const proofPass = capture.proof === EXPECTED_PROOF;
  const gates = {
    "valid-consumers": proofPass,
    "invalid-source-diagnostics": proofPass,
    "byte-determinism": proofPass,
    "stale-output": proofPass,
    "stock-tsc": proofPass,
    "stock-language-server": proofPass,
    "clean-latency": metrics.cleanGeneratorToTscRatio <= 1.5,
    "incremental-latency": metrics.incrementalToCleanRatio <= 0.25,
  };
  return { metrics, gates, decision: projectQualificationDecision(gates, true) };
}

export function verifyQualificationResult(directory: string): QualificationConclusion {
  const manifestSchema = JSON.parse(readFileSync(join(root, "experiments/type-spine/qualification-result.schema.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as {
    measurements: QualificationMetrics;
    artifacts: readonly { path: string; sha256: string; bytes: number }[];
    conclusion: { decision: string };
    source: { commit: string };
    workload: { corpusSha256: string; contractSha256: string; lockSha256: string; referenceSha256: string };
  };
  const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): ((document: unknown) => boolean) & { errors?: unknown } };
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(manifestSchema);
  if (!validate(manifest)) throw new Error(`FADENO_TYPE_SPINE_RESULT_SCHEMA:${JSON.stringify(validate.errors)}`);
  const artifactPaths = manifest.artifacts.map(({ path }) => path).sort();
  if (JSON.stringify(artifactPaths) !== JSON.stringify(["capture.json", "decision.json"])) {
    throw new Error("FADENO_TYPE_SPINE_RESULT_INVENTORY");
  }
  for (const artifact of manifest.artifacts) {
    const bytes = readFileSync(join(directory, artifact.path));
    if (bytes.byteLength !== artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw new Error("FADENO_TYPE_SPINE_RESULT_ARTIFACT");
    }
  }
  const capture = JSON.parse(readFileSync(join(directory, "capture.json"), "utf8"));
  const conclusion = verifyQualificationCapture(capture);
  const decision = JSON.parse(readFileSync(join(directory, "decision.json"), "utf8")) as {
    captureSha256: string; metrics: QualificationMetrics; gates: Record<string, boolean>; decision: string;
  };
  const captureBytes = readFileSync(join(directory, "capture.json"));
  const sourceFileHash = (path: string) => createHash("sha256")
    .update(execFileSync("git", ["show", `${manifest.source.commit}:${path}`], { cwd: root }))
    .digest("hex");
  if (
    manifest.workload.corpusSha256 !== sourceFileHash("experiments/type-spine/qualification-corpus.json") ||
    manifest.workload.contractSha256 !== sourceFileHash("experiments/type-spine/qualification-contract.json") ||
    manifest.workload.referenceSha256 !== sourceFileHash("experiments/type-spine/reference-environment.json") ||
    manifest.workload.lockSha256 !== sourceFileHash("pnpm-lock.yaml") ||
    decision.captureSha256 !== createHash("sha256").update(captureBytes).digest("hex") ||
    JSON.stringify(decision.metrics) !== JSON.stringify(conclusion.metrics) ||
    JSON.stringify(decision.gates) !== JSON.stringify(conclusion.gates) ||
    decision.decision !== conclusion.decision || manifest.conclusion.decision !== conclusion.decision ||
    JSON.stringify(manifest.measurements) !== JSON.stringify(conclusion.metrics)
  ) throw new Error("FADENO_TYPE_SPINE_RESULT_PROJECTION");
  return conclusion;
}
