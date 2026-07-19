import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type V2BrowserEntrypointBoundaryContext = Readonly<{
  adr: string;
  architecture: string;
  specification: string;
  navigation: string;
  roadmap: string;
  scope: string;
  traceability: string;
  risks: string;
  ledger: string;
  packageDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

export const V2_BROWSER_ENTRYPOINT_SUBPATH = "./browser" as const;
export const V2_BROWSER_ENTRYPOINT_PACKAGE = "@fadeno/framework/browser" as const;
export const V2_BROWSER_ENTRYPOINT_EXISTING_SUBPATHS = Object.freeze([".", "./jsx-runtime", "./node"] as const);

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadV2BrowserEntrypointBoundaryContext(root: string, tracked: ReadonlySet<string>): V2BrowserEntrypointBoundaryContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    adr: read("docs/adr/0046-browser-entrypoint-package-boundary.md"),
    architecture: read("docs/architecture/overview.md"),
    specification: read("docs/spec/build-adapters-testing.md"),
    navigation: read("docs/spec/navigation-patching-preservation.md"),
    roadmap: read("docs/roadmap/v2.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    tracked,
  });
}

export function validateV2BrowserEntrypointBoundary(context: V2BrowserEntrypointBoundaryContext): readonly string[] {
  const errors: string[] = [];
  const adr = context.adr.replace(/\s+/gu, " ");
  for (const fragment of [
    "exactly one public `./browser` subpath",
    "No second package",
    "cannot depend on Node built-ins, server, compiler, analyzer, application source",
    "generated browser module that statically imports `@fadeno/framework/browser`",
    "external module-script path",
    "same request-owned CSP nonce authority",
    "no implicit global startup side effect",
    "share the framework package version and one application build identity",
    "private update envelope retains its own exact compatibility version",
    "does not add `./browser` to the real package manifest",
    "private canary",
    "removing the public subpath requires a separately versioned compatibility decision",
    "Release impact is none",
  ]) if (!adr.includes(fragment)) errors.push(`ADR 0046 is missing ${fragment}`);

  for (const [name, text, fragments] of [
    ["architecture", context.architecture, ["ADR 0046", "future `./browser` facade", "one application build identity"]],
    ["build specification", context.specification, ["ADR 0046", "generated application browser module", "real `@fadeno/framework` manifest", "V2-02 owns"]],
    ["navigation specification", context.navigation, ["ADR 0046", "`@fadeno/framework/browser`", "request-nonce path", "adds no real export"]],
    ["V2 roadmap", context.roadmap, ["ADR 0046", "disposable packed consumer", "future `./browser` facade"]],
    ["risk ledger", context.risks, ["ADR 0046", "real export remains absent until V2-02", "second browser version owner"]],
    ["roadmap ledger", context.ledger, ["V2-01A — Merge commit `46c7ab0`", "leaves the published export map unchanged for V2-02 implementation", "V2-01 — Merge commit `d9718c0`"]],
  ] as const) {
    const normalized = text.replace(/\s+/gu, " ");
    for (const fragment of fragments) if (!normalized.includes(fragment)) errors.push(`${name} is missing ${fragment}`);
  }

  for (const feature of ["GOV-01", "BUILD-01", "ENH-01", "SEC-01", "TEST-01"]) {
    const scope = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const trace = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scope.includes("ADR 0046")) errors.push(`${feature} scope is missing ADR 0046`);
    if (!trace.includes("ADR 0046") || !trace.includes("check:v2-browser-entrypoint-boundary")) {
      errors.push(`${feature} traceability is missing the V2-01A gate`);
    }
  }

  if (!record(context.packageDocument) || !record(context.packageDocument["exports"])) {
    errors.push("current package exports are missing");
  } else {
    const subpaths = Object.keys(context.packageDocument["exports"]).sort();
    const acceptedBeforeImplementation = JSON.stringify([...V2_BROWSER_ENTRYPOINT_EXISTING_SUBPATHS].sort());
    const acceptedAfterImplementation = JSON.stringify([...V2_BROWSER_ENTRYPOINT_EXISTING_SUBPATHS, V2_BROWSER_ENTRYPOINT_SUBPATH].sort());
    if (![acceptedBeforeImplementation, acceptedAfterImplementation].includes(JSON.stringify(subpaths))) {
      errors.push("browser boundary must expose only the accepted exact subpaths");
    }
    if (subpaths.includes(V2_BROWSER_ENTRYPOINT_SUBPATH)) {
      for (const path of ["packages/framework/src/browser.ts", "packages/framework/src/internal/browser-runtime.ts"]) {
        if (!context.tracked.has(path)) errors.push(`real browser export is missing its implementation: ${path}`);
      }
    }
  }

  for (const path of [
    "docs/adr/0046-browser-entrypoint-package-boundary.md",
    "prototypes/v2/browser-entrypoint/browser.ts",
    "prototypes/v2/browser-entrypoint/internal-browser-canary.ts",
    "scripts/check-v2-browser-entrypoint-boundary.ts",
    "scripts/lib/v2-browser-entrypoint-boundary.ts",
    "scripts/test-v2-browser-entrypoint-boundary.ts",
    "tsconfig.v2-browser-entrypoint-boundary.json",
  ]) if (!context.tracked.has(path)) errors.push(`V2-01A artifact is not tracked: ${path}`);

  return Object.freeze(errors);
}
