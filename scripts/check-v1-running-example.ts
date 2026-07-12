import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";

import { unsafeHtml, type Handler, type RenderChild } from "../packages/framework/src/index.ts";
import { FadenoDiagnosticError, formatDiagnosticHuman } from "../packages/framework/src/internal/diagnostic.ts";
import { listenNodeHttp } from "../packages/framework/src/internal/node-http.ts";
import { createFrameworkExecutableNode } from "../packages/framework/src/internal/render-node.ts";
import { renderDocument } from "../packages/framework/src/internal/renderer.ts";
import { generateRoutes } from "../packages/framework/src/internal/routing/generator.ts";
import { jsx, jsxs } from "../packages/framework/src/jsx-runtime.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");
const require = createRequire(import.meta.url);

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_V1_EXAMPLE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function expected(path: string): string {
  return readFileSync(join(exampleRoot, "scenarios/route-role-collision/expected", path), "utf8");
}

function normalizedDiagnostic(error: FadenoDiagnosticError): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    id: error.id,
    severity: error.severity,
    summary: error.summary,
    locations: error.sourceRanges,
    explanation: error.explanation,
    correction: error.correction,
  }, null, 2)}\n`;
}

function verifyFailureAndRecovery(temporaryRoot: string): void {
  const scenarioRoot = join(exampleRoot, "scenarios/route-role-collision");
  const project = join(temporaryRoot, "scenario");
  mkdirSync(join(project, "src/routes"), { recursive: true });
  cpSync(join(scenarioRoot, "after/src/routes"), join(project, "src/routes"), { recursive: true });
  generateRoutes(project, { routes: { root: "src/routes" } });
  mkdirSync(join(project, "src/routes/old"));
  writeFileSync(join(project, "src/routes/old/page.tsx"), "export default function Old(): string { return 'old'; }\n");
  generateRoutes(project, { routes: { root: "src/routes" } });
  cpSync(join(scenarioRoot, "before/src/routes/handler.ts"), join(project, "src/routes/handler.ts"));
  let diagnostic: FadenoDiagnosticError | undefined;
  try { generateRoutes(project, { routes: { root: "src/routes" } }); } catch (error) {
    if (error instanceof FadenoDiagnosticError) diagnostic = error;
    else throw error;
  }
  assert.ok(diagnostic);
  assert.equal(formatDiagnosticHuman(diagnostic), expected("diagnostic.txt"));
  assert.equal(normalizedDiagnostic(diagnostic), expected("diagnostic.json"));
  const retained = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(retained.routes.map(({ id }) => id), ["/", "/old"]);

  rmSync(join(project, "src/routes/handler.ts"));
  rmSync(join(project, "src/routes/old"), { recursive: true });
  generateRoutes(project, { routes: { root: "src/routes" } });
  const repaired = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(repaired.routes.map(({ id }) => id), ["/"]);
  assert.equal(expected("flow.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "route-role-collision",
    decision: "refuse-ambiguous-route-owner",
    causes: ["page-and-handler-share-one-route-directory"],
    ownership: { route: "/", sources: ["src/routes/handler.ts", "src/routes/page.tsx"] },
    skippedWork: ["manifest-publication", "application-binding-publication"],
    observableOutcome: diagnostic.id,
  }, null, 2)}\n`);
  assert.equal(expected("recovery.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "route-role-collision",
    correction: "remove-the-conflicting-handler",
    staleDiagnosticRemoved: true,
    staleArtifactsRemoved: true,
    publishedRouteIds: repaired.routes.map(({ id }) => id),
  }, null, 2)}\n`);
}

async function startServer(project: string): Promise<{ origin: string; stop(): Promise<void> }> {
  const child = spawn(process.execPath, ["dist/src/server.js"], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const origin = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`FADENO_V1_EXAMPLE_START_TIMEOUT\n${stderr}`)), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const line = output.split("\n").find((value) => value.includes('"event":"listening"'));
      if (!line) return;
      clearTimeout(timeout);
      try { resolve((JSON.parse(line) as { origin: string }).origin); } catch (error) { reject(error); }
    });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`FADENO_V1_EXAMPLE_START_EXIT:${code}\n${stderr}`)); });
  });
  return {
    origin,
    stop: () => new Promise<void>((resolve, reject) => {
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FADENO_V1_EXAMPLE_STOP:${code}\n${stderr}`)));
      child.kill("SIGTERM");
    }),
  };
}

const browserTypes = { chromium, firefox, webkit } satisfies Readonly<Record<string, BrowserType>>;

async function verifyParsedApplication(origin: string): Promise<void> {
  for (const [name, browserType] of Object.entries(browserTypes)) {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      const response = await page.goto(origin);
      assert.equal(response?.status(), 200, `${name}: home status`);
      assert.equal(await page.locator("h1").textContent(), "First running Fadeno application", `${name}: heading`);
      assert.equal(await page.locator("nav[aria-label='Primary'] a").count(), 2, `${name}: navigation`);
      assert.equal(await page.locator("main section").count(), 1, `${name}: semantic main`);
      assert.equal(await page.locator("footer").textContent(), "Rendered by the V1 framework", `${name}: footer`);
      assert.equal(await page.locator("script").count(), 0, `${name}: ordinary page script count`);
      await context.close();
    } finally {
      await browser.close();
    }
  }
}

function cspDocument(child: RenderChild): RenderChild {
  return jsxs("html", {
    lang: "en",
    children: [jsx("head", { children: jsx("title", { children: "CSP proof" }) }), jsx("body", { children: child })],
  });
}

async function verifyCspEnforcement(): Promise<void> {
  const handler: Handler = (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/nonce") {
      return renderDocument(cspDocument(createFrameworkExecutableNode("globalThis.__fadenoNonceExecuted = true;")), {
        request,
        frameworkExecutable: true,
      });
    }
    if (pathname === "/raw") {
      return renderDocument(cspDocument(unsafeHtml("<script>globalThis.__fadenoRawExecuted = true;</script>", {
        reason: "Deliberate CSP refusal fixture",
      })), { request });
    }
    return new Response("missing", { status: 404 });
  };
  const server = await listenNodeHttp({ handler });
  try {
    for (const [name, browserType] of Object.entries(browserTypes)) {
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const nonceResponse = await page.goto(`${server.origin}/nonce`);
        assert.equal(nonceResponse?.status(), 200, `${name}: nonce status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoNonceExecuted")), true, `${name}: matching nonce`);
        const nonce = await page.locator("script").evaluate((element) => (element as HTMLScriptElement).nonce);
        assert.ok(nonce, `${name}: nonce attribute`);
        assert.match(nonceResponse?.headers()["content-security-policy"] ?? "", new RegExp(`script-src 'nonce-${nonce}'`, "u"));

        const rawResponse = await page.goto(`${server.origin}/raw`);
        assert.equal(rawResponse?.status(), 200, `${name}: raw status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoRawExecuted")), undefined, `${name}: raw script blocked`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}

async function verifyApplication(temporaryRoot: string): Promise<void> {
  const project = join(temporaryRoot, "application");
  cpSync(exampleRoot, project, { recursive: true, filter: (source) => !source.includes("/scenarios") && !source.includes("/.fadeno") && !source.includes("/dist") && !source.includes("/node_modules") });
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["--filter", "fadeno-framework-internal", "build"], root);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = join(tarballs, readdirSync(tarballs).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
  assert.ok(existsSync(tarball));
  const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  packageJson.dependencies["fadeno-framework-internal"] = `file:${tarball}`;
  writeFileSync(join(project, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  generateRoutes(project, { routes: { root: "src/routes" } });
  run(process.execPath, [join(dirname(require.resolve("typescript/package.json")), "bin/tsc"), "-p", "tsconfig.json"], project);

  const server = await startServer(project);
  try {
    const home = await fetch(server.origin);
    const homeBody = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeBody, /^<!doctype html><html lang="en">/u);
    assert.match(homeBody, /<nav aria-label="Primary">/u);
    assert.match(homeBody, /First running Fadeno application/u);
    assert.match(homeBody, /href="\/hello\/Reader"/u);
    assert.match(home.headers.get("content-security-policy") ?? "", /script-src 'none'/u);

    const greeting = await fetch(`${server.origin}/hello/%3CReader%3E`);
    assert.equal(greeting.status, 200);
    assert.match(await greeting.text(), /Hello &lt;Reader&gt;/u);

    const missing = await fetch(`${server.origin}/missing`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Page not found/u);

    const redirect = await fetch(`${server.origin}/moved`, { redirect: "manual" });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("location"), "/hello/Redirected");

    const failure = await fetch(`${server.origin}/failure`);
    assert.equal(failure.status, 500);
    const failureBody = await failure.text();
    assert.match(failureBody, /The page could not be rendered/u);
    assert.doesNotMatch(failureBody, /private failure details/u);

    const raw = await fetch(`${server.origin}/raw`);
    assert.equal(raw.status, 200);
    assert.equal(await raw.text(), "raw:/raw");

    await verifyParsedApplication(server.origin);
  } finally {
    await server.stop();
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-running-example-"));
try {
  verifyFailureAndRecovery(temporaryRoot);
  await verifyApplication(temporaryRoot);
  await verifyCspEnforcement();
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 running example passed (packed routes, outcomes, diagnostics, flow, recovery)");
