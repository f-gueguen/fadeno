import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
};

function validator(root: string, schemaName: string) {
  const schema = JSON.parse(readFileSync(join(root, "experiments/revalidation", schemaName), "utf8"));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

export function assertQualificationAttemptDocument(root: string, value: unknown): void {
  const validate = validator(root, "qualification-attempt.schema.json");
  if (!validate(value)) throw new Error("FADENO_REVALIDATION_ATTEMPT_SCHEMA");
}

export function assertQualificationCaptureDocument(root: string, value: unknown): void {
  const validate = validator(root, "qualification-capture.schema.json");
  if (!validate(value)) throw new Error("FADENO_REVALIDATION_CAPTURE_SCHEMA");
}

export function assertReferenceIdentityDocument(root: string, value: unknown): void {
  const validate = validator(root, "reference-identity.schema.json");
  if (!validate(value)) throw new Error("FADENO_REVALIDATION_IDENTITY_SCHEMA");
}
