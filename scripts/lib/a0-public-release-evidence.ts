import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  A0_FIRST_ALPHA_TAG,
  A0_FIRST_ALPHA_VERSION,
  A0_PACKAGE_NAME,
} from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0PublicReleaseEvidenceContext = Readonly<{
  decision: string;
  decisionIndex: string;
  qualification: unknown;
  verification: unknown;
  diagnostics: unknown;
  diagnosticHuman: string;
  correctionBefore: unknown;
  correctionAfter: unknown;
  flow: unknown;
  recovery: unknown;
  workflow: string;
  workspace: unknown;
  releasePolicy: string;
  buildSpecification: string;
  scope: string;
  traceability: string;
  risks: string;
  roadmap: string;
  ledger: string;
  tracked: ReadonlySet<string>;
}>;

export const A0_FIRST_ALPHA_SOURCE_COMMIT = "4f30236d9734053cca0138ecfff5da1bbbdd1e18";

const requiredPaths = Object.freeze([
  "docs/adr/0044-first-alpha-registry-transport-reconciliation.md",
  "evidence/a0/release/public/qualification.json",
  "evidence/a0/release/public/verification.json",
  "evidence/a0/release/public/diagnostics.json",
  "evidence/a0/release/public/diagnostic-human.txt",
  "evidence/a0/release/public/correction-before.json",
  "evidence/a0/release/public/correction-after.json",
  "evidence/a0/release/public/flow.json",
  "evidence/a0/release/public/recovery.json",
  "scripts/check-a0-public-release.ts",
  "scripts/lib/a0-public-release-evidence.ts",
  "scripts/test-a0-public-release.ts",
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

export function loadA0PublicReleaseEvidenceContext(
  root: string,
  tracked: ReadonlySet<string>,
): A0PublicReleaseEvidenceContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    decision: read("docs/adr/0044-first-alpha-registry-transport-reconciliation.md"),
    decisionIndex: read("docs/adr/README.md"),
    qualification: readJson(read, "evidence/a0/release/public/qualification.json"),
    verification: readJson(read, "evidence/a0/release/public/verification.json"),
    diagnostics: readJson(read, "evidence/a0/release/public/diagnostics.json"),
    diagnosticHuman: read("evidence/a0/release/public/diagnostic-human.txt"),
    correctionBefore: readJson(read, "evidence/a0/release/public/correction-before.json"),
    correctionAfter: readJson(read, "evidence/a0/release/public/correction-after.json"),
    flow: readJson(read, "evidence/a0/release/public/flow.json"),
    recovery: readJson(read, "evidence/a0/release/public/recovery.json"),
    workflow: read(".github/workflows/publish.yml"),
    workspace: readJson(read, "package.json"),
    releasePolicy: read("docs/release-policy.md"),
    buildSpecification: read("docs/spec/build-adapters-testing.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    tracked,
  });
}

export function validateA0PublicReleaseEvidence(
  context: A0PublicReleaseEvidenceContext,
): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) errors.push(`A0 public-release evidence is not tracked: ${path}`);
  }

  const decision = normalized(context.decision);
  for (const fragment of [
    "- Status: Accepted",
    "exactly two",
    "registry-mandated `latest`",
    "cannot administer and revoke itself",
    "zero active tokens",
    "trusted publisher",
    "immutable",
    "no bootstrap secret or self-revocation step",
  ]) if (!decision.includes(fragment)) errors.push(`ADR 0044 is missing ${fragment}`);
  if (!context.decisionIndex.includes("0044-first-alpha-registry-transport-reconciliation.md")) {
    errors.push("ADR 0044 is not indexed");
  }

  if (!exact(context.qualification, {
    schemaVersion: 1,
    milestone: "A0-10",
    phase: "public-transport",
    status: "verified-public-alpha",
    package: A0_PACKAGE_NAME,
    version: A0_FIRST_ALPHA_VERSION,
    sourceCommit: A0_FIRST_ALPHA_SOURCE_COMMIT,
    sourceTag: A0_FIRST_ALPHA_TAG,
    releaseUrl: `https://github.com/f-gueguen/fadeno/releases/tag/${A0_FIRST_ALPHA_TAG}`,
    distributionAliases: { alpha: A0_FIRST_ALPHA_VERSION, latest: A0_FIRST_ALPHA_VERSION },
    packageAccess: "public",
    provenance: "signed-hosted-publication",
    documentationArtifactSha256: "920e20617497196433b67395b75b7b146f723cf24f3183c9031b9f791a6164d5",
    documentationReceiptSha256: "25df4167d4e48bd4627be0abd12d0112e423d8949cc80d93c37a49e933c4c7e5",
    verificationCommand: `pnpm verify:a0-public-alpha -- --source-commit ${A0_FIRST_ALPHA_SOURCE_COMMIT}`,
  })) errors.push("A0 public-release qualification drifted");

  if (!exact(context.verification, {
    schemaVersion: 1,
    milestone: "A0-10",
    status: "verified-public-alpha",
    package: A0_PACKAGE_NAME,
    version: A0_FIRST_ALPHA_VERSION,
    sourceTag: A0_FIRST_ALPHA_TAG,
    sourceCommit: A0_FIRST_ALPHA_SOURCE_COMMIT,
    distributionAliases: { alpha: A0_FIRST_ALPHA_VERSION, latest: A0_FIRST_ALPHA_VERSION },
    provenancePresent: true,
    packageTarballIntegrityVerified: true,
    packageSourceContentVerified: true,
    documentationArtifactVerified: true,
    publicWorkflows: ["install", "create", "test", "check", "build", "development", "start", "deploy", "rollback"],
    corruptedCandidateRefused: true,
    priorReleasePreserved: true,
  })) errors.push("A0 public-release live verification drifted");

  const diagnostics = isRecord(context.diagnostics) && Array.isArray(context.diagnostics["scenarios"])
    ? context.diagnostics["scenarios"]
    : [];
  const codes = diagnostics.flatMap((value) => isRecord(value) && typeof value["code"] === "string" ? [value["code"]] : []);
  for (const code of ["FADENO_A0_PUBLIC_DIST_TAG", "FADENO_A0_BOOTSTRAP_SELF_REVOCATION"]) {
    if (!codes.includes(code) || !context.diagnosticHuman.includes(`${code}:`)) {
      errors.push(`A0 public-release diagnostics are missing ${code}`);
    }
  }

  if (!exact(context.correctionBefore, {
    expectedDistributionAliases: { alpha: A0_FIRST_ALPHA_VERSION },
    credentialCleanupOwner: "hosted-package-token",
    bootstrapSecretPresent: true,
    trustedPublisherConfigured: false,
  }) || !exact(context.correctionAfter, {
    expectedDistributionAliases: { alpha: A0_FIRST_ALPHA_VERSION, latest: A0_FIRST_ALPHA_VERSION },
    credentialCleanupOwner: "maintainer-authenticated-registry-session",
    bootstrapSecretPresent: false,
    trustedPublisherConfigured: true,
  })) errors.push("A0 public-release correction drifted");

  const flow = context.flow;
  if (!isRecord(flow)
    || flow["operation"] !== "first-alpha-public-transport-reconciliation"
    || flow["observableOutcome"] !== "public-alpha-verified-and-bootstrap-credential-removed"
    || !Array.isArray(flow["causes"])
    || !Array.isArray(flow["skippedWork"])
    || flow["skippedWork"].length !== 3
    || !isRecord(flow["ownership"])) errors.push("A0 public-release flow drifted");

  const recovery = context.recovery;
  if (!isRecord(recovery)
    || recovery["staleDistributionDiagnosticPresent"] !== false
    || recovery["activeRegistryTokens"] !== 0
    || recovery["hostedBootstrapSecretPresent"] !== false
    || recovery["immutableReleaseChanged"] !== false
    || recovery["outcome"] !== "trusted-tokenless-publication-ready"
    || !exact(recovery["trustedPublisher"], {
      repository: "f-gueguen/fadeno",
      workflow: "publish.yml",
      environment: "npm-production",
      packageScope: "@fadeno",
      permission: "createPackage",
    })) errors.push("A0 public-release recovery drifted");

  for (const required of [
    "release:",
    "id-token: write",
    "environment: npm-production",
    "vars.NPM_RELEASE_MODE",
    "vars.FADENO_QUALIFIED_COMMIT",
    "github.repository_visibility",
    "npm publish ./packages/framework --access public --tag alpha",
  ]) if (!context.workflow.includes(required)) errors.push(`trusted publication workflow is missing ${required}`);
  for (const forbidden of ["NPM_BOOTSTRAP_TOKEN", "revoke:a0-bootstrap-token", "FADENO_RELEASE_MODE == 'bootstrap'"]) {
    if (context.workflow.includes(forbidden)) errors.push(`trusted publication workflow retains ${forbidden}`);
  }
  if (/^\s+(?:push|pull_request|workflow_dispatch|schedule):/mu.test(context.workflow)) {
    errors.push("trusted publication workflow became non-release automation");
  }

  const workspace = context.workspace;
  const scripts = isRecord(workspace) && isRecord(workspace["scripts"]) ? workspace["scripts"] : null;
  if (!scripts
    || scripts["check:a0-public-release"] !== "node --no-warnings --experimental-strip-types scripts/check-a0-public-release.ts && node --no-warnings --experimental-strip-types scripts/test-a0-public-release.ts && node --no-warnings --experimental-strip-types scripts/test-a0-public-alpha-contract.ts"
    || typeof scripts["check"] !== "string"
    || !scripts["check"].includes("pnpm check:a0-public-release")
    || scripts["check"].includes("pnpm check:a0-first-alpha-release")
    || Object.hasOwn(scripts, "revoke:a0-bootstrap-token")) {
    errors.push("workspace does not own the post-publication A0 gate");
  }

  for (const [name, content, fragments] of [
    ["release policy", context.releasePolicy, ["ADR 0044", "`alpha` and `latest`", "zero active tokens", "trusted publisher"]],
    ["build specification", context.buildSpecification, ["ADR 0044", "post-publication", "maintainer-authenticated", "immutable documentation manifest"]],
    ["risk ledger", context.risks, ["registry-mandated `latest`", "zero active tokens", "trusted publisher"]],
    ["A0 roadmap", context.roadmap, ["check:a0-public-release", "`alpha` and `latest`"]],
    ["roadmap ledger", context.ledger, ["verified public alpha", "check:a0-public-release", "zero active registry tokens"]],
  ] as const) {
    const prose = normalized(content);
    for (const fragment of fragments) if (!prose.includes(fragment)) errors.push(`${name} is missing ${fragment}`);
  }
  for (const feature of ["CLI-01", "DOC-01", "REL-01"]) {
    const scope = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const trace = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scope.includes("ADR 0044") || !scope.includes("check:a0-public-release")) {
      errors.push(`${feature} scope is missing public-release evidence`);
    }
    if (!trace.includes("ADR 0044") || !trace.includes("check:a0-public-release")) {
      errors.push(`${feature} traceability is missing public-release evidence`);
    }
  }

  return Object.freeze(errors);
}
