import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { REVALIDATION_RESOURCE_IDS, loadRevalidationWorkload, stableRevalidationContract } from "../experiments/revalidation/contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const schema = JSON.parse(readFileSync(join(experiment, "workload.schema.json"), "utf8"));
const document = JSON.parse(readFileSync(join(experiment, "workload.json"), "utf8"));
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown } };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(document)) throw new Error(`FADENO_REVALIDATION_SCHEMA:${JSON.stringify(validate.errors)}`);
const baselineSchema = JSON.parse(readFileSync(join(experiment, "baseline-manifests.schema.json"), "utf8"));
const baselines = JSON.parse(readFileSync(join(experiment, "baseline-manifests.json"), "utf8"));
const validateBaselines = new Ajv2020({ allErrors: true, strict: true }).compile(baselineSchema);
if (!validateBaselines(baselines)) throw new Error(`FADENO_REVALIDATION_BASELINE_SCHEMA:${JSON.stringify(validateBaselines.errors)}`);
const workload = loadRevalidationWorkload();
if (JSON.stringify([...workload.resources].sort()) !== JSON.stringify(REVALIDATION_RESOURCE_IDS)) throw new Error("FADENO_REVALIDATION_RESOURCES");
const counts = new Map(REVALIDATION_RESOURCE_IDS.map((id) => [id, workload.pageReads.filter((value) => value === id).length]));
if (workload.pageReads.length !== 9 || [...counts.values()].filter((count) => count === 2).length !== 3 || [...counts.values()].some((count) => count < 1 || count > 2)) {
  throw new Error("FADENO_REVALIDATION_READS");
}
if (workload.dataset.rowCount < 10_000 || workload.mutation.affectedResource !== "tasks") throw new Error("FADENO_REVALIDATION_DATASET");
const classes = workload.unsafeKeeps.map((item) => item.class).sort();
if (JSON.stringify(classes) !== JSON.stringify(["expected-error", "non-cacheable", "ordering", "value"])) throw new Error("FADENO_REVALIDATION_KEEPS_CLASSES");
const listing = stableRevalidationContract();
if (listing.includes(workload.authentication.secretCanary) || !listing.includes('"secretCanary":"[redacted]"')) throw new Error("FADENO_REVALIDATION_SECRET_DISCLOSURE");
console.log("revalidation contract passed (6 resources, 9 reads, 10000 rows, 4 unsafe keeps)");
