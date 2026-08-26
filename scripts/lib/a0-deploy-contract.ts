import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export interface A0DeployContext {
  readonly adr: string;
  readonly specification: string;
  readonly security: string;
  readonly scope: string;
  readonly traceability: string;
  readonly risks: string;
  readonly gates: string;
  readonly ledger: string;
  readonly implementation: string;
  readonly buildImplementation: string;
  readonly cli: string;
  readonly createImplementation: string;
  readonly generatedReadme: string;
  readonly rootPackage: unknown;
  readonly frameworkPackage: unknown;
  readonly documentationSource: unknown;
  readonly guideTemplate: string;
  readonly generatedGuide: string;
  readonly tracked: ReadonlySet<string>;
}

const requiredEvidence = Object.freeze([
  ".changeset/immutable-deployment-artifact.md",
  "docs/adr/0041-immutable-loopback-deployment-artifact.md",
  "examples/v1-app/scenarios/deployment/expected/artifact.json",
  "examples/v1-app/scenarios/deployment/expected/success.txt",
  "examples/v1-app/scenarios/deployment/expected/diagnostic-human.txt",
  "examples/v1-app/scenarios/deployment/expected/diagnostic.json",
  "examples/v1-app/scenarios/deployment/expected/correction-before.json",
  "examples/v1-app/scenarios/deployment/expected/correction-after.json",
  "examples/v1-app/scenarios/deployment/expected/flow.json",
  "examples/v1-app/scenarios/deployment/expected/recovery.json",
  "packages/framework/src/internal/project-deploy.ts",
  "scripts/check-a0-deploy.ts",
  "scripts/test-a0-deploy-contract.ts",
]);

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function contains(value: unknown, expected: string): boolean {
  return strings(value).includes(expected);
}

export function loadA0DeployContext(root: string, tracked: ReadonlySet<string>): A0DeployContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0041-immutable-loopback-deployment-artifact.md"),
    specification: read("docs/spec/build-adapters-testing.md"),
    security: read("docs/security/requirements.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    gates: read("docs/ledgers/decision-gates.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    implementation: read("packages/framework/src/internal/project-deploy.ts"),
    buildImplementation: read("packages/framework/src/internal/project-build.ts"),
    cli: read("packages/framework/src/cli.ts"),
    createImplementation: read("packages/framework/src/internal/project-create.ts"),
    generatedReadme: read("examples/v1-app/scenarios/project-creation/expected/app/README.md"),
    rootPackage: JSON.parse(read("package.json")) as unknown,
    frameworkPackage: JSON.parse(read("packages/framework/package.json")) as unknown,
    documentationSource: JSON.parse(read("examples/v1-app/documentation-source.json")) as unknown,
    guideTemplate: read("docs/templates/v1/getting-started.md.tmpl"),
    generatedGuide: read("docs/guides/getting-started.md"),
    tracked,
  });
}

export function validateA0Deploy(context: A0DeployContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredEvidence) {
    if (!context.tracked.has(path)) errors.push(`A0 deployment evidence is not tracked: ${path}`);
  }

  const normalizedAdr = context.adr.replace(/\s+/gu, " ");
  for (const value of [
    "- Status: Accepted",
    "fadeno deploy --project-root <path> --output <missing-path>",
    "same operating-system and architecture",
    "FADENO_ORIGIN",
    "FADENO_SESSION_KEYS",
    "GET of `/`",
    "SIGTERM",
    "previously healthy immutable directory",
    "no machine-output option",
  ]) {
    if (!normalizedAdr.includes(value)) errors.push(`ADR 0041 is missing ${value}`);
  }
  if (!context.specification.includes("ADR 0041 selects the exact public deployment form")
    || !context.specification.includes("pnpm check:a0-deploy")) {
    errors.push("deployment specification drifted");
  }
  if (!context.security.includes("ADR 0041") || !context.security.includes("operator-owned same-host HTTPS terminator")) {
    errors.push("deployment security boundary drifted");
  }
  if (context.gates.includes("| DG-A0-04 |")) errors.push("resolved deployment decision gate remains open");
  if (!context.ledger.includes("A0-06 — add the first supported deployment workflow")
    || !context.ledger.includes("ADR 0041")) {
    errors.push("A0-06 ledger status drifted");
  }
  const risk = context.risks.split("\n").find((line) => line.startsWith("| Deployment artifacts mix")) ?? "";
  if (!risk.includes("runtime manifest") || !risk.includes("prior directory")) {
    errors.push("deployment risk control drifted");
  }
  for (const feature of ["SEC-01", "BUILD-01", "CLI-01", "DOC-01"]) {
    const scope = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const trace = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scope.includes("ADR 0041") || !trace.includes("ADR 0041") || !trace.includes("check:a0-deploy")) {
      errors.push(`${feature} deployment traceability drifted`);
    }
  }

  for (const value of [
    'const usage = "FADENO_DEPLOY_USAGE: fadeno deploy --project-root <path> --output <missing-path>',
    'arguments_[0] !== "deploy"',
    'arguments_[3] !== "--output"',
    'difference !== ".." && !difference.startsWith(`..${sep}`)',
    "function outputEntryExists(path: string)",
    '["install", "--prod", "--frozen-lockfile", "--ignore-scripts"]',
    'writeFileSync(join(output, "package.json")',
    'unlinkSync(join(output, "pnpm-lock.yaml"))',
    "await assertPrivateDeploymentArtifact(output)",
    "rmSync(output, { recursive: true, force: true })",
  ]) {
    if (!context.implementation.includes(value)) errors.push(`deployment implementation is missing ${value}`);
  }
  if (!context.buildImplementation.includes("export async function assertPrivateDeploymentArtifact")
    || !context.buildImplementation.includes("for (const dependency of manifest.dependencies)")
    || !context.buildImplementation.includes("assertPrivateRuntimeIdentity(dependencyRoot, dependency.identity)")
    || !context.buildImplementation.includes("assertPrivateRuntimeIdentity(frameworkRoot, manifest.runtime)")) {
    errors.push("deployment artifact identity verification drifted");
  }
  if (!context.cli.includes('deploy: async () => (await import("./internal/project-deploy.ts")).runProjectDeployCommand(arguments_, context)')) {
    errors.push("public deploy command dispatch drifted");
  }
  if (!context.createImplementation.includes("fadeno deploy --project-root . --output ../releases/my-fadeno-app-001")
    || !context.generatedReadme.includes("fadeno deploy --project-root . --output ../releases/my-fadeno-app-001")) {
    errors.push("created-project deployment guidance drifted");
  }

  const frameworkPackage = context.frameworkPackage;
  if (!record(frameworkPackage) || !record(frameworkPackage["exports"])
    || Object.keys(frameworkPackage["exports"]).some((path) => path.includes("deploy"))) {
    errors.push("A0-06 introduced a public deployment export");
  }
  const rootPackage = context.rootPackage;
  if (!record(rootPackage) || !record(rootPackage["scripts"])
    || typeof rootPackage["scripts"]["check:a0-deploy"] !== "string"
    || !(rootPackage["scripts"]["check:a0-deploy"] as string).includes("test-a0-deploy-contract.ts")
    || !(rootPackage["scripts"]["check:a0-deploy"] as string).includes("check-a0-deploy.ts")
    || !(rootPackage["scripts"]["check"] as string).includes("pnpm check:a0-deploy")) {
    errors.push("check:a0-deploy command drifted");
  }
  const documentationSource = context.documentationSource;
  if (!record(documentationSource) || !contains(documentationSource["verificationGates"], "check:a0-deploy")) {
    errors.push("documentation source is missing check:a0-deploy");
  } else {
    const evidence = documentationSource["evidence"];
    if (!record(evidence)
      || !contains(evidence["success"], "scenarios/deployment/expected/artifact.json")
      || !contains(evidence["failure"], "scenarios/deployment/expected/diagnostic-human.txt")
      || !contains(evidence["correction"], "scenarios/deployment/expected/correction-before.json")
      || !contains(evidence["flow"], "scenarios/deployment/expected/flow.json")
      || !contains(evidence["recovery"], "scenarios/deployment/expected/recovery.json")
      || !contains(evidence["staleRemoval"], "scenarios/deployment/expected/recovery.json")) {
      errors.push("documentation source is missing complete A0 deployment evidence");
    }
  }
  for (const value of ["## Create and operate an immutable release", "fadeno deploy --project-root", "FADENO_ORIGIN", "expected/recovery.json", "pnpm check:a0-deploy"]) {
    if (!context.guideTemplate.includes(value)) errors.push(`deployment guide template is missing ${value}`);
  }
  if (!context.generatedGuide.includes("Create and operate an immutable release")
    || !context.generatedGuide.includes("FADENO_BUILD_RUNTIME_IDENTITY")) {
    errors.push("generated deployment guide drifted");
  }
  return errors;
}
