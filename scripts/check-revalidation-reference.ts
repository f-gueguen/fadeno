import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const lockHash = createHash("sha256")
  .update(execFileSync("git", ["show", "51594a8b8f460a9b28e1e0ade25816a5a898395b:pnpm-lock.yaml"], { cwd: root }))
  .digest("hex");
if (reference.toolchain.lockSha256 !== lockHash) throw new Error("FADENO_REVALIDATION_REFERENCE_LOCK");
console.log(`revalidation reference contract passed (${reference.id}, exact identity)`);
