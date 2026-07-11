import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";

import { readJsonDocument } from "./experiment-contract.ts";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = {
  compile(schema: unknown): Validator;
  errorsText(errors: unknown): string;
  validateSchema(schema: unknown): boolean;
  errors: unknown;
};
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvInstance;

export type TypeSpineReferenceEnvironment = Readonly<{
  id: string;
  scope: string;
  host: Readonly<Record<string, unknown>>;
  docker: Readonly<Record<string, unknown>>;
  container: Readonly<Record<string, unknown>>;
  toolchain: Readonly<{ lockfile: string; lockSha256: string } & Record<string, unknown>>;
  preflight: Readonly<Record<string, unknown>>;
}>;

export function loadTypeSpineReference(root: string): TypeSpineReferenceEnvironment {
  const directory = join(root, "experiments/type-spine");
  const schema = readJsonDocument(join(directory, "reference-environment.schema.json"));
  const document = readJsonDocument(join(directory, "reference-environment.json"));
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
  if (!ajv.validateSchema(schema)) {
    throw new Error(`H3 reference schema differs: ${ajv.errorsText(ajv.errors)}`);
  }
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    throw new Error(`H3 reference document differs: ${ajv.errorsText(validate.errors)}`);
  }
  return document as TypeSpineReferenceEnvironment;
}

export function verifyTypeSpineReferenceSemantics(
  root: string,
  reference: TypeSpineReferenceEnvironment,
): void {
  const lock = readFileSync(join(root, reference.toolchain.lockfile));
  const hash = createHash("sha256").update(lock).digest("hex");
  if (hash !== reference.toolchain.lockSha256) {
    throw new Error("H3 reference dependency lock differs");
  }
  if (
    reference.id !== "k0-h3-local-docker-arm64-v1" ||
    reference.scope !== "type-spine-qualification-only"
  ) throw new Error("H3 reference scope differs");
}
