import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "experiments/revalidation/workload.schema.json"), "utf8"));
type MutableWorkload = {
  dataset: { rowCount: number };
  resources: string[];
  pageReads: string[];
  mutation: { affectedResource: string };
  paths: string[];
  comparison: { refuses: string[] };
  unsafeKeeps: unknown[];
  authentication: { extra?: boolean };
};
const workload = JSON.parse(
  readFileSync(join(root, "experiments/revalidation/workload.json"), "utf8"),
) as MutableWorkload;
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const mutations: readonly ((value: MutableWorkload) => void)[] = [
  (value) => { value.dataset.rowCount = 9999; },
  (value) => { value.resources.pop(); },
  (value) => { value.pageReads.pop(); },
  (value) => { value.mutation.affectedResource = "profile"; },
  (value) => { value.paths = ["success"]; },
  (value) => { value.comparison.refuses = []; },
  (value) => { value.unsafeKeeps.pop(); },
  (value) => { value.authentication.extra = true; },
];
for (const mutate of mutations) {
  const candidate = structuredClone(workload);
  mutate(candidate);
  if (validate(candidate)) throw new Error("revalidation workload mutation accepted");
}
console.log(`revalidation contract negative tests passed (${mutations.length} mutations)`);
