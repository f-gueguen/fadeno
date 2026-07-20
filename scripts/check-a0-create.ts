import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadA0CreateContext, validateA0Create } from "./lib/a0-create-contract.ts";

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunningCommand {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  stdout(): string;
  stderr(): string;
  waitForStdout(value: string): Promise<void>;
}

interface RuntimeObservation {
  readonly homeStatus: number;
  readonly stylesheetStatus: number;
  readonly missingStatus: number;
  readonly clientScriptPresent: boolean;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenario = join(root, "examples/v1-app/scenarios/project-creation/expected");
const expectedApplication = join(scenario, "app");

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
    throw new Error(`FADENO_A0_CREATE_COMMAND:${command}:${result.status ?? "signal"}\n${result.stdout}\n${result.stderr}`);
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
    throw new Error(`FADENO_A0_CREATE_WAIT:${value}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  return Object.freeze({ child, exit, stdout: () => stdout, stderr: () => stderr, waitForStdout });
}

async function stop(command: RunningCommand): Promise<void> {
  if (command.child.exitCode === null && command.child.signalCode === null) command.child.kill("SIGTERM");
  const result = await Promise.race([
    command.exit,
    new Promise<never>((_accept, refuse) => setTimeout(() => refuse(new Error("FADENO_A0_CREATE_SHUTDOWN")), 10_000)),
  ]);
  assert.equal(result.signal, null, `${command.stdout()}\n${command.stderr()}`);
  assert.equal(result.code, 0, `${command.stdout()}\n${command.stderr()}`);
}

async function reservePort(requested = 0): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((accept, refuse) => {
    server.once("error", refuse);
    server.listen(requested, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_A0_CREATE_PORT");
  await new Promise<void>((accept, refuse) => server.close((error) => error ? refuse(error) : accept()));
  return address.port;
}

function tree(rootDirectory: string): Readonly<Record<string, string>> {
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(rootDirectory, path).split("\\").join("/")] = readFileSync(path, "utf8");
      else throw new TypeError(`FADENO_A0_CREATE_TREE_ENTRY:${path}`);
    }
  };
  visit(rootDirectory);
  return Object.freeze(files);
}

function expectedJson(name: string): unknown {
  return JSON.parse(readFileSync(join(scenario, name), "utf8"));
}

async function observeApplication(origin: string): Promise<RuntimeObservation> {
  const home = await fetch(origin, { signal: AbortSignal.timeout(2_000) });
  const homeBody = await home.text();
  const stylesheet = await fetch(`${origin}/styles`, { signal: AbortSignal.timeout(2_000) });
  const stylesheetBody = await stylesheet.text();
  const missing = await fetch(`${origin}/missing`, { signal: AbortSignal.timeout(2_000) });
  const missingBody = await missing.text();
  assert.match(homeBody, /Your Fadeno application is running/u);
  assert.match(homeBody, /<link href="\/styles" rel="stylesheet" type="text\/css">/u);
  assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css; charset=utf-8$/u);
  assert.match(stylesheetBody, /\.hero-card/u);
  assert.match(missingBody, /Page not found/u);
  return Object.freeze({
    homeStatus: home.status,
    stylesheetStatus: stylesheet.status,
    missingStatus: missing.status,
    clientScriptPresent: /<script(?:\s|>)/u.test(homeBody),
  });
}

const temporaryRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "fadeno-a0-create-packed-")));
let development: RunningCommand | null = null;
let production: RunningCommand | null = null;
try {
  const tracked = new Set(requireSuccess("git", ["ls-files", "--cached"], root).stdout.trim().split("\n"));
  const contractErrors = validateA0Create(loadA0CreateContext(root, tracked));
  if (contractErrors.length > 0) throw new Error(contractErrors.join("\n"));
  requireSuccess("pnpm", ["--filter", "@fadeno/framework", "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  requireSuccess("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_A0_CREATE_TARBALL");
  const tarball = join(tarballs, tarballName);

  const runner = join(temporaryRoot, "runner");
  mkdirSync(runner);
  writeFileSync(join(runner, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: { "@fadeno/framework": `file:${tarball}` },
  }, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], runner);
  const executable = join(runner, "node_modules/.bin/fadeno");
  assert.equal(existsSync(executable), true);

  const invalid = run(executable, ["create", "--project-root", "Bad_Name"], runner);
  const diagnostic = Object.freeze({
    command: "fadeno create --project-root Bad_Name",
    exitCode: invalid.status,
    stdout: invalid.stdout,
    stderr: invalid.stderr,
    targetExists: existsSync(join(runner, "Bad_Name")),
  });
  assert.deepEqual(diagnostic, expectedJson("diagnostic.json"));
  assert.equal(invalid.stderr, readFileSync(join(scenario, "diagnostic-human.txt"), "utf8"));
  assert.deepEqual({ projectRoot: "Bad_Name", accepted: false, diagnostic: invalid.stderr.split(":", 1)[0] },
    expectedJson("correction-before.json"));

  const realAncestor = join(runner, "real-ancestor");
  mkdirSync(join(realAncestor, "ordinary-parent"), { recursive: true });
  symlinkSync(realAncestor, join(runner, "linked-ancestor"), "dir");
  const linked = run(executable, ["create", "--project-root", "linked-ancestor/ordinary-parent/app"], runner);
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /^FADENO_CREATE_PARENT:/u);
  assert.equal(existsSync(join(realAncestor, "ordinary-parent/app")), false);

  const project = join(runner, "my-fadeno-app");
  const firstSuccess = requireSuccess(executable, ["create", "--project-root", "my-fadeno-app"], runner);
  assert.equal(firstSuccess.stdout.replaceAll(project, "<PROJECT_ROOT>"), readFileSync(join(scenario, "success.txt"), "utf8"));
  const firstTree = tree(project);
  assert.deepEqual(firstTree, tree(expectedApplication));
  assert.deepEqual({
    projectRoot: "my-fadeno-app",
    accepted: true,
    diagnostic: null,
    generatedFileCount: Object.keys(firstTree).length,
  }, expectedJson("correction-after.json"));

  const existing = run(executable, ["create", "--project-root", "my-fadeno-app"], runner);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /^FADENO_CREATE_TARGET_EXISTS:/u);
  assert.deepEqual(tree(project), firstTree);
  rmSync(project, { recursive: true });
  const retry = requireSuccess(executable, ["create", "--project-root", "my-fadeno-app"], runner);
  const retryTree = tree(project);
  assert.deepEqual(retryTree, firstTree);
  assert.deepEqual({
    failure: { diagnostic: existing.stderr.split(":", 1)[0], existingBytesPreserved: true },
    recovery: {
      targetRemovedByOwner: true,
      retryAccepted: retry.status === 0,
      staleDiagnosticPresent: `${retry.stdout}${retry.stderr}`.includes("FADENO_CREATE_TARGET_EXISTS"),
      generatedBytesMatchFirstSuccess: JSON.stringify(retryTree) === JSON.stringify(firstTree),
    },
  }, expectedJson("recovery.json"));

  const flow = {
    operation: "fadeno create",
    causes: [
      "exact create command accepted",
      "project name accepted",
      "parent path accepted",
      "missing target exclusively claimed",
    ],
    ownership: { owner: "fadeno create operation", root: "<PROJECT_ROOT>", files: "fixed template allowlist" },
    skippedWork: [
      "dependency installation",
      "network access",
      "version-control initialization",
      "generated-code execution",
    ],
    outcome: { exitCode: retry.status, generatedFileCount: Object.keys(retryTree).length, byteStable: true },
  };
  assert.deepEqual(flow, expectedJson("flow.json"));
  assert.equal(existsSync(join(project, "node_modules")), false);
  assert.equal(existsSync(join(project, ".fadeno")), false);
  assert.equal(existsSync(join(project, "dist")), false);

  const manifestPath = join(project, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.equal(manifest.scripts.dev, "fadeno dev --project-root . --port 4173");
  const developmentPort = await reservePort();
  manifest.scripts.dev = `fadeno dev --project-root . --port ${developmentPort}`;
  manifest.dependencies["@fadeno/framework"] = `file:${tarball}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  const check = requireSuccess("pnpm", ["check"], project);
  assert.match(check.stdout, /2 routes, 7 artifacts planned, no files written/u);
  const build = requireSuccess("pnpm", ["build"], project);
  assert.match(build.stdout, /10 files written to dist/u);

  development = start("pnpm", ["dev"], project, {});
  await development.waitForStdout(`Fadeno development server ready at http://127.0.0.1:${developmentPort}.`);
  const developmentObservation = await observeApplication(`http://127.0.0.1:${developmentPort}`);
  await stop(development);
  development = null;

  const productionPort = await reservePort();
  production = start("pnpm", ["start"], project, {
    FADENO_PORT: String(productionPort),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: `active:${Buffer.alloc(32, 11).toString("base64url")}`,
  });
  await production.waitForStdout(`Fadeno production server ready at http://127.0.0.1:${productionPort}.`);
  const productionObservation = await observeApplication(`http://127.0.0.1:${productionPort}`);
  await stop(production);
  production = null;

  assert.deepEqual({ development: developmentObservation, production: productionObservation }, expectedJson("runtime.json"));
  console.log("A0 packed project creation passed (exact bytes, refusal, correction, recovery, check, build, dev, start)");
} finally {
  if (development?.child.exitCode === null && development.child.signalCode === null) development.child.kill("SIGKILL");
  if (production?.child.exitCode === null && production.child.signalCode === null) production.child.kill("SIGKILL");
  rmSync(temporaryRoot, { recursive: true, force: true });
}
