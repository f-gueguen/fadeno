import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const schema = JSON.parse(readFileSync(join(experiment, "qualification-contract.schema.json"), "utf8"));
type MutableContract = {
  environment: { id: string };
  correctness: { cycles: number; retries: number };
  latency: { warmupsPerPath: number; samplesPerPath: number; retries: number; timedBoundary: string };
  memory: { processMetric: string; measuredCycles: number; maximumGrowthRatio: number; gc: { required: boolean } };
  decision: { narrowAllowed: boolean; pivot: string };
  capabilitySlice: { immutableResultsAllowed: boolean };
};
const contract = JSON.parse(readFileSync(join(experiment, "qualification-contract.json"), "utf8")) as MutableContract;
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const mutations: readonly ((value: MutableContract) => void)[] = [
  (value) => { value.environment.id = "k0-h3-local-docker-arm64-v1"; },
  (value) => { value.correctness.cycles = 1; },
  (value) => { value.correctness.retries = 1; },
  (value) => { value.latency.warmupsPerPath = 10; },
  (value) => { value.latency.samplesPerPath = 100; },
  (value) => { value.latency.retries = 1; },
  (value) => { value.latency.timedBoundary = "revalidation-only"; },
  (value) => { value.memory.processMetric = "heapUsed"; },
  (value) => { value.memory.measuredCycles = 1000; },
  (value) => { value.memory.gc.required = false; },
  (value) => { value.memory.maximumGrowthRatio = 0.2; },
  (value) => { value.decision.narrowAllowed = true; },
  (value) => { value.decision.pivot = "latency-is-narrow"; },
  (value) => { value.capabilitySlice.immutableResultsAllowed = true; },
];
for (const mutate of mutations) {
  const candidate = structuredClone(contract);
  mutate(candidate);
  if (validate(candidate)) throw new Error("revalidation qualification contract mutation accepted");
}
console.log(`revalidation qualification contract negative tests passed (${mutations.length} mutations)`);
