import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  A0_FIRST_ALPHA_CHANGESETS,
  A0_FIRST_ALPHA_VERSION,
  A0_PACKAGE_NAME,
  A0_SEED_VERSION,
} from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0ReleaseContext = Readonly<{
  adr: string;
  adrIndex: string;
  manifest: unknown;
  changesetConfig: unknown;
  changeset: string;
  prerelease: unknown;
  changelog: string;
  packageReadme: string;
  packageLicense: string;
  rootLicense: string;
  sbom: unknown;
  workflow: string;
  releasePolicy: string;
  buildSpecification: string;
  scope: string;
  traceability: string;
  roadmap: string;
  ledger: string;
  migrationSeed: string;
  firstAlphaPlan: unknown;
  publicationRefusals: unknown;
  publicationRefusalHuman: string;
  flow: unknown;
  recovery: unknown;
  rollbackPublic: unknown;
  rollbackPrivate: unknown;
  legacyReferences: readonly string[];
  tracked: ReadonlySet<string>;
}>;

const requiredPaths = Object.freeze([
  ".changeset/config.json",
  ".changeset/early-fadeno-alpha.md",
  ".changeset/pre.json",
  ".github/workflows/publish.yml",
  "docs/adr/0038-alpha-version-and-release-train.md",
  "packages/framework/CHANGELOG.md",
  "packages/framework/LICENSE",
  "packages/framework/README.md",
  "packages/framework/sbom.spdx.json",
  "evidence/a0/release/first-alpha-plan.json",
  "evidence/a0/release/publication-refusals.json",
  "evidence/a0/release/publication-refusal-human.txt",
  "evidence/a0/release/flow.json",
  "evidence/a0/release/recovery.json",
  "evidence/a0/release/rollback-public-seed.json",
  "evidence/a0/release/rollback-private-restored.json",
  "scripts/assert-a0-publication.ts",
  "scripts/generate-a0-sbom.ts",
]);

const legacyAllowed = new Set([
  "docs/adr/0024-initial-package-boundary.md",
  "docs/adr/0037-public-package-identity-and-publication.md",
  "evidence/a0/release/rollback-private-restored.json",
]);
const legacyPackageName = ["fadeno", "framework", "internal"].join("-");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadA0ReleaseContext(root: string, tracked: ReadonlySet<string>): A0ReleaseContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  const legacyReferences: string[] = [];
  for (const path of tracked) {
    if (legacyAllowed.has(path) || path.startsWith("evidence/")) continue;
    try {
      if (read(path).includes(legacyPackageName)) legacyReferences.push(path);
    } catch { /* non-text or unavailable tracked content is checked elsewhere */ }
  }
  return Object.freeze({
    adr: read("docs/adr/0038-alpha-version-and-release-train.md"),
    adrIndex: read("docs/adr/README.md"),
    manifest: JSON.parse(read("packages/framework/package.json")) as unknown,
    changesetConfig: JSON.parse(read(".changeset/config.json")) as unknown,
    changeset: read(".changeset/early-fadeno-alpha.md"),
    prerelease: JSON.parse(read(".changeset/pre.json")) as unknown,
    changelog: read("packages/framework/CHANGELOG.md"),
    packageReadme: read("packages/framework/README.md"),
    packageLicense: read("packages/framework/LICENSE"),
    rootLicense: read("LICENSE"),
    sbom: JSON.parse(read("packages/framework/sbom.spdx.json")) as unknown,
    workflow: read(".github/workflows/publish.yml"),
    releasePolicy: read("docs/release-policy.md"),
    buildSpecification: read("docs/spec/build-adapters-testing.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    migrationSeed: read("docs/migrations/v1-private-preview.md"),
    firstAlphaPlan: JSON.parse(read("evidence/a0/release/first-alpha-plan.json")) as unknown,
    publicationRefusals: JSON.parse(read("evidence/a0/release/publication-refusals.json")) as unknown,
    publicationRefusalHuman: read("evidence/a0/release/publication-refusal-human.txt"),
    flow: JSON.parse(read("evidence/a0/release/flow.json")) as unknown,
    recovery: JSON.parse(read("evidence/a0/release/recovery.json")) as unknown,
    rollbackPublic: JSON.parse(read("evidence/a0/release/rollback-public-seed.json")) as unknown,
    rollbackPrivate: JSON.parse(read("evidence/a0/release/rollback-private-restored.json")) as unknown,
    legacyReferences: Object.freeze(legacyReferences.sort()),
    tracked,
  });
}

export function validateA0Release(context: A0ReleaseContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) errors.push(`A0 release evidence is not tracked: ${path}`);
  }
  for (const required of ["- Status: Accepted", "Changesets `2.31.1`", "`0.0.0`", "`0.1.0-alpha.0`", "A0-10", "prepublication guard", "never published"]) {
    if (!context.adr.includes(required)) errors.push(`ADR 0038 is missing ${required}`);
  }
  if (!context.adrIndex.includes("0038-alpha-version-and-release-train.md")) errors.push("ADR 0038 is not indexed");

  const config = context.changesetConfig;
  if (!isRecord(config)
    || config["changelog"] !== "@changesets/cli/changelog"
    || config["commit"] !== false
    || config["access"] !== "public"
    || config["baseBranch"] !== "main"
    || JSON.stringify(config["fixed"]) !== "[]"
    || JSON.stringify(config["linked"]) !== "[]"
    || JSON.stringify(config["ignore"]) !== "[]") {
    errors.push("Changesets configuration drifted");
  }
  if (!context.changeset.startsWith("---\n\"@fadeno/framework\": minor\n---\n")
    || !context.changeset.includes("first public alpha package")) {
    errors.push("first alpha Changeset drifted");
  }
  const prerelease = context.prerelease;
  if (!isRecord(prerelease)
    || prerelease["mode"] !== "pre"
    || prerelease["tag"] !== "alpha"
    || !isRecord(prerelease["initialVersions"])
    || prerelease["initialVersions"][A0_PACKAGE_NAME] !== A0_SEED_VERSION
    || prerelease["initialVersions"]["fadeno-adapter-smoke"] !== "0.0.0"
    || prerelease["initialVersions"]["fadeno-v1-app-example"] !== "0.0.0"
    || JSON.stringify(prerelease["changesets"]) !== JSON.stringify(A0_FIRST_ALPHA_CHANGESETS)) {
    errors.push("first-alpha prerelease state drifted");
  }

  const manifest = context.manifest;
  const publishConfig = isRecord(manifest) ? manifest["publishConfig"] : null;
  const repository = isRecord(manifest) ? manifest["repository"] : null;
  if (!isRecord(manifest)
    || manifest["name"] !== A0_PACKAGE_NAME
    || manifest["version"] !== A0_FIRST_ALPHA_VERSION
    || Object.hasOwn(manifest, "private")
    || manifest["license"] !== "MIT"
    || !isRecord(repository)
    || repository["url"] !== "https://github.com/f-gueguen/fadeno.git"
    || repository["directory"] !== "packages/framework"
    || !isRecord(publishConfig)
    || publishConfig["access"] !== "public"
    || publishConfig["provenance"] !== true
    || publishConfig["registry"] !== "https://registry.npmjs.org/"
    || publishConfig["tag"] !== "alpha") {
    errors.push("public package release metadata drifted");
  }
  if (isRecord(manifest)) {
    const files = manifest["files"];
    const scripts = manifest["scripts"];
    if (JSON.stringify(files) !== JSON.stringify(["CHANGELOG.md", "LICENSE", "dist", "README.md", "sbom.spdx.json"])) {
      errors.push("public package content allowlist drifted");
    }
    if (!isRecord(scripts)
      || !String(scripts["prepack"]).includes("generate-a0-sbom.ts --check")
      || !String(scripts["prepublishOnly"]).includes("assert-a0-publication.ts")) {
      errors.push("public package lifecycle guards drifted");
    }
  }

  if (context.packageLicense !== context.rootLicense) errors.push("package license differs from repository license");
  if (!context.changelog.includes(`## ${A0_FIRST_ALPHA_VERSION}`)
    || !context.changelog.includes("### Minor Changes")
    || !context.changelog.includes("### Patch Changes")
    || !context.changelog.includes("first public alpha package")
    || context.changelog.includes("No public version has")) {
    errors.push("first-alpha changelog drifted");
  }
  if (!context.packageReadme.includes(`first public alpha (\`${A0_FIRST_ALPHA_VERSION}\`)`)
    || !context.packageReadme.includes("production-supported")
    || !context.packageReadme.includes("experimental")
    || !context.packageReadme.includes("Independent newcomer usability")) {
    errors.push("package README release status drifted");
  }

  const sbom = context.sbom;
  if (!isRecord(sbom)
    || sbom["spdxVersion"] !== "SPDX-2.3"
    || sbom["documentNamespace"] !== `https://fadeno.dev/sbom/framework/${A0_FIRST_ALPHA_VERSION}`
    || !Array.isArray(sbom["packages"])
    || !(sbom["packages"] as unknown[]).some((entry) => isRecord(entry) && entry["name"] === A0_PACKAGE_NAME && entry["versionInfo"] === A0_FIRST_ALPHA_VERSION)
    || !(sbom["packages"] as unknown[]).some((entry) => isRecord(entry) && entry["name"] === "typescript" && entry["versionInfo"] === "7.0.2")) {
    errors.push("normalized SPDX SBOM drifted");
  }

  for (const required of [
    "release:", "types: [published]", "id-token: write", "environment: npm-production",
    "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
    "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    "pnpm install --frozen-lockfile", "pnpm check:a0-release",
    "npm publish ./packages/framework --access public --tag alpha",
    "vars.NPM_RELEASE_MODE", "vars.FADENO_QUALIFIED_COMMIT",
    "FADENO_RELEASE_REPOSITORY_VISIBILITY", "github.repository_visibility",
  ]) {
    if (!context.workflow.includes(required)) errors.push(`publication workflow is missing ${required}`);
  }
  if (/^\s+(?:push|pull_request):/mu.test(context.workflow)) errors.push("publication workflow became merge CI");
  for (const forbidden of ["NPM_BOOTSTRAP_TOKEN", "revoke:a0-bootstrap-token", "FADENO_RELEASE_MODE == 'bootstrap'"]) {
    if (context.workflow.includes(forbidden)) errors.push(`publication workflow retains bootstrap authority: ${forbidden}`);
  }

  for (const [name, content, required] of [
    ["release policy", context.releasePolicy, ["ADR 0038", "`0.1.0-alpha.0`", "pending Changeset", "deterministic SPDX SBOM", "pnpm check:a0-release"]],
    ["build specification", context.buildSpecification, ["ADR 0038", "`0.1.0-alpha.0`", "prepublication guard", "normalized SPDX SBOM"]],
    ["A0 roadmap", context.roadmap, ["`pnpm check:a0-release`", "`pnpm check:v1-public-package`"]],
    ["current ledger", context.ledger, ["A0-03", "SPDX SBOM", "public-name migration"]],
  ] as const) {
    for (const fragment of required) if (!content.includes(fragment)) errors.push(`${name} is missing ${fragment}`);
  }
  for (const feature of ["GOV-01", "BUILD-01", "CLI-01", "REL-01"]) {
    const scopeRow = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const traceRow = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scopeRow.includes("ADR 0038")) errors.push(`${feature} scope is missing ADR 0038`);
    if (!traceRow.includes("ADR 0038") || !traceRow.includes("pnpm check:a0-release")) errors.push(`${feature} traceability is missing A0 release evidence`);
  }
  if (!context.migrationSeed.includes("no published package") || !context.migrationSeed.includes("no prerelease exists yet")) {
    errors.push("migration seed claims a released version");
  }

  const plan = context.firstAlphaPlan;
  if (!isRecord(plan) || plan["seedVersion"] !== "0.0.0" || plan["expectedVersion"] !== "0.1.0-alpha.0" || plan["publicationAttempted"] !== false) {
    errors.push("normalized first alpha plan drifted");
  }
  const refusals = context.publicationRefusals;
  const refusalCodes = isRecord(refusals) && Array.isArray(refusals["scenarios"])
    ? (refusals["scenarios"] as unknown[]).flatMap((entry) => isRecord(entry) && typeof entry["code"] === "string" ? [entry["code"]] : [])
    : [];
  for (const code of ["FADENO_RELEASE_PRERELEASE_VERSION", "FADENO_RELEASE_PUBLIC_REPOSITORY", "FADENO_RELEASE_QUALIFIED_COMMIT", "FADENO_RELEASE_OIDC_UNAVAILABLE", "FADENO_RELEASE_TRUSTED_TOKEN_PRESENT"]) {
    if (!refusalCodes.includes(code)) errors.push(`publication refusal evidence is missing ${code}`);
  }
  if (!context.publicationRefusalHuman.includes("FADENO_RELEASE_PRERELEASE_VERSION")
    || !context.publicationRefusalHuman.includes("The unpublished 0.0.0 seed cannot be published")) {
    errors.push("human publication refusal evidence drifted");
  }
  if (!isRecord(context.flow) || context.flow["observableOutcome"] !== "publishable-tarball-without-registry-version") {
    errors.push("release flow evidence drifted");
  }
  if (!isRecord(context.recovery)
    || context.recovery["refusedCode"] !== "FADENO_RELEASE_PRERELEASE_VERSION"
    || context.recovery["retainedPackageVersion"] !== "0.0.0"
    || context.recovery["registryVersionCreated"] !== false
    || context.recovery["tagCreated"] !== false
    || context.recovery["outcome"] !== "clean-unpublished-seed") {
    errors.push("refused publication recovery evidence drifted");
  }
  if (!isRecord(context.rollbackPublic) || context.rollbackPublic["name"] !== "@fadeno/framework" || context.rollbackPublic["publicationAttempted"] !== false
    || !isRecord(context.rollbackPrivate) || context.rollbackPrivate["name"] !== legacyPackageName || context.rollbackPrivate["publicationAttempted"] !== false) {
    errors.push("prepublication rollback fixture drifted");
  }
  if (context.legacyReferences.length > 0) errors.push(`legacy package identity remains in current content: ${context.legacyReferences.join(", ")}`);
  return Object.freeze(errors);
}
