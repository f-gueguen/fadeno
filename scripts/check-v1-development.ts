import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");
const scenarioRoot = join(exampleRoot, "scenarios/development-lifecycle");
const browserTypes = { chromium, firefox, webkit } satisfies Readonly<Record<string, BrowserType>>;

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_V1_DEVELOPMENT_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((accept, refuse) => {
    server.once("error", refuse);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V1_DEVELOPMENT_PORT");
  await new Promise<void>((accept, refuse) => server.close((error) => error ? refuse(error) : accept()));
  return address.port;
}

type RunningDevelopment = Readonly<{
  child: ChildProcessWithoutNullStreams;
  stdout(): string;
  stderr(): string;
  waitForStdout(value: string, from?: number): Promise<number>;
  waitForStderr(value: string, from?: number): Promise<number>;
  exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
}>;

function startDevelopment(
  project: string,
  port: number,
  environment: Readonly<Record<string, string>> = {},
): RunningDevelopment {
  const executable = realpathSync(join(project, "node_modules/@fadeno/framework/dist/cli.js"));
  const child = spawn(process.execPath, [executable, "dev", "--project-root", project, "--port", String(port)], {
    cwd: project,
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((accept, refuse) => {
    child.once("error", refuse);
    child.once("exit", (code, signal) => accept(Object.freeze({ code, signal })));
  });
  const waitFor = async (read: () => string, value: string, from = 0): Promise<number> => {
    for (let attempt = 0; attempt < 3_000; attempt += 1) {
      const index = read().indexOf(value, from);
      if (index >= 0) return index + value.length;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise<void>((accept) => setTimeout(accept, 10));
    }
    throw new Error(`FADENO_V1_DEVELOPMENT_WAIT:${value}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  return Object.freeze({
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    waitForStdout: (value: string, from?: number) => waitFor(() => stdout, value, from),
    waitForStderr: (value: string, from?: number) => waitFor(() => stderr, value, from),
    exit,
  });
}

async function responseText(origin: string, expected: string): Promise<string> {
  let last = "";
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      const response = await fetch(origin);
      last = await response.text();
      if (response.status === 200 && last.includes(expected)) return last;
    } catch { /* a bounded switch may briefly release the listener */ }
    await new Promise<void>((accept) => setTimeout(accept, 10));
  }
  throw new Error(`FADENO_V1_DEVELOPMENT_RESPONSE:${expected}\n${last}`);
}

function normalizeRequestEvidence(document: string): string {
  return document.replace(/resource-\d+/gu, "resource-<REQUEST>");
}

async function expectUnavailable(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await fetch(origin);
    } catch {
      return;
    }
    await new Promise<void>((accept) => setTimeout(accept, 10));
  }
  throw new Error(`FADENO_V1_DEVELOPMENT_LISTENER_RETAINED:${origin}`);
}

async function waitForPath(path: string): Promise<void> {
  if (existsSync(path)) return;
  await new Promise<void>((accept, refuse) => {
    const watcher = watch(dirname(path), () => {
      if (!existsSync(path)) return;
      watcher.close();
      accept();
    });
    watcher.once("error", (error) => {
      watcher.close();
      refuse(error);
    });
    if (existsSync(path)) {
      watcher.close();
      accept();
    }
  });
}

function copyPackedProject(temporaryRoot: string, name: string, tarball: string): string {
  const project = join(temporaryRoot, name);
  cpSync(exampleRoot, project, {
    recursive: true,
    filter: (source) => !source.includes("/scenarios") && !source.includes("/.fadeno") &&
      !source.includes("/dist") && !source.includes("/node_modules"),
  });
  const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  manifest.dependencies["@fadeno/framework"] = `file:${tarball}`;
  writeFileSync(join(project, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  return project;
}

const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "fadeno-v1-development-")));
let development: RunningDevelopment | null = null;
try {
  run("pnpm", ["--filter", "@fadeno/framework", "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = join(tarballs, readdirSync(tarballs).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
  assert.equal(existsSync(tarball), true);
  const project = copyPackedProject(temporaryRoot, "application", tarball);
  const authorityRoute = join(project, "src/routes/development-authority");
  mkdirSync(authorityRoute);
  writeFileSync(join(authorityRoute, "handler.ts"), [
    'import type { Handler } from "@fadeno/framework";',
    "const handler: Handler = (request) => Response.json({ url: request.url, origin: request.headers.get('origin') });",
    "export default handler;",
    "",
  ].join("\n"));
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  development = startDevelopment(project, port, { FADENO_ORIGIN: "https://conflicting.example" });
  let stdoutOffset = await development.waitForStdout(`Fadeno development server ready at ${origin}.\n`);
  assert.equal(development.stderr(), "");
  assert.equal(existsSync(join(project, "dist/server/development-bootstrap.js")), false);
  await responseText(origin, "Follow the request thread.");
  const authorityResponse = await fetch(`${origin}/development-authority`, { headers: { origin } });
  assert.deepEqual(await authorityResponse.json(), { url: `${origin}/development-authority`, origin });

  const actionPage = await fetch(`${origin}/projects`, { headers: { "x-fadeno-demo-https": "1" } });
  assert.equal(actionPage.status, 200);
  const actionDocument = await actionPage.text();
  const actionPath = /<form action="([^"]+)" class="form-stack"/u.exec(actionDocument)?.[1]?.replaceAll("&amp;", "&");
  const proof = /<input type="hidden" name="__fadeno_proof" value="([^"]+)"/u.exec(actionDocument)?.[1];
  const passcode = /<input id="owner-passcode" name="([^"]+)"/u.exec(actionDocument)?.[1];
  const session = actionPage.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(actionPath);
  assert.ok(proof);
  assert.ok(passcode);
  assert.ok(session);
  const actionBody = new URLSearchParams({ __fadeno_proof: proof, [passcode]: "example-owner" });
  const crossOriginAction = await fetch(new URL(actionPath, origin), {
    method: "POST",
    headers: { cookie: session, origin: "https://cross-origin.example" },
    body: actionBody,
    redirect: "manual",
  });
  assert.equal(crossOriginAction.status, 400);
  assert.match(await crossOriginAction.text(), /FADENO_ACTION_ORIGIN/u);
  const sameOriginAction = await fetch(new URL(actionPath, origin), {
    method: "POST",
    headers: { cookie: session, origin },
    body: actionBody,
    redirect: "manual",
  });
  const sameOriginText = await sameOriginAction.text();
  assert.equal(sameOriginAction.status, 303, sameOriginText);
  assert.equal(sameOriginAction.headers.get("location"), "/projects");

  for (const [browserName, browserType] of Object.entries(browserTypes)) {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        extraHTTPHeaders: { "x-fadeno-demo-https": "1" },
      });
      const page = await context.newPage();
      assert.equal((await page.goto(`${origin}/projects`))?.status(), 200);
      const anonymousCookie = (await context.cookies(origin)).find(({ name }) => name === "fadeno-development-session");
      assert.ok(anonymousCookie, `${browserName}: loopback session cookie`);
      assert.equal(anonymousCookie.httpOnly, true);
      assert.equal(anonymousCookie.secure, false);
      await page.getByLabel("Example owner passcode").fill("example-owner");
      const [signedIn] = await Promise.all([
        page.waitForNavigation(),
        page.getByRole("button", { name: "Sign in" }).click(),
      ]);
      assert.equal(signedIn?.status(), 200, `${browserName}: native form navigation`);
      assert.equal(await page.getByText("Signed in as the example owner.").count(), 1);
      await context.close();
    } finally {
      await browser.close();
    }
  }

  const runtimeOutputRoot = join(project, "src/routes/runtime-output");
  mkdirSync(runtimeOutputRoot);
  writeFileSync(join(runtimeOutputRoot, "handler.ts"), [
    'import { stdout } from "node:process";',
    'import type { Handler } from "@fadeno/framework";',
    'const runtimeLine = "x".repeat(900 * 1024);',
    "const handler: Handler = () => { stdout.write(`${runtimeLine}\\n`); return new Response('runtime-output'); };",
    "export default handler;",
    "",
  ].join("\n"));
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  for (let request = 0; request < 10; request += 1) {
    assert.equal(await responseText(`${origin}/runtime-output`, "runtime-output"), "runtime-output");
  }
  assert.equal(development.child.exitCode, null);
  await responseText(origin, "Follow the request thread.");
  rmSync(runtimeOutputRoot, { recursive: true });
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);

  const pagePath = join(project, "src/components/overview.tsx");
  const originalPage = readFileSync(pagePath, "utf8");
  writeFileSync(pagePath, originalPage.replace(
    "Follow the request thread.",
    "Direct development generation",
  ));
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Direct development generation");

  const helperPath = join(project, "src/development-message.ts");
  writeFileSync(helperPath, "export const developmentMessage = 'Transitive generation one';\n");
  writeFileSync(pagePath, originalPage
    .replace(
      'import type { RenderChild } from "@fadeno/framework";\n',
      'import type { RenderChild } from "@fadeno/framework";\nimport { developmentMessage } from "../development-message.js";\n',
    )
    .replace('<h1 id="welcome-heading">Follow the request thread.</h1>', '<h1 id="welcome-heading">{developmentMessage}</h1>'));
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Transitive generation one");
  writeFileSync(helperPath, "export const developmentMessage = 'Transitive generation two';\n");
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Transitive generation two");

  const lastGood = normalizeRequestEvidence(await responseText(origin, "Transitive generation two"));
  const stablePage = readFileSync(pagePath, "utf8");
  const startupFailureOffset = development.stderr().length;
  writeFileSync(pagePath, `throw new Error("candidate startup refusal");\n${stablePage}`);
  await development.waitForStderr(
    "FADENO_DEV_STARTUP: The development server could not start or take ownership of its address.\n",
    startupFailureOffset,
  );
  stdoutOffset = await development.waitForStdout(
    "Fadeno development diagnostics published; last accepted generation remains active.\n",
    stdoutOffset,
  );
  assert.equal(normalizeRequestEvidence(await responseText(origin, "Transitive generation two")), lastGood);
  writeFileSync(pagePath, stablePage);
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  assert.equal(normalizeRequestEvidence(await responseText(origin, "Transitive generation two")), lastGood);

  const compilerScenario = join(exampleRoot, "scenarios/build-compiler-error");
  const invalidSource = join(project, "src/build-scenario.ts");
  const expectedCompilerFailure = readFileSync(join(exampleRoot, "expected/build-typescript-error.txt"), "utf8");
  const stderrOffset = development.stderr().length;
  cpSync(join(compilerScenario, "before/src/build-scenario.ts"), invalidSource);
  await development.waitForStderr(expectedCompilerFailure, stderrOffset);
  stdoutOffset = await development.waitForStdout(
    "Fadeno development diagnostics published; last accepted generation remains active.\n",
    stdoutOffset,
  );
  assert.equal(normalizeRequestEvidence(await responseText(origin, "Transitive generation two")), lastGood);
  cpSync(join(compilerScenario, "after/src/build-scenario.ts"), invalidSource);
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), true);
  rmSync(invalidSource);
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), false);

  const configuration = join(project, "fadeno.config.ts");
  writeFileSync(configuration, `${readFileSync(configuration, "utf8")}\n// development configuration epoch\n`);
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);

  const renamedHelper = join(project, "src/development-renamed.ts");
  renameSync(helperPath, renamedHelper);
  writeFileSync(renamedHelper, "export const developmentMessage = 'Renamed transitive generation';\n");
  writeFileSync(pagePath, readFileSync(pagePath, "utf8").replace("../development-message.js", "../development-renamed.js"));
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Renamed transitive generation");

  for (const value of ["Burst generation one", "Burst generation two", "Burst generation final"]) {
    writeFileSync(renamedHelper, `export const developmentMessage = '${value}';\n`);
  }
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Burst generation final");

  const interruptedMarker = join(temporaryRoot, "interrupted-candidate-ready");
  const currentPage = readFileSync(pagePath, "utf8");
  writeFileSync(pagePath, [
    'import { writeFileSync as writeInterruptionMarker } from "node:fs";',
    `writeInterruptionMarker(${JSON.stringify(interruptedMarker)}, "ready\\n");`,
    "await new Promise<never>(() => undefined);",
    currentPage,
  ].join("\n"));
  await waitForPath(interruptedMarker);
  writeFileSync(pagePath, currentPage);
  writeFileSync(renamedHelper, "export const developmentMessage = 'Interrupted generation final';\n");
  stdoutOffset = await development.waitForStdout("Fadeno development diagnostics cleared; new generation active.\n", stdoutOffset);
  await responseText(origin, "Interrupted generation final");

  const flow = JSON.parse(readFileSync(join(scenarioRoot, "expected/flow.json"), "utf8")) as Record<string, unknown>;
  assert.equal(flow["observableOutcome"], "latest-complete-generation-served");
  assert.equal((flow["causes"] as readonly string[]).includes("active-candidate-interruption"), true);
  const recovery = JSON.parse(readFileSync(join(scenarioRoot, "expected/recovery.json"), "utf8")) as Record<string, unknown>;
  assert.equal(recovery["staleDiagnosticRemoved"], true);
  assert.equal(recovery["staleArtifactRemovedAfterOwnerDeletion"], true);
  assert.equal(
    readFileSync(join(exampleRoot, "expected/development-success.txt"), "utf8"),
    "Fadeno development server ready at http://127.0.0.1:<port>.\n",
  );
  assert.equal(development.stderr().slice(stderrOffset, stderrOffset + expectedCompilerFailure.length), expectedCompilerFailure);

  development.child.kill("SIGTERM");
  const graceful = await development.exit;
  assert.deepEqual(graceful, { code: 0, signal: null });
  assert.match(development.stdout(), /Fadeno development shutdown started\.\n/u);
  assert.match(development.stdout(), /Fadeno development server stopped\.\n/u);
  development = null;
  await expectUnavailable(origin);

  const forcedPort = await reservePort();
  const forcedOrigin = `http://127.0.0.1:${forcedPort}`;
  const hangingRoute = join(project, "src/routes/hanging/handler.ts");
  mkdirSync(join(project, "src/routes/hanging"));
  writeFileSync(hangingRoute, [
    'import type { Handler } from "@fadeno/framework";',
    "const encoder = new TextEncoder();",
    "const handler: Handler = () => new Response(new ReadableStream({",
    "  start(controller) { controller.enqueue(encoder.encode('active-stream')); },",
    "}));",
    "export default handler;",
    "",
  ].join("\n"));
  development = startDevelopment(project, forcedPort);
  await development.waitForStdout(`Fadeno development server ready at ${forcedOrigin}.\n`);
  const hangingResponse = await fetch(`${forcedOrigin}/hanging`);
  assert.equal(hangingResponse.status, 200);
  const reader = hangingResponse.body?.getReader();
  assert.ok(reader);
  assert.equal(new TextDecoder().decode((await reader.read()).value), "active-stream");
  development.child.kill("SIGTERM");
  await development.waitForStdout("Fadeno development shutdown started.\n");
  development.child.kill("SIGTERM");
  const forced = await development.exit;
  assert.deepEqual(forced, { code: 3, signal: null });
  assert.match(development.stdout(), /Fadeno development shutdown forced\.\n/u);
  try { await reader.cancel(); } catch { /* the forced child owns the closed stream */ }
  development = null;
  await expectUnavailable(forcedOrigin);

  const occupiedProject = copyPackedProject(temporaryRoot, "occupied-address", tarball);
  const occupiedPort = await reservePort();
  const occupied = createNetServer();
  await new Promise<void>((accept, refuse) => {
    occupied.once("error", refuse);
    occupied.listen(occupiedPort, "127.0.0.1", accept);
  });
  const refused = startDevelopment(occupiedProject, occupiedPort);
  const refusedExit = await refused.exit;
  await new Promise<void>((accept, refuse) => occupied.close((error) => error ? refuse(error) : accept()));
  assert.deepEqual(refusedExit, { code: 1, signal: null });
  assert.equal(refused.stdout(), "");
  assert.equal(
    refused.stderr(),
    "FADENO_DEV_STARTUP: The development server could not start or take ownership of its address.\n",
  );

  const invalidUsage = spawnSync(process.execPath, [
    realpathSync(join(project, "node_modules/@fadeno/framework/dist/cli.js")),
    "dev", "--project-root", project, "--port", "0",
  ], { cwd: project, encoding: "utf8" });
  assert.deepEqual({ status: invalidUsage.status, stdout: invalidUsage.stdout, stderr: invalidUsage.stderr }, {
    status: 2,
    stdout: "",
    stderr: "FADENO_DEV_USAGE: fadeno dev --project-root <path> --port <1..65535>\n",
  });
} finally {
  if (development && development.child.exitCode === null && development.child.signalCode === null) {
    development.child.kill("SIGKILL");
    try { await development.exit; } catch { /* cleanup */ }
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 packed development lifecycle passed");
