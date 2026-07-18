import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export interface A0TestContext {
  readonly adr: string;
  readonly specification: string;
  readonly scope: string;
  readonly traceability: string;
  readonly risks: string;
  readonly ledger: string;
  readonly implementation: string;
  readonly buildImplementation: string;
  readonly testSource: string;
  readonly productionConfig: unknown;
  readonly testConfig: unknown;
  readonly rootPackage: unknown;
  readonly frameworkPackage: unknown;
  readonly generatedPackage: unknown;
  readonly documentationSource: unknown;
  readonly guideTemplate: string;
  readonly generatedGuide: string;
  readonly tracked: ReadonlySet<string>;
}

const requiredEvidence = Object.freeze([
  ".changeset/application-test-workflow.md",
  "docs/adr/0040-stock-application-test-workflow.md",
  "examples/v1-app/scenarios/project-creation/expected/app/test/application.test.tsx",
  "examples/v1-app/scenarios/project-creation/expected/app/tsconfig.test.json",
  "examples/v1-app/scenarios/application-test/expected/success.txt",
  "examples/v1-app/scenarios/application-test/expected/build-input-refusal.txt",
  "examples/v1-app/scenarios/application-test/expected/diagnostic-human.txt",
  "examples/v1-app/scenarios/application-test/expected/diagnostic.json",
  "examples/v1-app/scenarios/application-test/expected/diagnostic.tap",
  "examples/v1-app/scenarios/application-test/expected/correction-before.json",
  "examples/v1-app/scenarios/application-test/expected/correction-after.json",
  "examples/v1-app/scenarios/application-test/expected/flow.json",
  "examples/v1-app/scenarios/application-test/expected/recovery.json",
  "scripts/check-a0-test.ts",
  "scripts/test-a0-test-contract.ts",
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

export function loadA0TestContext(root: string, tracked: ReadonlySet<string>): A0TestContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0040-stock-application-test-workflow.md"),
    specification: read("docs/spec/build-adapters-testing.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    implementation: read("packages/framework/src/internal/project-create.ts"),
    buildImplementation: read("packages/framework/src/internal/build-dev-generation-child.ts"),
    testSource: read("examples/v1-app/scenarios/project-creation/expected/app/test/application.test.tsx"),
    productionConfig: JSON.parse(read("examples/v1-app/scenarios/project-creation/expected/app/tsconfig.json")) as unknown,
    testConfig: JSON.parse(read("examples/v1-app/scenarios/project-creation/expected/app/tsconfig.test.json")) as unknown,
    rootPackage: JSON.parse(read("package.json")) as unknown,
    frameworkPackage: JSON.parse(read("packages/framework/package.json")) as unknown,
    generatedPackage: JSON.parse(read("examples/v1-app/scenarios/project-creation/expected/app/package.json")) as unknown,
    documentationSource: JSON.parse(read("examples/v1-app/documentation-source.json")) as unknown,
    guideTemplate: read("docs/templates/v1/getting-started.md.tmpl"),
    generatedGuide: read("docs/guides/getting-started.md"),
    tracked,
  });
}

export function validateA0Test(context: A0TestContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredEvidence) {
    if (!context.tracked.has(path)) errors.push(`A0 test evidence is not tracked: ${path}`);
  }

  const normalizedAdr = context.adr.replace(/\s+/gu, " ");
  for (const value of [
    "- Status: Accepted",
    "The created project exposes `pnpm test`",
    "Node's built-in test runner",
    "no `fadeno test` CLI form",
    "public test helper",
    "second framework runtime",
  ]) {
    if (!normalizedAdr.includes(value)) errors.push(`ADR 0040 is missing ${value}`);
  }
  if (!context.specification.includes("ADR 0040 selects the first supported application-test workflow")
    || !context.specification.includes("pnpm check:a0-test")) {
    errors.push("application-test specification drifted");
  }
  if (!context.buildImplementation.includes('relativePath.startsWith(".fadeno/test/")')) {
    errors.push("production build does not refuse disposable test input");
  }
  const testScope = context.scope.split("\n").find((line) => line.startsWith("| TEST-01 |")) ?? "";
  const testTrace = context.traceability.split("\n").find((line) => line.startsWith("| TEST-01 |")) ?? "";
  if (!testScope.includes("ADR 0040") || !testTrace.includes("pnpm check:a0-test")) {
    errors.push("TEST-01 A0 application-test ownership drifted");
  }
  const risk = context.risks.split("\n").find((line) => line.startsWith("| Application tests drift")) ?? "";
  if (!risk.includes("cleaned disposable output tree") || !risk.includes("second runtime")) {
    errors.push("application-test risk control drifted");
  }
  if (!context.ledger.includes("A0-05 — Merge commit `985a22f`")
    || !context.ledger.includes("stock created-application test")) {
    errors.push("A0-05 ledger status drifted");
  }

  const generatedPackage = context.generatedPackage;
  const exactTest = "node --input-type=module --eval \"import { rm } from 'node:fs/promises'; await rm('.fadeno/test', { force: true, recursive: true });\" && tsc -p tsconfig.test.json && node --test --test-reporter=spec .fadeno/test/test/application.test.js";
  if (!record(generatedPackage) || !record(generatedPackage["scripts"])
    || generatedPackage["scripts"]["test"] !== exactTest) {
    errors.push("generated application test command drifted");
  }
  if (!context.implementation.includes('path: "test/application.test.tsx"')
    || !context.implementation.includes('path: "tsconfig.test.json"')
    || !context.implementation.includes("await rm('.fadeno/test'")) {
    errors.push("created-project application-test template drifted");
  }
  if (!context.testSource.includes('from "@fadeno/framework"')
    || !context.testSource.includes("renderRoute")
    || !context.testSource.includes("stylesheet(new Request")
    || context.testSource.includes("/internal/")) {
    errors.push("application test does not use only demonstrated public runtime semantics");
  }

  const productionConfig = context.productionConfig;
  const testConfig = context.testConfig;
  if (!record(productionConfig) || contains(productionConfig["include"], "test/**/*.tsx")) {
    errors.push("production compiler includes application tests");
  }
  if (!record(testConfig) || !record(testConfig["compilerOptions"])
    || testConfig["compilerOptions"]["outDir"] !== ".fadeno/test"
    || !contains(testConfig["include"], "test/**/*.tsx")) {
    errors.push("application-test compiler ownership drifted");
  }

  const frameworkPackage = context.frameworkPackage;
  if (!record(frameworkPackage) || !record(frameworkPackage["exports"])
    || Object.keys(frameworkPackage["exports"]).some((path) => path.includes("test"))) {
    errors.push("A0-05 introduced a public test export");
  }
  const rootPackage = context.rootPackage;
  if (!record(rootPackage) || !record(rootPackage["scripts"])
    || typeof rootPackage["scripts"]["check:a0-test"] !== "string"
    || !(rootPackage["scripts"]["check:a0-test"] as string).includes("test-a0-test-contract.ts")
    || !(rootPackage["scripts"]["check:a0-test"] as string).includes("check-a0-test.ts")
    || !(rootPackage["scripts"]["check"] as string).includes("pnpm check:a0-test")) {
    errors.push("check:a0-test command drifted");
  }

  const documentationSource = context.documentationSource;
  if (!record(documentationSource) || !contains(documentationSource["verificationGates"], "check:a0-test")) {
    errors.push("documentation source is missing check:a0-test");
  } else {
    const evidence = documentationSource["evidence"];
    if (!record(evidence)
      || !contains(evidence["success"], "scenarios/application-test/expected/success.txt")
      || !contains(evidence["failure"], "scenarios/application-test/expected/build-input-refusal.txt")
      || !contains(evidence["failure"], "scenarios/application-test/expected/diagnostic.tap")
      || !contains(evidence["correction"], "scenarios/application-test/expected/correction-before.json")
      || !contains(evidence["flow"], "scenarios/application-test/expected/flow.json")
      || !contains(evidence["recovery"], "scenarios/application-test/expected/recovery.json")
      || !contains(evidence["staleRemoval"], "scenarios/application-test/expected/recovery.json")) {
      errors.push("documentation source is missing complete A0 test evidence");
    }
  }
  for (const value of ["## Test the application", "pnpm test", "application.test.tsx", "diagnostic-human.txt", "pnpm check:a0-test"]) {
    if (!context.guideTemplate.includes(value)) errors.push(`application-test guide template is missing ${value}`);
  }
  if (!context.generatedGuide.includes("renders the application document through the production renderer")
    || !context.generatedGuide.includes("ERR_ASSERTION")) {
    errors.push("generated application-test guide drifted");
  }
  return errors;
}
