import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type A0CssContext = Readonly<{
  adr: string;
  adrIndex: string;
  decisionGates: string;
  deferrals: string;
  scope: string;
  traceability: string;
  progressiveEnhancement: string;
  routing: string;
  renderer: string;
  layout: string;
  handler: string;
  styles: string;
  documentationSource: unknown;
  packageDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

const requiredPaths = Object.freeze([
  "docs/adr/0036-native-external-css-for-alpha.md",
  "examples/v1-app/src/routes/layout.tsx",
  "examples/v1-app/src/routes/styles/handler.ts",
  "examples/v1-app/src/styles.ts",
  "examples/v1-app/expected/css-baseline.json",
  "examples/v1-app/scenarios/css-boundary/before/src/routes/css-boundary/page.tsx",
  "examples/v1-app/scenarios/css-boundary/after/src/routes/css-boundary/page.tsx",
  "examples/v1-app/scenarios/css-boundary/expected/diagnostic-human.txt",
  "examples/v1-app/scenarios/css-boundary/expected/diagnostic.json",
  "examples/v1-app/scenarios/css-boundary/expected/correction-before.json",
  "examples/v1-app/scenarios/css-boundary/expected/correction-after.json",
  "examples/v1-app/scenarios/css-boundary/expected/flow.json",
  "examples/v1-app/scenarios/css-boundary/expected/recovery.json",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsString(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

export function loadA0CssContext(root: string, tracked: ReadonlySet<string>): A0CssContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0036-native-external-css-for-alpha.md"),
    adrIndex: read("docs/adr/README.md"),
    decisionGates: read("docs/ledgers/decision-gates.md"),
    deferrals: read("docs/ledgers/deferrals.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    progressiveEnhancement: read("docs/spec/progressive-enhancement.md"),
    routing: read("docs/spec/routing-rendering-streaming.md"),
    renderer: read("packages/framework/src/internal/renderer.ts"),
    layout: read("examples/v1-app/src/routes/layout.tsx"),
    handler: read("examples/v1-app/src/routes/styles/handler.ts"),
    styles: read("examples/v1-app/src/styles.ts"),
    documentationSource: JSON.parse(read("examples/v1-app/documentation-source.json")) as unknown,
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    tracked,
  });
}

export function validateA0Css(context: A0CssContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) errors.push(`A0 CSS evidence is not tracked: ${path}`);
  }

  if (!context.adr.includes("- Status: Accepted")
    || !context.adr.includes("Rendered documents include `style-src 'self'`")
    || !context.adr.includes("Fadeno does not add scoped CSS")) {
    errors.push("ADR 0036 native CSS boundary drifted");
  }
  if (!context.adrIndex.includes("0036-native-external-css-for-alpha.md")) errors.push("ADR 0036 is not indexed");
  if (context.decisionGates.includes("| DG-A0-03 |")) errors.push("DG-A0-03 remains open after ADR 0036");
  if (!context.deferrals.includes("| Scoped CSS compiler and asset pipeline |")) errors.push("scoped CSS deferral is missing");

  const scopeRow = context.scope.split("\n").find((line) => line.startsWith("| CSS-01 |")) ?? "";
  if (!scopeRow.includes("ADR 0036") || !scopeRow.includes("asset pipeline remain deferred")) errors.push("CSS-01 scope boundary drifted");
  const traceRow = context.traceability.split("\n").find((line) => line.startsWith("| CSS-01 |")) ?? "";
  for (const required of ["ADR 0036", "pnpm check:a0-css", "pnpm check:v1-renderer", "pnpm check:v1-running-example"]) {
    if (!traceRow.includes(required)) errors.push(`CSS-01 traceability is missing ${required}`);
  }

  if (!context.progressiveEnhancement.includes("## Native CSS baseline")
    || !context.progressiveEnhancement.includes("same-origin styles through `style-src 'self'`")
    || !context.progressiveEnhancement.includes("does not provide scoped CSS")) {
    errors.push("progressive-enhancement CSS contract drifted");
  }
  if (!context.routing.includes("application-owned same-origin external")
    || !context.routing.includes("ADR 0036 fixes the alpha styling boundary")) {
    errors.push("routing CSS contract drifted");
  }

  if (!context.renderer.includes("style-src 'self'") || context.renderer.includes("unsafe-inline")) errors.push("renderer CSS CSP boundary drifted");
  if (!context.layout.includes('<link href="/styles" rel="stylesheet" type="text/css" />') || !context.layout.includes('class="app-shell"')) errors.push("canonical application stylesheet link drifted");
  if (!context.handler.includes('import type { Handler } from "@fadeno/framework"')
    || !context.handler.includes('"content-type": "text/css; charset=utf-8"')
    || !context.handler.includes('"cache-control": "public, max-age=300"')) {
    errors.push("canonical application CSS handler drifted");
  }
  if (!context.styles.includes(":focus-visible")
    || !context.styles.includes("prefers-reduced-motion: reduce")
    || !context.styles.includes("prefers-color-scheme: dark")) {
    errors.push("canonical application CSS accessibility baseline drifted");
  }

  const documentationSource = context.documentationSource;
  if (!isRecord(documentationSource)) errors.push("documentation source must be an object");
  else {
    if (!containsString(documentationSource["verificationGates"], "check:a0-css")) errors.push("documentation source is missing check:a0-css");
    const evidence = documentationSource["evidence"];
    if (!isRecord(evidence)
      || !containsString(evidence["success"], "expected/css-baseline.json")
      || !containsString(evidence["failure"], "scenarios/css-boundary/expected/diagnostic-human.txt")
      || !containsString(evidence["correction"], "scenarios/css-boundary/expected/correction-before.json")
      || !containsString(evidence["flow"], "scenarios/css-boundary/expected/flow.json")
      || !containsString(evidence["recovery"], "scenarios/css-boundary/expected/recovery.json")
      || !containsString(evidence["staleRemoval"], "scenarios/css-boundary/expected/recovery.json")) {
      errors.push("documentation source is missing complete A0 CSS evidence");
    }
  }

  const packageDocument = context.packageDocument;
  if (!isRecord(packageDocument)
    || packageDocument["name"] !== "@fadeno/framework") {
    errors.push("A0 CSS package identity drifted");
  }
  return errors;
}
