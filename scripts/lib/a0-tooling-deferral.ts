import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type A0ToolingDeferralContext = Readonly<{
  adr42: string;
  adr43: string;
  adrIndex: string;
  effectiveAdrSchemaClauses: readonly string[];
  roadmap: string;
  ledger: string;
  decisionGates: string;
  deferrals: string;
  risks: string;
  scope: string;
  traceability: string;
  buildSpecification: string;
  analyzerSpecification: string;
  readme: string;
  support: string;
  releasePolicy: string;
  packageDocument: unknown;
  workspaceDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

const requiredPaths = Object.freeze([
  "docs/adr/0043-defer-independent-usability-and-external-tooling.md",
  "scripts/lib/a0-tooling-deferral.ts",
  "scripts/check-a0-tooling-deferral.ts",
  "scripts/test-a0-tooling-deferral.ts",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function row(content: string, prefix: string): string {
  return content.split("\n").find((line) => line.startsWith(prefix)) ?? "";
}

function includesProse(content: string, fragment: string): boolean {
  return content.replace(/\s+/gu, " ").includes(fragment);
}

export function loadA0ToolingDeferralContext(
  root: string,
  tracked: ReadonlySet<string>,
): A0ToolingDeferralContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr42: read("docs/adr/0042-independent-usability-evidence-contract.md"),
    adr43: read("docs/adr/0043-defer-independent-usability-and-external-tooling.md"),
    adrIndex: read("docs/adr/README.md"),
    effectiveAdrSchemaClauses: Object.freeze([
      read("docs/adr/0015-accept-bounded-interaction-extraction.md"),
      read("docs/adr/0027-generated-route-module-and-production-routing.md"),
      read("docs/adr/0032-project-check-command-contract.md"),
      read("docs/adr/0033-build-and-development-lifecycle.md"),
    ]),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    decisionGates: read("docs/ledgers/decision-gates.md"),
    deferrals: read("docs/ledgers/deferrals.md"),
    risks: read("docs/ledgers/risks.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    buildSpecification: read("docs/spec/build-adapters-testing.md"),
    analyzerSpecification: read("docs/spec/compiler-analyzer.md"),
    readme: read("README.md"),
    support: read("SUPPORT.md"),
    releasePolicy: read("docs/release-policy.md"),
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    workspaceDocument: JSON.parse(read("package.json")) as unknown,
    tracked,
  });
}

export function validateA0ToolingDeferral(
  context: A0ToolingDeferralContext,
): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) {
      errors.push(`A0 tooling-deferral evidence is not tracked: ${path}`);
    }
  }

  if (!context.adr42.includes("- Status: Superseded")
    || !context.adr42.includes("- Superseded by: ADR 0043")) {
    errors.push("ADR 0042 supersession drifted");
  }
  for (const fragment of [
    "- Status: Accepted",
    "- Supersedes: ADR 0042",
    "`deferred-unqualified`",
    "no supported editor product and no public analyzer schema",
    "no participant outcome or usability claim is accepted by default",
    "automated packed workflows",
    "changes no package bytes",
    "does not retroactively qualify the first alpha",
  ]) {
    if (!includesProse(context.adr43, fragment)) {
      errors.push(`ADR 0043 is missing ${fragment}`);
    }
  }
  if (!context.adrIndex.includes("ADR 0043 — Defer independent usability")
    || !context.adrIndex.includes("ADR 0042 — Independent usability evidence contract")
    || !context.adrIndex.includes("superseded by ADR 0043")) {
    errors.push("ADR index does not preserve A0 tooling-deferral authority");
  }
  if (context.effectiveAdrSchemaClauses.some((adr) => adr.includes("DG-A0-02")
    || !adr.includes("ADR 0043"))) {
    errors.push("effective ADR retains the retired analyzer gate");
  }

  if (context.decisionGates.includes("| DG-A0-02 |")) {
    errors.push("deferred analyzer gate returned");
  }
  for (const [prefix, fragments] of [
    ["| Independent newcomer usability qualification |", ["After the first alpha", "ADR 0043", "absence as success"]],
    ["| Supported editor product |", ["ADR 0043", "selects no editor product"]],
    ["| Public analyzer schema |", ["later ADR", "deferring the entire external surface"]],
  ] as const) {
    const deferral = row(context.deferrals, prefix);
    if (!fragments.every((fragment) => deferral.includes(fragment))) {
      errors.push(`A0 deferral drifted: ${prefix.slice(2, -2)}`);
    }
  }

  const a007 = row(context.roadmap, "| A0-07 |");
  const a008 = row(context.roadmap, "| A0-08 |");
  const a009 = row(context.roadmap, "| A0-09 |");
  if (!a007.includes("deferred-unqualified") || !a007.includes("no participant claim")) {
    errors.push("A0-07 deferred qualification drifted");
  }
  if (!a008.includes("no editor product, public analyzer schema")
    || !a008.includes("pnpm check:a0-tooling-deferral")) {
    errors.push("A0-08 tooling decision drifted");
  }
  if (!a009.includes("independent-usability/tooling caveat")
    || !a009.includes("pnpm check:a0-tooling-deferral")) {
    errors.push("A0-09 disclosure gate drifted");
  }
  for (const fragment of [
    "A0-08 — explicitly defer external analyzer/editor tooling",
    "`deferred-unqualified`",
    "V2-00 — decompose browser enhancement",
    "Later external analyzer consumers require new evidence",
    "Independent newcomer usability remains deferred",
  ]) {
    if (!includesProse(context.ledger, fragment)) {
      errors.push(`current A0 ledger is missing ${fragment}`);
    }
  }

  if (!context.risks.includes("treats unavailable attempts or automation as user success")) {
    errors.push("independent-usability false-claim risk drifted");
  }
  for (const feature of ["TEST-01", "DX-01", "CLI-01", "DOC-01", "TOOL-01"]) {
    const scopeRow = row(context.scope, `| ${feature} |`);
    if (!scopeRow.includes("ADR 0043")) {
      errors.push(`${feature} scope is missing ADR 0043`);
    }
  }
  for (const feature of ["TEST-01", "DX-01", "CLI-01", "DOC-01", "ACCESS-01", "TOOL-01"]) {
    const traceRow = row(context.traceability, `| ${feature} |`);
    if (!traceRow.includes("ADR 0043") || !traceRow.includes("pnpm check:a0-tooling-deferral")) {
      errors.push(`${feature} traceability is missing the tooling-deferral gate`);
    }
  }

  for (const [name, content, fragments] of [
    ["build specification", context.buildSpecification, ["`deferred-unqualified`", "No editor product or public analyzer schema", "Later real attempts qualify only the exact artifact"]],
    ["analyzer specification", context.analyzerSpecification, ["ADR 0043 defers every external analyzer consumer", "remain internal under ADR 0043", "Deep imports remain refused"]],
    ["README", context.readme, ["Independent newcomer usability has not been qualified", "no editor product or public analyzer"]],
    ["support policy", context.support, ["Independent newcomer usability", "not a supported protocol or public schema"]],
    ["release policy", context.releasePolicy, ["first alpha release notes", "Automated packed conformance", "no editor product or public analyzer schema"]],
  ] as const) {
    for (const fragment of fragments) {
      if (!includesProse(content, fragment)) {
        errors.push(`${name} is missing ${fragment}`);
      }
    }
  }

  const packageDocument = context.packageDocument;
  const exports = isRecord(packageDocument) ? packageDocument["exports"] : null;
  if (!isRecord(exports)
    || Object.keys(exports).some((key) => /analy|editor|language|protocol/iu.test(key))) {
    errors.push("public package exposes an analyzer or editor surface");
  }

  const workspace = context.workspaceDocument;
  const scripts = isRecord(workspace) && isRecord(workspace["scripts"])
    ? workspace["scripts"]
    : null;
  if (scripts?.["check:a0-tooling-deferral"]
      !== "node --no-warnings --experimental-strip-types scripts/check-a0-tooling-deferral.ts && node --no-warnings --experimental-strip-types scripts/test-a0-tooling-deferral.ts"
    || typeof scripts?.["check"] !== "string"
    || !scripts["check"].includes("pnpm check:a0-tooling-deferral")) {
    errors.push("workspace check does not enforce A0 tooling deferral");
  }

  return Object.freeze(errors);
}
