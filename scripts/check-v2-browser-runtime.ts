import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@fadeno/framework";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenarioRoot = join(root, "examples/v1-app/scenarios/browser-runtime");
const outputRoot = join(root, "output/v2-browser-runtime");
const siteRoot = join(outputRoot, "site");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_V2_BROWSER_RUNTIME_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

const adr = readFileSync(join(root, "docs/adr/0047-initial-browser-runtime-and-private-transport.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "exports exactly `startBrowserEnhancement`, `BrowserEnhancement`, and `BrowserEnhancementState`",
  "does not start work or mutate global state",
  "root-relative same-origin path",
  "same request nonce",
  "fatal UTF-8 decoding",
  "one structural record",
  "checks cancellation",
  "remain private package internals",
  "does not yet make navigation faster",
]) assert.equal(adr.includes(fragment), true, `ADR 0047 is missing ${fragment}`);

const threatModel = readFileSync(join(root, "docs/security/browser-update-threat-model.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "wrong/missing nonce",
  "Cross-user or stale result applies",
  "Decode mistaken for authorization",
  "Hostile input leaks through logging",
  "Failure repeats a mutation",
  "rollback",
]) assert.equal(threatModel.includes(fragment), true, `browser threat model is missing ${fragment}`);

const scope = readFileSync(join(root, "docs/product/scope.md"), "utf8");
const traceability = readFileSync(join(root, "docs/traceability.md"), "utf8");
for (const feature of ["WEB-02", "BUILD-01", "ENH-01", "PATCH-01", "SEC-01", "TEST-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0047"), true, `${feature} scope is missing ADR 0047`);
  assert.equal(traceabilityRow.includes("ADR 0047") && traceabilityRow.includes("check:v2-browser-runtime"), true, `${feature} traceability is missing V2-02 evidence`);
}

const packageDocument = readJson(join(packageRoot, "package.json")) as { exports: Record<string, unknown> };
assert.deepEqual(Object.keys(packageDocument.exports).sort(), [".", "./browser", "./jsx-runtime", "./node"]);
assert.equal(
  readFileSync(join(root, ".changeset/browser-runtime-boundary.md"), "utf8"),
  '---\n"@fadeno/framework": minor\n---\n\nAdd the explicit browser enhancement entrypoint and the bounded private update\ntransport boundary while preserving native links and forms as the fallback.\n',
);

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-browser-runtime-"));
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_V2_BROWSER_RUNTIME_TARBALL");

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeJson(join(consumer, "package.json"), {
    name: "fadeno-v2-browser-runtime-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${join(tarballs, tarballName)}` },
  });
  writeJson(join(consumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  });
  writeFileSync(join(consumer, "src/render.ts"), `import { renderRoute, type RenderChild } from "${packageName}";
import { jsx, jsxs } from "${packageName}/jsx-runtime";
const document = (child: RenderChild): RenderChild => jsxs("html", { lang: "en", children: [
  jsx("head", { children: jsx("title", { children: "Browser runtime example" }) }),
  jsx("body", { children: jsxs("main", { children: [
    jsx("h1", { children: "Native page" }),
    jsx("a", { id: "native-link", href: "/native-next", children: "Continue without JavaScript" }),
    jsxs("form", { id: "native-form", action: "/native-submit", method: "get", children: [
      jsx("input", { name: "value", value: "native" }),
      jsx("button", { type: "submit", children: "Submit without JavaScript" })
    ] })
  ] }) })
] });
const enhanced = await renderRoute({
  request: new Request("https://example.test/"), parameters: Object.freeze({}), layouts: [],
  browserModule: "/_fadeno/browser-entry.js", page: () => document("Browser runtime")
});
const rollback = await renderRoute({
  request: new Request("https://example.test/rollback"), parameters: Object.freeze({}), layouts: [],
  page: () => document("Browser runtime rollback")
});
console.log(JSON.stringify({
  html: await enhanced.text(), contentSecurityPolicy: enhanced.headers.get("content-security-policy"),
  rollbackHtml: await rollback.text(), rollbackContentSecurityPolicy: rollback.headers.get("content-security-policy")
}));
`);
  writeFileSync(join(consumer, "src/refusal.ts"), `import { startBrowserEnhancement } from "${packageName}/browser";
try { startBrowserEnhancement(); throw new Error("browser startup unexpectedly succeeded"); }
catch (cause) {
  if (!(cause instanceof TypeError) || cause.message !== "FADENO_BROWSER_ENVIRONMENT") throw cause;
  console.log(JSON.stringify({ schema: "fadeno.example.browser-runtime-refusal", version: 1, code: cause.message, cause: "browser entrypoint started without a document", outcome: "refused" }));
}
`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
  const rendered = JSON.parse(run(process.execPath, ["dist/render.js"], consumer).trim()) as {
    html: string;
    contentSecurityPolicy: string | null;
    rollbackHtml: string;
    rollbackContentSecurityPolicy: string | null;
  };
  const refusal = JSON.parse(run(process.execPath, ["dist/refusal.js"], consumer).trim()) as unknown;
  assert.deepEqual(refusal, readJson(join(scenarioRoot, "expected/refusal.json")));
  assert.match(rendered.html, /<script nonce="[A-Za-z0-9_-]+" src="\/_fadeno\/browser-entry\.js" type="module"><\/script>/u);
  assert.match(rendered.html, /id="native-link"/u);
  assert.match(rendered.html, /id="native-form"/u);
  assert.match(rendered.contentSecurityPolicy ?? "", /script-src 'nonce-[A-Za-z0-9_-]+'/u);
  assert.doesNotMatch(rendered.rollbackHtml, /<script/u);
  assert.match(rendered.rollbackContentSecurityPolicy ?? "", /script-src 'none'/u);

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(join(siteRoot, "_fadeno/framework/internal"), { recursive: true });
  const installed = join(consumer, "node_modules", packageName);
  cpSync(join(installed, "dist/browser.js"), join(siteRoot, "_fadeno/framework/browser.js"));
  cpSync(join(installed, "dist/internal/browser-runtime.js"), join(siteRoot, "_fadeno/framework/internal/browser-runtime.js"));
  cpSync(join(installed, "dist/internal/browser-navigation.js"), join(siteRoot, "_fadeno/framework/internal/browser-navigation.js"));
  cpSync(join(installed, "dist/internal/browser-update.js"), join(siteRoot, "_fadeno/framework/internal/browser-update.js"));
  const authoredEntry = readFileSync(join(scenarioRoot, "browser-entry.ts"), "utf8");
  const packageImport = 'from "@fadeno/framework/browser"';
  assert.equal(authoredEntry.split(packageImport).length - 1, 1, "generated source has one static public-package import");
  const linkedEntry = authoredEntry.replace(packageImport, 'from "./framework/browser.js"');
  assert.equal(linkedEntry.includes(packageName), false, "browser artifact links the public import to one emitted package graph");
  writeFileSync(join(siteRoot, "_fadeno/browser-entry.js"), linkedEntry);
  writeFileSync(join(siteRoot, "index.html"), rendered.html);
  writeFileSync(join(siteRoot, "rollback.html"), rendered.rollbackHtml);
  writeJson(join(outputRoot, "render.json"), rendered);
  writeJson(join(outputRoot, "expected-success.json"), readJson(join(scenarioRoot, "expected/success.json")));
  writeJson(join(outputRoot, "expected-recovery.json"), readJson(join(scenarioRoot, "expected/recovery.json")));

  const rootOutput = readFileSync(join(installed, "dist/index.js"), "utf8");
  const nodeOutput = readFileSync(join(installed, "dist/node.js"), "utf8");
  assert.equal(rootOutput.includes("browser-runtime"), false, "neutral root cannot reach browser runtime");
  assert.equal(nodeOutput.includes("browser-runtime"), false, "Node entry cannot reach browser runtime");
  assert.equal(readFileSync(join(installed, "dist/browser.js"), "utf8").includes("node:"), false, "browser facade has no Node dependency");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 browser runtime packed example prepared (real export, nonce-owned module, native fallback, environment refusal)");
