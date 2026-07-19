import { execFileSync } from "node:child_process";

import {
  loadV2BrowserEntrypointBoundaryContext,
  validateV2BrowserEntrypointBoundary,
  type V2BrowserEntrypointBoundaryContext,
} from "./lib/v2-browser-entrypoint-boundary.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
for (const path of [
  "docs/adr/0046-browser-entrypoint-package-boundary.md",
  "prototypes/v2/browser-entrypoint/browser.ts",
  "prototypes/v2/browser-entrypoint/internal-browser-canary.ts",
  "scripts/check-v2-browser-entrypoint-boundary.ts",
  "scripts/lib/v2-browser-entrypoint-boundary.ts",
  "scripts/test-v2-browser-entrypoint-boundary.ts",
  "tsconfig.v2-browser-entrypoint-boundary.json",
]) tracked.add(path);
const source = loadV2BrowserEntrypointBoundaryContext(root, tracked);

function mutation(expected: string, mutate: (context: V2BrowserEntrypointBoundaryContext) => V2BrowserEntrypointBoundaryContext): void {
  const errors = validateV2BrowserEntrypointBoundary(mutate(source));
  if (!errors.includes(expected)) throw new Error(`V2-01A mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateV2BrowserEntrypointBoundary(source);
if (valid.length > 0) throw new Error(`valid V2-01A boundary refused:\n${valid.join("\n")}`);
mutation("ADR 0046 is missing exactly one public `./browser` subpath", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace(/exactly one public\s+`\.\/browser` subpath/u, "an unspecified browser path"),
}));
mutation("ADR 0046 is missing cannot depend on Node built-ins, server, compiler, analyzer, application source", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace(/cannot depend on Node built-ins, server,\s+compiler, analyzer, application source/u, "may share every runtime graph"),
}));
mutation("ADR 0046 is missing no implicit global startup side effect", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace(/no implicit global\s+startup side effect/u, "implicit startup"),
}));
mutation("ADR 0046 is missing share the framework package version and one application build identity", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace(/share the framework package version and one\s+application build identity/u, "may vary independently"),
}));
mutation("ADR 0046 is missing removing the public subpath requires a separately versioned compatibility decision", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace(/removing the public subpath requires a\s+separately versioned compatibility decision/u, "removal is unversioned"),
}));
mutation("browser boundary must expose only the accepted exact subpaths", (context) => Object.freeze({
  ...context,
  packageDocument: {
    ...(context.packageDocument as Record<string, unknown>),
    exports: { ...((context.packageDocument as { exports: Record<string, unknown> }).exports), "./internal/*": "./dist/internal/*.js" },
  },
}));
mutation("ENH-01 traceability is missing the V2-01A gate", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| ENH-01 \|.*$/mu, (line) => line.replace("check:v2-browser-entrypoint-boundary", "removed")),
}));

console.log("V2 browser-entrypoint boundary mutation tests passed (subpath, graph, loading, identity, rollback, and exact exports)");
