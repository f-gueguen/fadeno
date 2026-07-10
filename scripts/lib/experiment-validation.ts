import { join } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";

import {
  ContractError,
  assertRegistrySemantics,
  readJsonDocument,
} from "./experiment-contract.ts";

export const SCHEMA_FILES = [
  "reference-environment.schema.json",
  "experiment-registry.schema.json",
  "result-manifest.schema.json",
];

type AjvInstance = {
  addFormat(name: string, format: unknown): void;
  validateSchema(schema: unknown): boolean;
  compile(schema: unknown): ((document: unknown) => boolean) & { errors?: Array<Record<string, unknown>> };
  errors: unknown;
  errorsText(errors: unknown): string;
};

type SchemaValidator = ((document: unknown) => boolean) & {
  errors?: Array<Record<string, unknown>>;
};

type ContractValidators = {
  ajv: AjvInstance;
  schemas: Map<string, unknown>;
  reference: SchemaValidator;
  registry: SchemaValidator;
  manifest: SchemaValidator;
};

export type ReferenceEnvironment = {
  host: {
    provider: string;
    repositoryVisibility: string;
    runnerLabel: string;
    architecture: string;
    minimumHardware: {
      logicalCpuCount: number;
      memoryMiB: number;
      storageMiB: number;
    };
  };
  storage: { minimumFreeMiB: number };
  backgroundLoad: { maxLoadAverage1m: number; maxProcessCount: number };
  container: {
    registry: string;
    repository: string;
    tag: string;
    indexDigest: string;
    platform: string;
    platformDigest: string;
    configDigest: string;
    runtimeImage: string;
    executionUser: string;
    browserSandbox: string;
    networkPolicy: string;
    createdAt: string;
    verifiedAt: string;
  };
  toolchain: {
    node: string;
    pnpm: string;
    playwright: string;
    lockfile: string;
    lockHashAlgorithm: string;
  };
  browsers: { chromeForTesting: string; firefox: string; webkit: string };
};

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvInstance;

function isUtcTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(
    value,
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
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

function assertNoRemoteRefs(schema: unknown, label: string): void {
  function visit(value: unknown): void {
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

export function createContractValidators(root: string): ContractValidators {
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

export function assertSchema<T>(validator: SchemaValidator, document: T, label: string): T {
  if (!validator(document)) {
    throw new ContractError(
      "FADENO_K0_SCHEMA_REJECTED",
      `${label}: schema validation failed`,
      structuredClone(validator.errors),
    );
  }
  return document;
}

export function assertReferenceSemantics(reference: ReferenceEnvironment): ReferenceEnvironment {
  const expectedImage = `${reference.container.registry}/${reference.container.repository}@${reference.container.platformDigest}`;
  if (reference.container.runtimeImage !== expectedImage) {
    throw new ContractError(
      "FADENO_K0_ENVIRONMENT_MISMATCH",
      "reference runtime image is not bound to the platform digest",
    );
  }
  return reference;
}

export function loadReferenceEnvironment(
  root: string,
  validators: ContractValidators = createContractValidators(root),
): ReferenceEnvironment {
  return assertReferenceSemantics(
    assertSchema(
      validators.reference,
      readJsonDocument(join(root, "experiments/reference-environment.json")),
      "reference environment",
    ) as ReferenceEnvironment,
  );
}

export function loadExperimentRegistry(
  root: string,
  validators: ContractValidators = createContractValidators(root),
): any {
  const registry = assertSchema(
    validators.registry,
    readJsonDocument(join(root, "experiments/registry.json")),
    "experiment registry",
  );
  assertRegistrySemantics(registry);
  return registry;
}
