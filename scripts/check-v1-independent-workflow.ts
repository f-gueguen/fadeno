import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunningCommand {
  readonly child: ChildProcessWithoutNullStreams;
  stdout(): string;
  stderr(): string;
  waitForStdout(value: string): Promise<void>;
  exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");

function run(command: string, arguments_: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function requireSuccess(command: string, arguments_: readonly string[], cwd: string): CommandResult {
  const result = run(command, arguments_, cwd);
  if (result.status !== 0) {
    throw new Error(`FADENO_V1_INDEPENDENT_COMMAND:${command}:${result.status ?? "signal"}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function start(command: string, arguments_: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): RunningCommand {
  const child = spawn(command, arguments_, {
    cwd,
    env: { ...process.env, ...environment, FORCE_COLOR: "0" },
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
  const waitForStdout = async (value: string): Promise<void> => {
    for (let attempt = 0; attempt < 3_000; attempt += 1) {
      if (stdout.includes(value)) return;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise<void>((accept) => setTimeout(accept, 10));
    }
    throw new Error(`FADENO_V1_INDEPENDENT_WAIT:${value}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  return Object.freeze({ child, stdout: () => stdout, stderr: () => stderr, waitForStdout, exit });
}

async function stop(command: RunningCommand): Promise<void> {
  if (command.child.exitCode === null && command.child.signalCode === null) command.child.kill("SIGTERM");
  const result = await Promise.race([
    command.exit,
    new Promise<never>((_accept, refuse) => setTimeout(() => refuse(new Error("FADENO_V1_INDEPENDENT_SHUTDOWN")), 10_000)),
  ]);
  assert.equal(result.signal, null, `${command.stdout()}\n${command.stderr()}`);
  assert.equal(result.code, 0, `${command.stdout()}\n${command.stderr()}`);
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((accept, refuse) => {
    server.once("error", refuse);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V1_INDEPENDENT_PORT");
  await new Promise<void>((accept, refuse) => server.close((error) => error ? refuse(error) : accept()));
  return address.port;
}

async function waitForHome(origin: string): Promise<string> {
  let last = "";
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      last = await response.text();
      if (response.status === 200 && last.includes("First running Fadeno application")) return last;
    } catch { /* listener startup and shutdown are bounded below */ }
    await new Promise<void>((accept) => setTimeout(accept, 10));
  }
  throw new Error(`FADENO_V1_INDEPENDENT_HTTP:${origin}\n${last}`);
}

function operationLeaks(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return operationLeaks(path);
    if (!entry.isFile()) return [path];
    return /(?:^|[-.])(lock|request)(?:[-.]|$)/u.test(entry.name) ? [path] : [];
  });
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-independent-"));
const localCanary = join(packageRoot, "dist/v1-independent-local-canary.js");
let development: RunningCommand | null = null;
let production: RunningCommand | null = null;
try {
  rmSync(localCanary, { force: true });
  requireSuccess("pnpm", ["--filter", "@fadeno/framework", "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  requireSuccess("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_V1_INDEPENDENT_TARBALL");
  const tarball = join(tarballs, tarballName);

  writeFileSync(localCanary, "local bytes created after the reviewed tarball\n");
  const project = join(temporaryRoot, "application");
  cpSync(exampleRoot, project, {
    recursive: true,
    filter: (source) => !["node_modules", ".fadeno", "dist"].includes(basename(source)),
  });
  const manifestPath = join(project, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.equal(manifest.scripts.dev, "fadeno dev --project-root . --port 4173");
  const developmentPort = await reservePort();
  manifest.dependencies["@fadeno/framework"] = `file:${tarball}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  rmSync(join(project, "node_modules"), { recursive: true, force: true });
  requireSuccess("pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], project);
  const installedPackage = join(project, "node_modules/@fadeno/framework");
  assert.equal(existsSync(join(installedPackage, "dist", basename(localCanary))), false);
  const sourcePackageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
  const installedPackageManifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8")) as { version?: unknown };
  assert.equal(typeof sourcePackageManifest.version, "string");
  assert.equal(installedPackageManifest.version, sourcePackageManifest.version);
  const installedReadme = readFileSync(join(installedPackage, "README.md"), "utf8");
  assert.equal(installedReadme.includes(`\`${sourcePackageManifest.version}\``), true);
  assert.match(installedReadme, /experimental and not\s+production-supported/u);

  requireSuccess(process.execPath, ["--input-type=module", "--eval", [
    'await import("@fadeno/framework");',
    'await import("@fadeno/framework/node");',
    'await import("@fadeno/framework/jsx-runtime");',
  ].join("\n")], project);

  const successDiagnostic = readFileSync(join(project, "expected/check-success.txt"), "utf8");
  const checkSuccess = requireSuccess("pnpm", ["check"], project);
  assert.equal(checkSuccess.stdout.includes(successDiagnostic), true);
  const collisionPath = join(project, "src/routes/handler.ts");
  cpSync(join(project, "scenarios/analyzer-project/handler.ts"), collisionPath);
  const checkFailure = run("pnpm", ["check"], project);
  assert.notEqual(checkFailure.status, 0);
  assert.equal(`${checkFailure.stdout}${checkFailure.stderr}`.includes("FADENO_ROUTE_ROUTE_ROLE_COLLISION"), true);
  rmSync(collisionPath);
  const checkRecovery = requireSuccess("pnpm", ["check"], project);
  assert.equal(checkRecovery.stdout.includes(successDiagnostic), true);
  assert.equal(`${checkRecovery.stdout}${checkRecovery.stderr}`.includes("FADENO_ROUTE_ROUTE_ROLE_COLLISION"), false);

  const buildSuccess = requireSuccess("pnpm", ["build"], project);
  assert.equal(buildSuccess.stdout.includes("Fadeno production build complete"), true);
  const acceptedBootstrap = readFileSync(join(project, "dist/server/bootstrap.js"));
  const buildScenario = join(project, "scenarios/build-compiler-error");
  const buildScenarioSource = join(project, "src/build-scenario.ts");
  cpSync(join(buildScenario, "before/src/build-scenario.ts"), buildScenarioSource);
  const buildFailure = run("pnpm", ["build"], project);
  assert.notEqual(buildFailure.status, 0);
  assert.equal(`${buildFailure.stdout}${buildFailure.stderr}`.includes("TS2322"), true);
  assert.deepEqual(readFileSync(join(project, "dist/server/bootstrap.js")), acceptedBootstrap);
  cpSync(join(buildScenario, "after/src/build-scenario.ts"), buildScenarioSource);
  requireSuccess("pnpm", ["build"], project);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), true);
  rmSync(buildScenarioSource);
  requireSuccess("pnpm", ["build"], project);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), false);

  development = start(join(project, "node_modules/.bin/fadeno"), ["dev", "--project-root", ".", "--port", String(developmentPort)], project, {});
  await development.waitForStdout(`Fadeno development server ready at http://127.0.0.1:${developmentPort}.`);
  assert.match(await waitForHome(`http://127.0.0.1:${developmentPort}`), /First running Fadeno application/u);
  await stop(development);
  development = null;

  requireSuccess("pnpm", ["install", "--prod", "--frozen-lockfile", "--offline", "--ignore-scripts"], project);
  assert.equal(existsSync(join(project, "node_modules/@types/node")), false);
  const productionPort = await reservePort();
  production = start("pnpm", ["start"], project, {
    FADENO_PORT: String(productionPort),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: `active:${Buffer.alloc(32, 7).toString("base64url")}`,
  });
  await production.waitForStdout(`Fadeno production server ready at http://127.0.0.1:${productionPort}.`);
  assert.match(await waitForHome(`http://127.0.0.1:${productionPort}`), /First running Fadeno application/u);
  await stop(production);
  production = null;

  assert.deepEqual(operationLeaks(join(project, ".fadeno")), []);
  const transcript = [
    "packed install: current tarball, frozen lockfile, stale local canary absent",
    "public entrypoints: root, node, jsx-runtime",
    "project check: success, route-role collision, correction, stale diagnostic removed",
    "production build: success, compiler refusal, last-good preservation, correction, stale artifact removed",
    "development: supported dynamic-port command ready, HTTP 200, graceful shutdown",
    "production: production-only install, documented command ready, HTTP 200, graceful shutdown",
    "cleanup: no operation lock or request ownership retained",
  ].join("\n") + "\n";
  assert.equal(readFileSync(join(project, "expected/independent-workflow.txt"), "utf8"), transcript);
  console.log("V1 independent workflow passed (install, check, build, dev, start, failure, recovery, cleanup)");
} finally {
  if (development?.child.exitCode === null && development.child.signalCode === null) development.child.kill("SIGKILL");
  if (production?.child.exitCode === null && production.child.signalCode === null) production.child.kill("SIGKILL");
  rmSync(localCanary, { force: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
}
