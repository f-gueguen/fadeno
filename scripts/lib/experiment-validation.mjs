import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  ContractError,
  assertRegistrySemantics,
  readJsonDocument,
} from "./experiment-contract.mjs";

export const SCHEMA_FILES = [
  "reference-environment.schema.json",
  "experiment-registry.schema.json",
  "result-manifest.schema.json",
];

function isUtcTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(
    value,
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function assertNoRemoteRefs(schema, label) {
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && !child.startsWith("#")) {
        throw new ContractError(
          "FADENO_K0_SCHEMA_REMOTE_REF",
          `${label}: remote $ref is forbidden: ${child}`,
        );
      }
      visit(child);
    }
  }
  visit(schema);
}

export function createContractValidators(root) {
  const schemaRoot = join(root, "experiments/contract/v1");
  const schemas = new Map(
    SCHEMA_FILES.map((file) => [file, readJsonDocument(join(schemaRoot, file))]),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
  ajv.addFormat("fadeno-utc-timestamp", {
    type: "string",
    validate: isUtcTimestamp,
  });

  for (const [file, schema] of schemas) {
    assertNoRemoteRefs(schema, file);
    if (!ajv.validateSchema(schema)) {
      throw new ContractError(
        "FADENO_K0_SCHEMA_INVALID",
        `${file}: ${ajv.errorsText(ajv.errors)}`,
        structuredClone(ajv.errors),
      );
    }
  }

  return {
    ajv,
    schemas,
    reference: ajv.compile(schemas.get("reference-environment.schema.json")),
    registry: ajv.compile(schemas.get("experiment-registry.schema.json")),
    manifest: ajv.compile(schemas.get("result-manifest.schema.json")),
  };
}

export function assertSchema(validator, document, label) {
  if (!validator(document)) {
    throw new ContractError(
      "FADENO_K0_SCHEMA_REJECTED",
      `${label}: schema validation failed`,
      structuredClone(validator.errors),
    );
  }
  return document;
}

export function assertReferenceSemantics(reference) {
  const expectedImage = `${reference.container.registry}/${reference.container.repository}@${reference.container.platformDigest}`;
  if (reference.container.runtimeImage !== expectedImage) {
    throw new ContractError(
      "FADENO_K0_ENVIRONMENT_MISMATCH",
      "reference runtime image is not bound to the platform digest",
    );
  }
  return reference;
}

export function loadReferenceEnvironment(root, validators = createContractValidators(root)) {
  return assertReferenceSemantics(
    assertSchema(
      validators.reference,
      readJsonDocument(join(root, "experiments/reference-environment.json")),
      "reference environment",
    ),
  );
}

export function loadExperimentRegistry(root, validators = createContractValidators(root)) {
  const registry = assertSchema(
    validators.registry,
    readJsonDocument(join(root, "experiments/registry.json")),
    "experiment registry",
  );
  assertRegistrySemantics(registry);
  return registry;
}
