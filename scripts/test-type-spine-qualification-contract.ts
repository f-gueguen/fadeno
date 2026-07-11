import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/type-spine");
const schema = JSON.parse(readFileSync(join(experiment, "qualification-contract.schema.json"), "utf8"));
type MutableContract = {
  measurement: {
    warmups: number; samples: number; retries: number;
    percentile: { method: string };
    thresholds: { incrementalToCleanMaximumRatio: number };
  };
  decision: { narrow: string };
  capabilitySlice: { immutableResultsAllowed: boolean };
  executionSlice: { requiredSource: string };
};
const contract = JSON.parse(
  readFileSync(join(experiment, "qualification-contract.json"), "utf8"),
) as MutableContract;
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const mutations: readonly ((document: MutableContract) => void)[] = [
  (document) => { document.measurement.warmups = 4; },
  (document) => { document.measurement.samples = 19; },
  (document) => { document.measurement.retries = 1; },
  (document) => { document.measurement.percentile.method = "linear"; },
  (document) => { document.measurement.thresholds.incrementalToCleanMaximumRatio = 0.5; },
  (document) => { document.decision.narrow = "ignore-latency"; },
  (document) => { document.capabilitySlice.immutableResultsAllowed = true; },
  (document) => { document.executionSlice.requiredSource = "working-tree"; },
];
for (const mutate of mutations) {
  const candidate = structuredClone(contract);
  mutate(candidate);
  if (validate(candidate)) throw new Error("FADENO_TYPE_SPINE_QUALIFICATION_MUTATION_ACCEPTED");
}
console.log(`type-spine qualification contract negative tests passed (${mutations.length} mutations)`);
