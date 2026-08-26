import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  readJsonDocument,
  validateArtifactRecords,
  validateManifestSemantics,
  validateSourceIntegrationAttestations,
  validateSourceIntegrationAttestationInventory,
} from "./lib/experiment-contract.ts";
import {
  assertSchema,
  createContractValidators,
  loadExperimentRegistry,
  loadReferenceEnvironment,
} from "./lib/experiment-validation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "experiments/contract/fixtures");
const require = createRequire(import.meta.url);
const failures = [];

function recordFailure(message) {
  failures.push(message);
}

const validators = createContractValidators(root);
const { ajv, schemas, manifest: manifestSchema } = validators;
const reference = loadReferenceEnvironment(root, validators);
const registry = loadExperimentRegistry(root, validators);
const sourceIntegrationAttestations = assertSchema(
  validators.sourceIntegration,
  readJsonDocument(join(root, "experiments/source-integration-attestations.json")),
  "source integration attestations",
);
validateSourceIntegrationAttestations(sourceIntegrationAttestations);
validateSourceIntegrationAttestationInventory(sourceIntegrationAttestations, root);

const packageJson = readJsonDocument(join(root, "package.json"));
const ajvPackage = require("ajv/package.json");
if (packageJson.devDependencies?.ajv !== "8.20.0") {
  recordFailure("package.json: Ajv must be pinned exactly to 8.20.0");
}
if (ajvPackage.version !== "8.20.0" || ajvPackage.license !== "MIT") {
  recordFailure(`installed Ajv identity mismatch: ${ajvPackage.version}/${ajvPackage.license}`);
}

const packageManager = `pnpm@${reference.toolchain.pnpm}`;
if (packageJson.packageManager !== packageManager) {
  recordFailure(`reference pnpm differs from packageManager ${packageJson.packageManager}`);
}

const expectedDirectories = registry.experiments.map((entry) => entry.directory);
for (const directory of expectedDirectories) {
  for (const child of ["README.md", "fixtures", "tests", "results"]) {
    if (!existsSync(join(root, "experiments", directory, child))) {
      recordFailure(`experiments/${directory}: missing ${child}`);
    }
  }
}
if (!existsSync(join(root, "experiments/revalidation/app"))) {
  recordFailure("experiments/revalidation: missing app directory required by K0 plan");
}
for (const path of [
  "experiments/extraction/fixtures/accepted",
  "experiments/extraction/fixtures/rejected",
  "experiments/type-spine/fixtures/valid",
  "experiments/type-spine/fixtures/invalid",
]) {
  if (!existsSync(join(root, path))) recordFailure(`${path}: missing K0 directory contract`);
}

function collectPackageFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectPackageFiles(path));
    if (entry.isFile() && entry.name === "package.json") found.push(path);
  }
  return found;
}
for (const path of collectPackageFiles(join(root, "experiments"))) {
  recordFailure(`${path}: experiment package boundaries are forbidden in K0-01`);
}

for (const entry of registry.experiments) {
  const scriptName = entry.command.slice("pnpm ".length);
  if (entry.status === "planned" && packageJson.scripts?.[scriptName] !== undefined) {
    recordFailure(`${entry.id}: planned experiment must not expose ${scriptName}`);
  }
  if (entry.status !== "planned" && packageJson.scripts?.[scriptName] === undefined) {
    recordFailure(`${entry.id}: ${entry.status} experiment is missing ${scriptName}`);
  }
}
if (
  packageJson.scripts?.["experiment:all"] !==
  "node --no-warnings --experimental-strip-types scripts/experiment-all.ts"
) {
  recordFailure("package.json: experiment:all does not own the aggregate contract");
}

const fixtureIndex = readJsonDocument(join(fixtureRoot, "index.json"));
const validDocuments = fixtureIndex.valid.map((path) => ({
  path: join(fixtureRoot, path),
  document: readJsonDocument(join(fixtureRoot, path)),
}));
for (const fixture of validDocuments) {
  if (!manifestSchema(fixture.document)) {
    recordFailure(`${fixture.path}: ${ajv.errorsText(manifestSchema.errors)}`);
    continue;
  }
  try {
    validateManifestSemantics(fixture.document, reference, registry);
      validateArtifactRecords(
        fixture.document,
        fixture.path,
        root,
        validators.sourceIntegration,
      );
  } catch (error) {
    recordFailure(`${fixture.path}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `experiment contract check passed (${schemas.size} schemas, ${validDocuments.length} valid manifest, ${registry.experiments.length} experiments)`,
);
