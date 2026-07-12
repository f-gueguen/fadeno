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
  const proofPass = capture.proof.includes("type-spine qualification capability passed (no result or decision)");
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
