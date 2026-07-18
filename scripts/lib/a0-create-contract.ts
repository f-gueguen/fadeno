import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type A0CreateContext = Readonly<{
  adr: string;
  specification: string;
  scope: string;
  traceability: string;
  risks: string;
  ledger: string;
  roadmap: string;
  model: string;
  cli: string;
  implementation: string;
  rootPackage: unknown;
  frameworkPackage: unknown;
  generatedPackage: unknown;
  documentationSource: unknown;
  guideTemplate: string;
  generatedGuide: string;
  tracked: ReadonlySet<string>;
}>;

const requiredEvidence = Object.freeze([
  "docs/adr/0039-public-project-creation.md",
  "examples/v1-app/scenarios/project-creation/expected/app/.gitignore",
  "examples/v1-app/scenarios/project-creation/expected/app/README.md",
  "examples/v1-app/scenarios/project-creation/expected/app/fadeno.config.ts",
  "examples/v1-app/scenarios/project-creation/expected/app/package.json",
  "examples/v1-app/scenarios/project-creation/expected/app/src/routes/layout.tsx",
  "examples/v1-app/scenarios/project-creation/expected/app/src/routes/not-found.tsx",
  "examples/v1-app/scenarios/project-creation/expected/app/src/routes/page.tsx",
  "examples/v1-app/scenarios/project-creation/expected/app/src/routes/styles/handler.ts",
  "examples/v1-app/scenarios/project-creation/expected/app/src/styles.ts",
  "examples/v1-app/scenarios/project-creation/expected/app/tsconfig.json",
  "examples/v1-app/scenarios/project-creation/expected/correction-after.json",
  "examples/v1-app/scenarios/project-creation/expected/correction-before.json",
  "examples/v1-app/scenarios/project-creation/expected/diagnostic-human.txt",
  "examples/v1-app/scenarios/project-creation/expected/diagnostic.json",
  "examples/v1-app/scenarios/project-creation/expected/flow.json",
  "examples/v1-app/scenarios/project-creation/expected/recovery.json",
  "examples/v1-app/scenarios/project-creation/expected/runtime.json",
  "examples/v1-app/scenarios/project-creation/expected/success.txt",
  "scripts/check-a0-create.ts",
  "scripts/test-a0-create.ts",
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

export function loadA0CreateContext(root: string, tracked: ReadonlySet<string>): A0CreateContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0039-public-project-creation.md"),
    specification: read("docs/spec/build-adapters-testing.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    roadmap: read("docs/roadmap/a0.md"),
    model: read("scripts/check-project-model.ts"),
    cli: read("packages/framework/src/cli.ts"),
    implementation: read("packages/framework/src/internal/project-create.ts"),
    rootPackage: JSON.parse(read("package.json")) as unknown,
    frameworkPackage: JSON.parse(read("packages/framework/package.json")) as unknown,
    generatedPackage: JSON.parse(read("examples/v1-app/scenarios/project-creation/expected/app/package.json")) as unknown,
    documentationSource: JSON.parse(read("examples/v1-app/documentation-source.json")) as unknown,
    guideTemplate: read("docs/templates/v1/getting-started.md.tmpl"),
    generatedGuide: read("docs/guides/getting-started.md"),
    tracked,
  });
}

export function validateA0Create(context: A0CreateContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredEvidence) {
    if (!context.tracked.has(path)) errors.push(`A0 create evidence is not tracked: ${path}`);
  }

  const normalizedAdr = context.adr.replace(/\s+/gu, " ");
  if (!normalizedAdr.includes("- Status: Accepted")
    || !normalizedAdr.includes("fadeno create --project-root ./my-fadeno-app")
    || !normalizedAdr.includes("every existing parent-path component is an ordinary")
    || !normalizedAdr.includes("atomically claims the missing target")
    || !normalizedAdr.includes("pins the exact version of the executing")) {
    errors.push("ADR 0039 project-creation contract drifted");
  }
  if (!context.specification.includes("## Public project creation")
    || !context.specification.includes("pnpm check:a0-create")
    || !context.specification.includes("fixed contained allowlist")) {
    errors.push("project-creation specification drifted");
  }

  const scopeRow = context.scope.split("\n").find((line) => line.startsWith("| CLI-01 |")) ?? "";
  if (!scopeRow.includes("packed fresh-root project creation") || scopeRow.includes("implementation, test, deploy")) {
    errors.push("CLI-01 scope status drifted");
  }
  const traceRow = context.traceability.split("\n").find((line) => line.startsWith("| CLI-01 |")) ?? "";
  for (const value of ["ADR 0039", "packed project creation", "pnpm check:a0-create"]) {
    if (!traceRow.includes(value)) errors.push(`CLI-01 traceability is missing ${value}`);
  }
  const riskRow = context.risks.split("\n").find((line) => line.startsWith("| Project creation escapes")) ?? "";
  if (!riskRow.includes("symlink-free parent path") || !riskRow.includes("packed generated consumer passes")) {
    errors.push("project-creation risk control drifted");
  }
  if (!context.ledger.includes("[x] Accept one exact non-interactive create command")
    || !context.ledger.includes("[x] Implement the create command")) {
    errors.push("project-creation ledger status drifted");
  }
  if (!context.roadmap.includes("`pnpm check:a0-create`; public package install")
    || !context.model.includes('commands: ["pnpm check:a0-create", "pnpm ci:local"]')) {
    errors.push("A0-04 roadmap validation drifted");
  }

  if (!context.cli.includes('arguments_[0] === "create"') || !context.cli.includes("runProjectCreateCommand")) {
    errors.push("public executable create dispatch drifted");
  }
  for (const value of [
    "FADENO_CREATE_USAGE",
    "FADENO_CREATE_TARGET_EXISTS",
    "isOrdinarySymlinkFreeDirectory",
    "realpathSync.native(context.cwd)",
    "mkdirSync(target)",
    "flag: \"wx\"",
    "rmSync(target, { recursive: true, force: true })",
  ]) {
    if (!context.implementation.includes(value)) errors.push(`project-creation implementation is missing ${value}`);
  }

  const rootPackage = context.rootPackage;
  if (!record(rootPackage) || !record(rootPackage["scripts"])
    || typeof rootPackage["scripts"]["check:a0-create"] !== "string"
    || !rootPackage["scripts"]["check:a0-create"].includes("test-a0-create-contract.ts")
    || !rootPackage["scripts"]["check:a0-create"].includes("check-a0-create.ts")) {
    errors.push("check:a0-create command drifted");
  }
  const frameworkPackage = context.frameworkPackage;
  if (!record(frameworkPackage) || frameworkPackage["name"] !== "@fadeno/framework"
    || !record(frameworkPackage["bin"]) || frameworkPackage["bin"]["fadeno"] !== "./dist/cli.js") {
    errors.push("create package identity drifted");
  }
  const generatedPackage = context.generatedPackage;
  if (!record(generatedPackage) || !record(generatedPackage["dependencies"])
    || !record(generatedPackage["scripts"])
    || generatedPackage["dependencies"]["@fadeno/framework"] !== frameworkPackage["version"]
    || generatedPackage["scripts"]["test"] !== undefined
    || generatedPackage["scripts"]["check"] !== "fadeno check --project-root .") {
    errors.push("generated project manifest drifted");
  }

  const documentationSource = context.documentationSource;
  if (!record(documentationSource) || !contains(documentationSource["verificationGates"], "check:a0-create")) {
    errors.push("documentation source is missing check:a0-create");
  } else {
    const evidence = documentationSource["evidence"];
    if (!record(evidence)
      || !contains(evidence["success"], "scenarios/project-creation/expected/success.txt")
      || !contains(evidence["failure"], "scenarios/project-creation/expected/diagnostic.json")
      || !contains(evidence["correction"], "scenarios/project-creation/expected/correction-before.json")
      || !contains(evidence["flow"], "scenarios/project-creation/expected/flow.json")
      || !contains(evidence["recovery"], "scenarios/project-creation/expected/recovery.json")
      || !contains(evidence["staleRemoval"], "scenarios/project-creation/expected/recovery.json")) {
      errors.push("documentation source is missing complete A0 create evidence");
    }
  }
  for (const value of ["fadeno create --project-root ./my-fadeno-app", "expected/success.txt", "expected/diagnostic-human.txt", "pnpm check:a0-create"]) {
    if (!context.guideTemplate.includes(value)) errors.push(`project-creation guide template is missing ${value}`);
  }
  if (!context.generatedGuide.includes("Created Fadeno project at <PROJECT_ROOT>.")
    || !context.generatedGuide.includes("FADENO_CREATE_NAME: Project directory name")) {
    errors.push("generated project-creation guide drifted");
  }
  return errors;
}
