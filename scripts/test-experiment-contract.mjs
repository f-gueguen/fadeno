import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ContractError,
  MAX_JSON_BYTES,
  assertContainedArtifact,
  normalizeRegistry,
  parseJsonBuffer,
  readJsonDocument,
  registryLoadFailureResult,
  stableRegistryListing,
  validateArtifactRecords,
  validateManifestSemantics,
} from "./lib/experiment-contract.mjs";
import {
  createContractValidators,
  loadExperimentRegistry,
  loadReferenceEnvironment,
} from "./lib/experiment-validation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "experiments/contract/fixtures");
const validators = createContractValidators(root);
const { registry: registrySchema, manifest: manifestSchema } = validators;
const reference = loadReferenceEnvironment(root, validators);
const registry = loadExperimentRegistry(root, validators);
const failures = [];

function recordFailure(message) {
  failures.push(message);
}

function expectContractError(name, expectedCode, action) {
  try {
    action();
    recordFailure(`${name}: expected ${expectedCode}`);
  } catch (error) {
    if (!(error instanceof ContractError)) {
      recordFailure(`${name}: unexpected ${error.stack ?? error}`);
    } else if (error.code !== expectedCode) {
      recordFailure(`${name}: expected ${expectedCode}, received ${error.code}`);
    }
  }
}

function mutate(document, mutation) {
  const copy = structuredClone(document);
  const segments = mutation.pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent = copy;
  for (const segment of segments.slice(0, -1)) parent = parent[segment];
  const key = segments.at(-1);
  if (mutation.operation === "delete") delete parent[key];
  else if (mutation.operation === "set") parent[key] = mutation.value;
  else if (mutation.operation === "append") parent[key].push(mutation.value);
  else throw new Error(`unsupported mutation operation: ${mutation.operation}`);
  return copy;
}

const fixtureIndex = readJsonDocument(join(fixtureRoot, "index.json"));
const expectedMutationNames = [
  "missing-source-commit",
  "path-escape",
  "negative-repetitions",
  "invalid-calendar-timestamp",
  "unexpected-secret-property",
  "environment-digest-mismatch",
  "time-order",
  "failed-background-preflight",
  "artifact-hash-mismatch",
  "unknown-experiment",
  "conclusion-mismatch",
  "duplicate-measurement",
  "duplicate-artifact",
  "unrecorded-failure-artifact",
  "missing-artifact",
];
if (
  JSON.stringify(fixtureIndex.mutations.map((fixture) => fixture.name)) !==
  JSON.stringify(expectedMutationNames)
) {
  recordFailure("fixture index: mutation cases differ from the required negative corpus");
}
const expectedRawCases = [
  ["raw/duplicate-key.json", "FADENO_K0_JSON_DUPLICATE_KEY"],
  ["raw/non-finite.json", "FADENO_K0_JSON_SYNTAX"],
  ["raw/prototype-key.json", "FADENO_K0_JSON_PROTOTYPE_KEY"],
  ["raw/truncated.json", "FADENO_K0_JSON_SYNTAX"],
];
if (
  JSON.stringify(fixtureIndex.raw.map((fixture) => [fixture.path, fixture.code])) !==
  JSON.stringify(expectedRawCases)
) {
  recordFailure("fixture index: raw cases differ from the required negative corpus");
}
const expectedSyntheticCodes = [
  "FADENO_K0_JSON_TOO_LARGE",
  "FADENO_K0_JSON_ENCODING",
  "FADENO_K0_JSON_BOM",
  "FADENO_K0_PATH_ESCAPE",
];
if (JSON.stringify(fixtureIndex.synthetic) !== JSON.stringify(expectedSyntheticCodes)) {
  recordFailure("fixture index: synthetic cases differ from the executed contract cases");
}

const baseManifestPath = join(fixtureRoot, fixtureIndex.valid[0]);
const baseManifest = readJsonDocument(baseManifestPath);
if (!manifestSchema(baseManifest)) {
  recordFailure(`base manifest: ${validators.ajv.errorsText(manifestSchema.errors)}`);
}

for (const mutation of fixtureIndex.mutations) {
  const document = mutate(baseManifest, mutation);
  const schemaValid = manifestSchema(document);

  if (mutation.stage === "schema") {
    if (schemaValid) {
      recordFailure(`${mutation.name}: schema unexpectedly passed`);
      continue;
    }
    const intended = manifestSchema.errors?.some(
      (error) =>
        error.keyword === mutation.keyword && error.instancePath === mutation.instancePath,
    );
    if (!intended) {
      recordFailure(
        `${mutation.name}: failed for wrong reason: ${JSON.stringify(manifestSchema.errors)}`,
      );
    }
    continue;
  }

  if (!schemaValid) {
    recordFailure(`${mutation.name}: expected schema pass before ${mutation.stage}`);
    continue;
  }
  expectContractError(mutation.name, mutation.code, () => {
    validateManifestSemantics(document, reference, registry);
    if (mutation.stage === "artifact") validateArtifactRecords(document, baseManifestPath);
  });
}

for (const fixture of fixtureIndex.raw) {
  expectContractError(fixture.path, fixture.code, () => {
    readJsonDocument(join(fixtureRoot, fixture.path));
  });
}

expectContractError("oversized JSON", "FADENO_K0_JSON_TOO_LARGE", () => {
  parseJsonBuffer(Buffer.alloc(MAX_JSON_BYTES + 1, 0x20), "synthetic oversized");
});
expectContractError("invalid UTF-8", "FADENO_K0_JSON_ENCODING", () => {
  parseJsonBuffer(Buffer.from([0xc3, 0x28]), "synthetic invalid UTF-8");
});
expectContractError("UTF-8 BOM", "FADENO_K0_JSON_BOM", () => {
  parseJsonBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "synthetic BOM");
});

const symlinkRoot = mkdtempSync(join(tmpdir(), "fadeno-k0-path-"));
try {
  const resultRoot = join(symlinkRoot, "result");
  const outside = join(symlinkRoot, "outside.json");
  mkdirSync(resultRoot);
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, join(resultRoot, "escape.json"));
  expectContractError("symlink escape", "FADENO_K0_PATH_ESCAPE", () => {
    assertContainedArtifact(resultRoot, "escape.json");
  });
} finally {
  rmSync(symlinkRoot, { recursive: true, force: true });
}

const shortRegistry = structuredClone(registry);
shortRegistry.experiments.pop();
if (registrySchema(shortRegistry)) recordFailure("short registry: schema unexpectedly passed");

const reorderedRegistry = structuredClone(registry);
reorderedRegistry.experiments.reverse();
expectContractError("registry ordering", "FADENO_K0_REGISTRY_INVALID", () => {
  normalizeRegistry(reorderedRegistry);
});

const escapingRegistry = structuredClone(registry);
escapingRegistry.experiments[0].directory = "../extraction";
if (registrySchema(escapingRegistry)) {
  recordFailure("escaping registry: schema unexpectedly passed");
}

const registryFailureResult = registryLoadFailureResult(
  new ContractError("FADENO_K0_SCHEMA_REJECTED", "fixture rejection"),
);
if (
  registryFailureResult.exitCode !== 65 ||
  registryFailureResult.stdout !== "" ||
  registryFailureResult.stderr !==
    "FADENO_K0_003: experiment registry is invalid (FADENO_K0_SCHEMA_REJECTED).\n"
) {
  recordFailure(`registry failure diagnostic drift: ${JSON.stringify(registryFailureResult)}`);
}

const cliPath = join(root, "scripts/experiment-all.mjs");
const commandCases = [
  {
    name: "list",
    args: ["--list"],
    status: 0,
    stdout: stableRegistryListing(registry),
    stderr: "",
  },
  {
    name: "unavailable",
    args: [],
    status: 2,
    stdout: "",
    stderr:
      "FADENO_K0_001: experiment execution is unavailable in K0-01; use --list to inspect the approved plan.\n",
  },
  {
    name: "unsupported",
    args: ["--unknown"],
    status: 64,
    stdout: "",
    stderr: "FADENO_K0_002: unsupported argument: --unknown\n",
  },
];
for (const fixture of commandCases) {
  const result = spawnSync(process.execPath, [cliPath, ...fixture.args], {
    cwd: root,
    encoding: "utf8",
  });
  if (
    result.status !== fixture.status ||
    result.stdout !== fixture.stdout ||
    result.stderr !== fixture.stderr
  ) {
    recordFailure(`${fixture.name} command contract failed: ${JSON.stringify(result)}`);
  }
}

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const fixture of commandCases.slice(0, 2)) {
  const result = spawnSync(
    pnpmExecutable,
    ["--silent", "experiment:all", ...fixture.args],
    { cwd: root, encoding: "utf8" },
  );
  if (
    result.status !== fixture.status ||
    result.stdout !== fixture.stdout ||
    result.stderr !== fixture.stderr
  ) {
    recordFailure(`${fixture.name} pnpm contract failed: ${JSON.stringify(result)}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const negativeCount =
  fixtureIndex.mutations.length + fixtureIndex.raw.length + fixtureIndex.synthetic.length + 4;
console.log(`experiment contract negative tests passed (${negativeCount} cases)`);
