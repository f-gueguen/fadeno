import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const schema = JSON.parse(readFileSync(join(experiment, "reference-environment.schema.json"), "utf8"));
const reference = JSON.parse(readFileSync(join(experiment, "reference-environment.json"), "utf8")) as {
  id: string;
  toolchain: { lockSha256: string };
};
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
};
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(reference)) throw new Error(`FADENO_REVALIDATION_REFERENCE_SCHEMA:${JSON.stringify(validate.errors)}`);
const lockHash = createHash("sha256").update(readFileSync(join(root, "pnpm-lock.yaml"))).digest("hex");
if (reference.toolchain.lockSha256 !== lockHash) throw new Error("FADENO_REVALIDATION_REFERENCE_LOCK");
const results = readdirSync(join(experiment, "results")).sort();
if (JSON.stringify(results) !== JSON.stringify(["README.md"])) throw new Error("FADENO_REVALIDATION_PREMATURE_RESULT");
console.log(`revalidation reference contract passed (${reference.id}, no results)`);
