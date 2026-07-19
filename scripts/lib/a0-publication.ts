import { readFileSync } from "node:fs";
import { join } from "node:path";

import { A0_FIRST_ALPHA_VERSION } from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0PublicationContext = Readonly<{
  adr: string;
  adrIndex: string;
  decisionGates: string;
  roadmap: string;
  ledger: string;
  scope: string;
  traceability: string;
  buildSpecification: string;
  releasePolicy: string;
  risks: string;
  packageDocument: unknown;
  workspaceDocument: unknown;
  registryEvidence: unknown;
  tracked: ReadonlySet<string>;
}>;

const requiredPaths = Object.freeze([
  "docs/adr/0037-public-package-identity-and-publication.md",
  "evidence/a0/registry-discovery.json",
  "evidence/a0/registry-preflight/owned-organization-unpublished.json",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactConditionalExport(value: unknown, types: string, import_: string): boolean {
  return isRecord(value)
    && Object.keys(value).sort().join(",") === "import,types"
    && value["types"] === types
    && value["import"] === import_;
}

export function loadA0PublicationContext(root: string, tracked: ReadonlySet<string>): A0PublicationContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0037-public-package-identity-and-publication.md"),
    adrIndex: read("docs/adr/README.md"),
    decisionGates: read("docs/ledgers/decision-gates.md"),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    buildSpecification: read("docs/spec/build-adapters-testing.md"),
    releasePolicy: read("docs/release-policy.md"),
    risks: read("docs/ledgers/risks.md"),
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    workspaceDocument: JSON.parse(read("package.json")) as unknown,
    registryEvidence: JSON.parse(read("evidence/a0/registry-discovery.json")) as unknown,
    tracked,
  });
}

export function validateA0Publication(context: A0PublicationContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.tracked.has(path)) errors.push(`A0 publication evidence is not tracked: ${path}`);
  }

  for (const required of [
    "- Status: Accepted",
    "`@fadeno/framework`",
    "`./node`",
    "`./jsx-runtime`",
    "`fadeno` executable mapped to `./dist/cli.js`",
    "A0-03",
    "trusted publisher",
    "provenance",
    "source repository must be public",
    "time-bounded credential",
    "revoked immediately",
    "repository `f-gueguen/fadeno`",
    "workflow filename `publish.yml`",
    "environment `npm-production`",
    "never replaced",
  ]) {
    if (!context.adr.includes(required)) errors.push(`ADR 0037 is missing ${required}`);
  }
  if (!context.adrIndex.includes("0037-public-package-identity-and-publication.md")) errors.push("ADR 0037 is not indexed");
  if (context.decisionGates.includes("| DG-A0-01 |")) errors.push("public-package identity gate remains open after ADR 0037");

  const packageDocument = context.packageDocument;
  if (!isRecord(packageDocument)
    || packageDocument["name"] !== "@fadeno/framework"
    || packageDocument["version"] !== A0_FIRST_ALPHA_VERSION
    || Object.hasOwn(packageDocument, "private")
    || !isRecord(packageDocument["publishConfig"])
    || packageDocument["publishConfig"]["access"] !== "public"
    || packageDocument["publishConfig"]["provenance"] !== true) {
    errors.push("accepted public package identity drifted");
  } else {
    const exports = packageDocument["exports"];
    const bin = packageDocument["bin"];
    const exportKeys = isRecord(exports) ? Object.keys(exports).join(",") : "";
    if (!isRecord(exports)
      || ![".,./node,./jsx-runtime", ".,./node,./jsx-runtime,./browser"].includes(exportKeys)
      || !exactConditionalExport(exports["."], "./dist/index.d.ts", "./dist/index.js")
      || !exactConditionalExport(exports["./node"], "./dist/node.d.ts", "./dist/node.js")
      || !exactConditionalExport(exports["./jsx-runtime"], "./dist/jsx-runtime.d.ts", "./dist/jsx-runtime.js")
      || (exportKeys.endsWith("./browser") && !exactConditionalExport(exports["./browser"], "./dist/browser.d.ts", "./dist/browser.js"))) {
      errors.push("accepted public export mapping drifted");
    }
    if (!isRecord(bin)
      || Object.keys(bin).join(",") !== "fadeno"
      || bin["fadeno"] !== "./dist/cli.js") {
      errors.push("accepted executable mapping drifted");
    }
  }

  const registry = context.registryEvidence;
  if (!isRecord(registry)
    || registry["authenticatedOwner"] !== "fgueguen"
    || registry["organization"] !== "fadeno"
    || registry["organizationRole"] !== "owner"
    || registry["candidateIdentity"] !== "@fadeno/framework"
    || registry["candidateState"] !== "unpublished"
    || registry["selectedIdentity"] !== "@fadeno/framework"
    || registry["blocker"] !== null
    || registry["publicationAttempted"] !== false
    || registry["publicationAuthorized"] !== false) {
    errors.push("accepted registry identity evidence drifted");
  }

  for (const [name, content, required] of [
    ["build specification", context.buildSpecification, ["ADR 0037 selects `@fadeno/framework`", "`.`, `./node`, `./jsx-runtime`", "`fadeno` executable", "0.0.0"]],
    ["release policy", context.releasePolicy, ["ADR 0037 selects `@fadeno/framework`", "time-bounded", "revoked immediately", "public source repository", "`f-gueguen/fadeno`", "`publish.yml`", "`npm-production`", "never becomes merge authority"]],
    ["A0 roadmap", context.roadmap, ["ADR 0037 package-publication decision", "`pnpm check:a0-registry`", "`pnpm check:a0-publication`"]],
    ["current ledger", context.ledger, ["`@fadeno/framework`", "public-name migration"]],
    ["risk ledger", context.risks, ["Registry or publication identity drifts", "public-source provenance", "trusted-publisher identity"]],
  ] as const) {
    for (const fragment of required) {
      if (!content.includes(fragment)) errors.push(`${name} is missing ${fragment}`);
    }
  }

  for (const feature of ["GOV-01", "BUILD-01", "CLI-01", "REL-01"]) {
    const scopeRow = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const traceRow = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scopeRow.includes("ADR 0037")) errors.push(`${feature} scope is missing ADR 0037`);
    if (!traceRow.includes("ADR 0037") || !traceRow.includes("pnpm check:a0-publication")) {
      errors.push(`${feature} traceability is missing the A0 publication decision gate`);
    }
  }

  const workspace = context.workspaceDocument;
  const scripts = isRecord(workspace) && isRecord(workspace["scripts"]) ? workspace["scripts"] : null;
  if (scripts?.["check:a0-publication"] !== "node --no-warnings --experimental-strip-types scripts/check-a0-publication.ts && node --no-warnings --experimental-strip-types scripts/test-a0-publication.ts"
    || typeof scripts["check"] !== "string"
    || !scripts["check"].includes("pnpm check:a0-publication")) {
    errors.push("workspace check does not enforce A0 publication decision");
  }
  return Object.freeze(errors);
}
