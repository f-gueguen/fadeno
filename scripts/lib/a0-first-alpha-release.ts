import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createA0DocumentationManifest,
  validateA0DocumentationManifest,
} from "./a0-docs-artifact.ts";
import {
  A0_DISTRIBUTION_TAG,
  A0_FIRST_ALPHA_CHANGESETS,
  A0_FIRST_ALPHA_TAG,
  A0_FIRST_ALPHA_VERSION,
  A0_PACKAGE_NAME,
  A0_SEED_VERSION,
} from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0FirstAlphaReleaseContext = Readonly<{
  manifest: unknown;
  prerelease: unknown;
  changelog: string;
  sbom: unknown;
  alphaCandidate: unknown;
  qualification: unknown;
  diagnostic: unknown;
  diagnosticHuman: string;
  correctionBefore: unknown;
  correctionAfter: unknown;
  flow: unknown;
  recovery: unknown;
  docsManifest: unknown;
  releaseNotes: string;
  migration: string;
  rootReadme: string;
  packageReadme: string;
  support: string;
  releasePolicy: string;
  roadmap: string;
  ledger: string;
  scope: string;
  traceability: string;
  workflow: string;
  workspace: unknown;
  privateExamples: readonly unknown[];
  tracked: ReadonlySet<string>;
  documentationRoot: string;
}>;

const requiredPaths = Object.freeze([
  ".changeset/pre.json",
  ".github/workflows/publish.yml",
  "docs/releases/0.1.0-alpha.0.md",
  "evidence/a0/qualification/alpha-candidate.json",
  "evidence/a0/release/docs-manifest.json",
  "evidence/a0/release/source/qualification.json",
  "evidence/a0/release/source/diagnostic.json",
  "evidence/a0/release/source/diagnostic-human.txt",
  "evidence/a0/release/source/correction-before.json",
  "evidence/a0/release/source/correction-after.json",
  "evidence/a0/release/source/flow.json",
  "evidence/a0/release/source/recovery.json",
  "scripts/build-a0-docs-artifact.ts",
  "scripts/check-a0-first-alpha-release.ts",
  "scripts/generate-a0-docs-manifest.ts",
  "scripts/lib/a0-docs-artifact.ts",
  "scripts/lib/a0-first-alpha-release.ts",
  "scripts/lib/a0-public-alpha.ts",
  "scripts/lib/a0-release-identity.ts",
  "scripts/test-a0-first-alpha-release.ts",
  "scripts/test-a0-public-alpha-contract.ts",
  "scripts/verify-a0-public-alpha.ts",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: unknown, expected: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, " ");
}

function readJson(read: (path: string) => string, path: string): unknown {
  return JSON.parse(read(path)) as unknown;
}

export function loadA0FirstAlphaReleaseContext(
  root: string,
  tracked: ReadonlySet<string>,
): A0FirstAlphaReleaseContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    manifest: readJson(read, "packages/framework/package.json"),
    prerelease: readJson(read, ".changeset/pre.json"),
    changelog: read("packages/framework/CHANGELOG.md"),
    sbom: readJson(read, "packages/framework/sbom.spdx.json"),
    alphaCandidate: readJson(read, "evidence/a0/qualification/alpha-candidate.json"),
    qualification: readJson(read, "evidence/a0/release/source/qualification.json"),
    diagnostic: readJson(read, "evidence/a0/release/source/diagnostic.json"),
    diagnosticHuman: read("evidence/a0/release/source/diagnostic-human.txt"),
    correctionBefore: readJson(read, "evidence/a0/release/source/correction-before.json"),
    correctionAfter: readJson(read, "evidence/a0/release/source/correction-after.json"),
    flow: readJson(read, "evidence/a0/release/source/flow.json"),
    recovery: readJson(read, "evidence/a0/release/source/recovery.json"),
    docsManifest: readJson(read, "evidence/a0/release/docs-manifest.json"),
    releaseNotes: read("docs/releases/0.1.0-alpha.0.md"),
    migration: read("docs/migrations/first-alpha-candidate.md"),
    rootReadme: read("README.md"),
    packageReadme: read("packages/framework/README.md"),
    support: read("SUPPORT.md"),
    releasePolicy: read("docs/release-policy.md"),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    workflow: read(".github/workflows/publish.yml"),
    workspace: readJson(read, "package.json"),
    privateExamples: Object.freeze([
      readJson(read, "examples/adapter-smoke/package.json"),
      readJson(read, "examples/v1-app/package.json"),
    ]),
    tracked,
    documentationRoot: root,
  });
}

export function validateA0FirstAlphaRelease(context: A0FirstAlphaReleaseContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) errors.push(`A0 first-alpha evidence is not tracked: ${path}`);
  }

  const manifest = context.manifest;
  if (!isRecord(manifest)
    || manifest["name"] !== A0_PACKAGE_NAME
    || manifest["version"] !== A0_FIRST_ALPHA_VERSION
    || Object.hasOwn(manifest, "private")
    || !isRecord(manifest["publishConfig"])
    || !exact(manifest["publishConfig"], {
      access: "public", provenance: true, registry: "https://registry.npmjs.org/", tag: A0_DISTRIBUTION_TAG,
    })) errors.push("FADENO_A0_RELEASE_SOURCE_VERSION");

  const prerelease = context.prerelease;
  if (!isRecord(prerelease)
    || prerelease["mode"] !== "pre"
    || prerelease["tag"] !== A0_DISTRIBUTION_TAG
    || !isRecord(prerelease["initialVersions"])
    || prerelease["initialVersions"][A0_PACKAGE_NAME] !== A0_SEED_VERSION
    || !exact(prerelease["changesets"], A0_FIRST_ALPHA_CHANGESETS)) {
    errors.push("A0 first-alpha prerelease intent drifted");
  }
  for (const example of context.privateExamples) {
    if (!isRecord(example) || example["private"] !== true || example["version"] !== "0.0.0") {
      errors.push("A0 first-alpha versioned a private example");
    }
  }

  const candidate = context.alphaCandidate;
  if (!isRecord(candidate)
    || candidate["status"] !== "qualified-alpha-candidate"
    || candidate["sourceVersion"] !== A0_SEED_VERSION
    || candidate["expectedReleaseVersion"] !== A0_FIRST_ALPHA_VERSION
    || candidate["publicationAttempted"] !== false) {
    errors.push("A0 first-alpha prior qualification drifted");
  }

  const expectedQualification = {
    schemaVersion: 1,
    milestone: "A0-10",
    phase: "release-source",
    status: "qualified-release-source",
    package: A0_PACKAGE_NAME,
    version: A0_FIRST_ALPHA_VERSION,
    sourceTag: A0_FIRST_ALPHA_TAG,
    distributionTag: A0_DISTRIBUTION_TAG,
    priorQualification: "qualified-alpha-candidate",
    publicationAttempted: false,
    exactCommitQualificationRequired: true,
    changesets: A0_FIRST_ALPHA_CHANGESETS,
    documentationManifest: "evidence/a0/release/docs-manifest.json",
    documentationArtifact: `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`,
    publicationWorkflow: ".github/workflows/publish.yml",
    publicationEnvironment: "npm-production",
    postPublicationVerification: "pnpm verify:a0-public-alpha",
  };
  if (!exact(context.qualification, expectedQualification)) errors.push("A0 first-alpha source qualification drifted");

  if (!isRecord(context.diagnostic)
    || context.diagnostic["code"] !== "FADENO_A0_RELEASE_SOURCE_VERSION"
    || context.diagnostic["observedVersion"] !== A0_SEED_VERSION
    || context.diagnostic["expectedVersion"] !== A0_FIRST_ALPHA_VERSION
    || context.diagnostic["publicationAttempted"] !== false
    || !context.diagnosticHuman.startsWith("FADENO_A0_RELEASE_SOURCE_VERSION:")) {
    errors.push("A0 first-alpha refusal evidence drifted");
  }
  if (!exact(context.correctionBefore, {
    packageVersion: A0_SEED_VERSION, prereleaseMode: null, sourceTag: null, publicationAllowed: false,
  }) || !exact(context.correctionAfter, {
    packageVersion: A0_FIRST_ALPHA_VERSION,
    prereleaseMode: A0_DISTRIBUTION_TAG,
    sourceTag: A0_FIRST_ALPHA_TAG,
    publicationAllowed: "only-after-exact-main-local-ci",
  })) errors.push("A0 first-alpha correction evidence drifted");
  if (!isRecord(context.flow)
    || context.flow["observableOutcome"] !== "locally-qualified-first-alpha-release-source"
    || !Array.isArray(context.flow["skippedWork"])
    || context.flow["skippedWork"].length !== 3) errors.push("A0 first-alpha flow evidence drifted");
  if (!isRecord(context.recovery)
    || context.recovery["refusedCode"] !== "FADENO_A0_RELEASE_SOURCE_VERSION"
    || context.recovery["incorrectVersionPublished"] !== false
    || context.recovery["tagCreatedBeforeQualification"] !== false
    || context.recovery["staleDiagnosticPresent"] !== false
    || context.recovery["correctedVersion"] !== A0_FIRST_ALPHA_VERSION) {
    errors.push("A0 first-alpha recovery evidence drifted");
  }

  let expectedDocs;
  try { expectedDocs = createA0DocumentationManifest(context.documentationRoot, context.tracked); }
  catch { errors.push("A0 first-alpha documentation source invalid"); }
  if (expectedDocs) errors.push(...validateA0DocumentationManifest(context.docsManifest, expectedDocs));

  const changelog = normalized(context.changelog);
  for (const fragment of [
    `## ${A0_FIRST_ALPHA_VERSION}`,
    "first public alpha package",
    "fadeno create",
    "application-test workflow",
    "deployment-artifact command",
    "malformed configuration and environment file bytes",
  ]) if (!changelog.includes(fragment)) errors.push(`A0 first-alpha changelog is missing ${fragment}`);
  for (const [name, content, fragments] of [
    ["release notes", context.releaseNotes, [A0_FIRST_ALPHA_VERSION, `@fadeno/framework@${A0_FIRST_ALPHA_VERSION}`, "not production-supported", "Independent newcomer usability", "no supported editor product or public analyzer schema", "generated provenance"]],
    ["migration", context.migration, [A0_FIRST_ALPHA_TAG, "Public registry verification", `@fadeno/framework@${A0_FIRST_ALPHA_VERSION}`]],
    ["root README", context.rootReadme, [A0_FIRST_ALPHA_VERSION, "experimental", "immutable tag", "public install verification"]],
    ["package README", context.packageReadme, [A0_FIRST_ALPHA_VERSION, "experimental", "not production-supported", "Independent newcomer usability"]],
    ["support", context.support, ["first public alpha", "not supported for production", "Independent newcomer usability", "not a supported protocol or public schema"]],
    ["release policy", context.releasePolicy, ["A0-10", "pnpm check:a0-first-alpha-release", "pnpm verify:a0-public-alpha"]],
  ] as const) {
    const prose = normalized(content);
    for (const fragment of fragments) if (!prose.includes(fragment)) errors.push(`${name} is missing ${fragment}`);
  }

  const workspace = context.workspace;
  const scripts = isRecord(workspace) && isRecord(workspace["scripts"]) ? workspace["scripts"] : null;
  if (!scripts
    || scripts["check:a0-first-alpha-release"] !== "node --no-warnings --experimental-strip-types scripts/check-a0-first-alpha-release.ts && node --no-warnings --experimental-strip-types scripts/test-a0-first-alpha-release.ts && node --no-warnings --experimental-strip-types scripts/test-a0-public-alpha-contract.ts && node --no-warnings --experimental-strip-types scripts/generate-a0-docs-manifest.ts --check"
    || typeof scripts["verify:a0-public-alpha"] !== "string"
    || typeof scripts["check"] !== "string"
    || !scripts["check"].includes("pnpm check:a0-first-alpha-release")) {
    errors.push("workspace check does not enforce A0 first-alpha release source");
  }
  if (!context.workflow.includes("pnpm check:a0-first-alpha-release")
    || !context.workflow.includes("release:")
    || /^\s+(?:push|pull_request|workflow_dispatch|schedule):/mu.test(context.workflow)) {
    errors.push("A0 first-alpha publication workflow drifted");
  }
  const roadmapRow = context.roadmap.split("\n").find((line) => line.startsWith("| A0-10 |")) ?? "";
  if (!roadmapRow.includes("check:a0-first-alpha-release") || !roadmapRow.includes("verify:a0-public-alpha")) {
    errors.push("A0-10 roadmap validation drifted");
  }
  if (!normalized(context.ledger).includes("A0-10 — publish and verify the first immutable alpha release")) {
    errors.push("A0-10 ledger state drifted");
  }
  for (const feature of ["CLI-01", "DOC-01", "REL-01"]) {
    const scopeRow = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const traceRow = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scopeRow.includes("check:a0-first-alpha-release") || !traceRow.includes("check:a0-first-alpha-release")) {
      errors.push(`${feature} is missing A0 first-alpha release traceability`);
    }
  }
  return Object.freeze(errors);
}
