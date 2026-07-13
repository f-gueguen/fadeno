import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";

import { renderRoute, unsafeHtml, type Handler, type RenderChild } from "../packages/framework/src/index.ts";
import { formatAnalyzerDiagnosticBatchHuman } from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";
import { listenNodeHttp } from "../packages/framework/src/internal/node-http.ts";
import { createFrameworkExecutableNode } from "../packages/framework/src/internal/render-node.ts";
import { renderDocument } from "../packages/framework/src/internal/renderer.ts";
import { jsx, jsxs } from "../packages/framework/src/jsx-runtime.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_V1_EXAMPLE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function runResult(command: string, arguments_: readonly string[], cwd: string): Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function treeIdentity(root: string, directory = root, records: string[] = []): string {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) treeIdentity(root, path, records);
    else if (entry.isFile()) {
      records.push(`${path.slice(root.length + 1).split("\\").join("/")}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    } else {
      throw new Error("FADENO_V1_EXAMPLE_OUTPUT_OWNERSHIP");
    }
  }
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

function treeContains(root: string, needle: string, directory = root): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (treeContains(root, needle, path)) return true;
    } else if (entry.isFile() && readFileSync(path).includes(Buffer.from(needle))) {
      return true;
    }
  }
  return false;
}

function expected(path: string): string {
  return readFileSync(join(exampleRoot, "scenarios/route-role-collision/expected", path), "utf8");
}

async function verifyFailureAndRecovery(temporaryRoot: string): Promise<void> {
  const scenarioRoot = join(exampleRoot, "scenarios/route-role-collision");
  const project = join(temporaryRoot, "scenario");
  mkdirSync(join(project, "src/routes"), { recursive: true });
  cpSync(join(scenarioRoot, "after/src/routes"), join(project, "src/routes"), { recursive: true });
  writeFileSync(join(project, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(project);
  (await analyzer.analyze().result).apply();
  mkdirSync(join(project, "src/routes/old"));
  writeFileSync(join(project, "src/routes/old/page.tsx"), "export default function Old(): string { return 'old'; }\n");
  (await analyzer.analyze().result).apply();
  cpSync(join(scenarioRoot, "before/src/routes/handler.ts"), join(project, "src/routes/handler.ts"));
  const collision = await analyzer.analyze().result;
  assert.throws(() => collision.apply(), /FADENO_ANALYZER_APPLICATION_DIAGNOSTIC/u);
  assert.equal(formatAnalyzerDiagnosticBatchHuman(collision.diagnostics), readFileSync(join(exampleRoot, "expected/check-collision.txt"), "utf8"));
  const retained = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(retained.routes.map(({ id }) => id), ["/", "/old"]);

  rmSync(join(project, "src/routes/handler.ts"));
  rmSync(join(project, "src/routes/old"), { recursive: true });
  const repairedAnalysis = await analyzer.analyze().result;
  repairedAnalysis.apply();
  const repaired = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(repaired.routes.map(({ id }) => id), ["/"]);
  const applicationBytes = readFileSync(join(project, ".fadeno/routes/app.ts"), "utf8");
  assert.doesNotMatch(applicationBytes, /\/old|old\/page/u);
  const manifestDocument = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as {
    generation: { sourceSha256: string };
  };
  const owner = JSON.parse(readFileSync(join(project, ".fadeno/routes/owner.json"), "utf8")) as {
    sourceSha256: string;
    files: readonly { path: string; sha256: string }[];
  };
  assert.equal(owner.sourceSha256, manifestDocument.generation.sourceSha256);
  assert.deepEqual(owner.files.map(({ path }) => path).sort(), ["app.ts", "index.d.ts", "index.js", "loader.ts", "manifest.json", "virtual.ts"]);
  for (const file of owner.files) {
    assert.equal(createHash("sha256").update(readFileSync(join(project, ".fadeno/routes", file.path))).digest("hex"), file.sha256);
  }
  assert.equal(expected("flow.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "route-role-collision",
    decision: "refuse-ambiguous-route-owner",
    causes: ["page-and-handler-share-one-route-directory"],
    ownership: { route: "/", sources: ["src/routes/handler.ts", "src/routes/page.tsx"] },
    skippedWork: ["manifest-publication", "application-binding-publication"],
    observableOutcome: collision.diagnostics.diagnostics.at(-1)?.code,
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

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V1_EXAMPLE_PORT");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startServer(project: string): Promise<{ origin: string; output(): string; stop(): Promise<void> }> {
  const port = await reservePort();
  const child = spawn(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: project,
    env: { ...process.env, FADENO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let output = "";
  const origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`FADENO_V1_EXAMPLE_START_TIMEOUT\n${stderr}`)), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const line = output.split("\n").find((value) => value.startsWith("Fadeno production server ready at "));
      if (!line) return;
      clearTimeout(timeout);
      const match = /^Fadeno production server ready at (http:\/\/127\.0\.0\.1:[0-9]+)\.$/u.exec(line);
      if (match?.[1]) resolve(match[1]);
      else reject(new Error("FADENO_V1_EXAMPLE_START_OUTPUT"));
    });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`FADENO_V1_EXAMPLE_START_EXIT:${code}\n${stderr}`)); });
  });
  return {
    origin,
    output: () => output,
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
    if (pathname === "/wrong") {
      return renderDocument(cspDocument(unsafeHtml("<script nonce=\"wrong\">globalThis.__fadenoWrongExecuted = true;</script>", {
        reason: "Deliberate wrong nonce fixture",
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

        const wrongResponse = await page.goto(`${server.origin}/wrong`);
        assert.equal(wrongResponse?.status(), 200, `${name}: wrong nonce status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoWrongExecuted")), undefined, `${name}: wrong nonce blocked`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}

async function verifyFailureObservation(): Promise<void> {
  const reports: Array<{
    incidentId: string;
    phase: string;
    code: string;
    projection: Readonly<Record<string, unknown>>;
    cause: unknown;
  }> = [];
  const handler: Handler = (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/pre") {
      return renderRoute({
        request,
        parameters: Object.freeze({}),
        layouts: [],
        page: () => { throw new Error("private pre-publication detail"); },
      });
    }
    return renderRoute({
      request,
      parameters: Object.freeze({}),
      layouts: [],
      page: () => cspDocument(jsx(async () => { throw new Error("private post-publication detail"); }, {})),
    });
  };
  const server = await listenNodeHttp({
    handler,
    failureObserver(report) {
      reports.push(report);
      throw new Error("deliberate reporter failure");
    },
  });
  try {
    const pre = await fetch(`${server.origin}/pre?secret=hidden`);
    assert.equal(pre.status, 500);
    const preBody = await pre.text();
    assert.doesNotMatch(preBody, /private pre-publication detail|secret=hidden/u);
    assert.match(preBody, new RegExp(`Incident ${reports[0]?.incidentId ?? "missing"}`, "u"));

    await assert.rejects(async () => {
      const post = await fetch(`${server.origin}/post`);
      assert.equal(post.status, 200);
      await post.text();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reports.length, 2);
    assert.equal(reports[0]?.phase, "pre-publication");
    assert.equal(reports[0]?.code, "FADENO_RENDER_UNEXPECTED");
    assert.equal((reports[0]?.cause as Error).message, "private pre-publication detail");
    assert.deepEqual(reports[0]?.projection["request"], { url: `${server.origin}/pre` });
    assert.equal(reports[1]?.phase, "post-publication");
    assert.equal(reports[1]?.code, "FADENO_RENDER_LATE_UNEXPECTED");
    assert.equal((reports[1]?.cause as Error).message, "private post-publication detail");
    assert.notEqual(reports[0]?.incidentId, reports[1]?.incidentId);
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
  const secretCanary = "FADENO_BUILD_SECRET_CANARY_47c50877";
  writeFileSync(join(project, ".env"), `APPLICATION_SECRET=${secretCanary}\n`);
  const build = join(project, "node_modules", ".bin", "fadeno");
  const buildArguments = ["build", "--project-root", project] as const;
  const firstBuild = runResult(build, buildArguments, project);
  assert.deepEqual(firstBuild, {
    status: 0,
    stdout: readFileSync(join(exampleRoot, "expected/build-success.txt"), "utf8"),
    stderr: "",
  });
  const acceptedIdentity = treeIdentity(join(project, "dist"));
  const acceptedManifest = readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8");
  assert.equal(treeContains(join(project, "dist"), secretCanary), false);
  const secondBuild = runResult(build, buildArguments, project);
  assert.deepEqual(secondBuild, firstBuild);
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);

  const installedFramework = realpathSync(join(project, "node_modules", "fadeno-framework-internal"));
  const privateBuild = await import(pathToFileURL(join(installedFramework, "dist/internal/project-build.js")).href) as {
    runProjectBuildCommand(
      arguments_: readonly string[],
      context: Readonly<{ cwd: string; beforeAcceptStage(stageRoot: string): void }>,
    ): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>;
  };
  const transactionFailure = await privateBuild.runProjectBuildCommand(buildArguments, {
    cwd: project,
    beforeAcceptStage(stageRoot) {
      writeFileSync(join(stageRoot, "server/bootstrap.js"), "mutated candidate\n");
    },
  });
  assert.deepEqual(transactionFailure, { exitCode: 1, stdout: "", stderr: "FADENO_BUILD_OUTPUT_STALE\n" });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);

  const buildScenario = join(exampleRoot, "scenarios/build-compiler-error");
  const scenarioSource = join(project, "src/build-scenario.ts");
  cpSync(join(buildScenario, "before/src/build-scenario.ts"), scenarioSource);
  const failedBuild = runResult(build, buildArguments, project);
  assert.deepEqual(failedBuild, {
    status: 1,
    stdout: "",
    stderr: readFileSync(join(exampleRoot, "expected/build-typescript-error.txt"), "utf8"),
  });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);
  assert.equal(readFileSync(join(buildScenario, "expected/flow.json"), "utf8"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "build-compiler-error",
    decision: "refuse-compiler-diagnostic",
    causes: ["TS2322"],
    ownership: { acceptedOutput: "dist", candidateOutput: ".fadeno/build-stage/generation-1" },
    skippedWork: ["dist-replacement", "production-start"],
    observableOutcome: "last-good-build-preserved",
  }, null, 2)}\n`);

  cpSync(join(buildScenario, "after/src/build-scenario.ts"), scenarioSource);
  const recoveredBuild = runResult(build, buildArguments, project);
  assert.equal(recoveredBuild.status, 0, recoveredBuild.stderr);
  assert.equal(recoveredBuild.stderr, "");
  assert.equal(recoveredBuild.stdout.includes("TS2322"), false);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), true);
  rmSync(scenarioSource);
  const cleanupBuild = runResult(build, buildArguments, project);
  assert.deepEqual(cleanupBuild, firstBuild);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), false);
  assert.equal(readFileSync(join(buildScenario, "expected/recovery.json"), "utf8"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "build-compiler-error",
    correction: "replace-the-invalid-value-with-a-number",
    staleDiagnosticRemoved: true,
    lastGoodBuildPreservedDuringFailure: true,
    correctedArtifactPublished: true,
    staleArtifactRemovedAfterOwnerDeletion: true,
  }, null, 2)}\n`);

  const manifest = JSON.parse(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8")) as {
    schemaVersion: number;
    compilerVersion: string;
    artifacts: number;
    files: readonly { path: string }[];
    runtime: { schemaVersion: number; files: readonly unknown[]; sha256: string };
  };
  assert.equal(readFileSync(join(exampleRoot, "expected/build-manifest-normalized.json"), "utf8"), `${JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    compilerVersion: manifest.compilerVersion,
    artifacts: manifest.artifacts,
    files: manifest.files.map(({ path }) => path),
    runtime: {
      schemaVersion: manifest.runtime.schemaVersion,
      files: manifest.runtime.files.length > 0 ? "<verified-files>" : "<missing-files>",
      sha256: /^[a-f0-9]{64}$/u.test(manifest.runtime.sha256) ? "<verified-sha256>" : "<invalid-sha256>",
    },
  }, null, 2)}\n`);

  const refusalPort = await reservePort();
  const withoutLoader = runResult(process.execPath, ["./dist/server/bootstrap.js"], project);
  assert.notEqual(withoutLoader.status, 0);
  assert.match(`${withoutLoader.stdout}${withoutLoader.stderr}`, /FADENO_BUILD_RUNTIME_PORT/u);
  const invalidPort = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: project,
    env: { ...process.env, FADENO_PORT: "0" },
    encoding: "utf8",
  });
  assert.notEqual(invalidPort.status, 0);
  assert.match(`${invalidPort.stdout}${invalidPort.stderr}`, /FADENO_BUILD_RUNTIME_PORT/u);

  const runtimeReadme = join(project, "node_modules", "fadeno-framework-internal", "README.md");
  const runtimeReadmeBytes = readFileSync(runtimeReadme);
  try {
    writeFileSync(runtimeReadme, Buffer.concat([runtimeReadmeBytes, Buffer.from("\nmutation\n")]));
    const staleRuntime = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
      cwd: project,
      env: { ...process.env, FADENO_PORT: String(refusalPort) },
      encoding: "utf8",
    });
    assert.notEqual(staleRuntime.status, 0);
    assert.match(`${staleRuntime.stdout}${staleRuntime.stderr}`, /FADENO_BUILD_RUNTIME_IDENTITY/u);
    assert.doesNotMatch(staleRuntime.stdout, /production server ready/u);
  } finally {
    writeFileSync(runtimeReadme, runtimeReadmeBytes);
  }

  const missingLoader = spawnSync(process.execPath, ["./dist/server/bootstrap.js"], {
    cwd: project,
    env: { ...process.env, FADENO_PORT: String(refusalPort) },
    encoding: "utf8",
  });
  assert.notEqual(missingLoader.status, 0);
  assert.match(`${missingLoader.stdout}${missingLoader.stderr}`, /ERR_UNSUPPORTED_ESM_URL_SCHEME/u);
  assert.doesNotMatch(missingLoader.stdout, /production server ready/u);

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

    const adminMissing = await fetch(`${server.origin}/admin/missing`);
    assert.equal(adminMissing.status, 404);
    const adminMissingBody = await adminMissing.text();
    assert.match(adminMissingBody, /Administration/u);
    assert.match(adminMissingBody, /Administrative page not found/u);
    assert.doesNotMatch(adminMissingBody, /Shop page not found/u);

    const shopMissing = await fetch(`${server.origin}/shop/missing`);
    assert.equal(shopMissing.status, 404);
    const shopMissingBody = await shopMissing.text();
    assert.match(shopMissingBody, /Shop page not found/u);
    assert.doesNotMatch(shopMissingBody, /Administrative page not found/u);

    const redirect = await fetch(`${server.origin}/moved`, { redirect: "manual" });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("location"), "/hello/Redirected");

    const failure = await fetch(`${server.origin}/failure`);
    assert.equal(failure.status, 500);
    const failureBody = await failure.text();
    assert.match(failureBody, /The page could not be rendered/u);
    assert.doesNotMatch(failureBody, /private failure details/u);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failureEvent = server.output().split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((event) => event["event"] === "framework-failure");
    assert.ok(failureEvent);
    const incidentId = /Incident ([a-f0-9-]+)/u.exec(failureBody)?.[1];
    assert.equal(failureEvent["incidentId"], incidentId);
    const normalizedFailure = {
      ...failureEvent,
      incidentId: "<incident>",
      projection: {
        ...(failureEvent["projection"] as Record<string, unknown>),
        request: { url: "<origin>/failure" },
      },
    };
    assert.equal(
      readFileSync(join(exampleRoot, "expected/failure-report.json"), "utf8"),
      `${JSON.stringify(normalizedFailure, null, 2)}\n`,
    );

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
  await verifyFailureAndRecovery(temporaryRoot);
  await verifyApplication(temporaryRoot);
  await verifyCspEnforcement();
  await verifyFailureObservation();
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 running example passed (packed routes, outcomes, diagnostics, flow, recovery)");
