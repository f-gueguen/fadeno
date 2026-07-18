import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { request as requestHttp } from "node:http";
import { request as requestHttps, createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

interface SecureDeployment {
  readonly backend: RunningCommand;
  readonly proxy: HttpsServer;
  readonly origin: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");
const scenario = join(exampleRoot, "scenarios/deployment/expected");
const startArguments = ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"] as const;
const keyring = `active:${Buffer.alloc(32, 23).toString("base64url")}`;

function run(command: string, arguments_: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = {}): CommandResult {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function requireSuccess(command: string, arguments_: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = {}): CommandResult {
  const result = run(command, arguments_, cwd, environment);
  if (result.status !== 0) {
    throw new Error(`FADENO_A0_DEPLOY_COMMAND:${command}:${result.status ?? "signal"}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function start(command: string, arguments_: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): RunningCommand {
  const child = spawn(command, arguments_, {
    cwd,
    env: { ...process.env, ...environment, FORCE_COLOR: "0", NO_COLOR: "1" },
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
    throw new Error(`FADENO_A0_DEPLOY_WAIT:${value}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  return Object.freeze({ child, exit, stdout: () => stdout, stderr: () => stderr, waitForStdout });
}

async function stop(command: RunningCommand): Promise<boolean> {
  if (command.child.exitCode === null && command.child.signalCode === null) command.child.kill("SIGTERM");
  const result = await Promise.race([
    command.exit,
    new Promise<never>((_accept, refuse) => setTimeout(() => refuse(new Error("FADENO_A0_DEPLOY_SHUTDOWN")), 10_000)),
  ]);
  assert.equal(result.signal, null, `${command.stdout()}\n${command.stderr()}`);
  assert.equal(result.code, 0, `${command.stdout()}\n${command.stderr()}`);
  return true;
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((accept, refuse) => {
    server.once("error", refuse);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_A0_DEPLOY_PORT");
  await new Promise<void>((accept, refuse) => server.close((error) => error ? refuse(error) : accept()));
  return address.port;
}

function startArtifact(artifact: string, port: number, origin: string, sessionKeys: string): RunningCommand {
  return start(process.execPath, startArguments, artifact, {
    FADENO_PORT: String(port),
    FADENO_ORIGIN: origin,
    FADENO_SESSION_KEYS: sessionKeys,
  });
}

async function startSecureDeployment(artifact: string): Promise<SecureDeployment> {
  const externalPort = await reservePort();
  const backendPort = await reservePort();
  const origin = `https://127.0.0.1:${externalPort}`;
  const backend = startArtifact(artifact, backendPort, origin, keyring);
  await backend.waitForStdout(`Fadeno production server ready at http://127.0.0.1:${backendPort}.`);
  const proxy = createHttpsServer({
    key: readFileSync(join(root, "scripts/fixtures/v1-example-tls-key.pem")),
    cert: readFileSync(join(root, "scripts/fixtures/v1-example-tls-cert.pem")),
  }, (request, response) => {
    const forwarded = new URL(request.url ?? "/", `http://127.0.0.1:${backendPort}`);
    const client = requestHttp(forwarded, { method: request.method, headers: request.headers }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    client.once("error", (error) => response.destroy(error));
    request.pipe(client);
  });
  await new Promise<void>((accept, refuse) => {
    proxy.once("error", refuse);
    proxy.listen(externalPort, "127.0.0.1", accept);
  });
  return Object.freeze({ backend, proxy, origin });
}

async function secureHealth(origin: string): Promise<Readonly<{ status: number; body: string }>> {
  return await new Promise((accept, refuse) => {
    const request = requestHttps(origin, { rejectUnauthorized: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", refuse);
      response.once("end", () => accept(Object.freeze({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      })));
    });
    request.once("error", refuse);
    request.end();
  });
}

async function stopSecure(deployment: SecureDeployment): Promise<boolean> {
  await new Promise<void>((accept, refuse) => deployment.proxy.close((error) => error ? refuse(error) : accept()));
  return await stop(deployment.backend);
}

function expected(name: string): string {
  return readFileSync(join(scenario, name), "utf8");
}

function expectedJson(name: string): unknown {
  return JSON.parse(expected(name));
}

function artifactIdentity(rootDirectory: string): string {
  const records: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const owned = relative(rootDirectory, path).split("\\").join("/");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) records.push(`file\0${owned}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      else if (entry.isSymbolicLink()) records.push(`link\0${owned}\0${readlinkSync(path)}`);
      else throw new Error(`FADENO_A0_DEPLOY_ENTRY:${owned}`);
    }
  };
  visit(rootDirectory);
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

function treeContains(rootDirectory: string, needle: string): boolean {
  const bytes = Buffer.from(needle);
  const visit = (directory: string): boolean => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && visit(path)) return true;
      if (entry.isFile() && readFileSync(path).includes(bytes)) return true;
    }
    return false;
  };
  return visit(rootDirectory);
}

function startRefusal(artifact: string, environment: NodeJS.ProcessEnv): CommandResult {
  const sanitized = { ...process.env };
  delete sanitized["FADENO_ORIGIN"];
  delete sanitized["FADENO_SESSION_KEYS"];
  const result = spawnSync(process.execPath, startArguments, {
    cwd: artifact,
    encoding: "utf8",
    env: { ...sanitized, ...environment, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

const temporaryRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "fadeno-a0-deploy-packed-")));
let active: SecureDeployment | null = null;
try {
  requireSuccess("pnpm", ["--filter", "@fadeno/framework", "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  requireSuccess("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_A0_DEPLOY_TARBALL");
  const tarball = join(tarballs, tarballName);

  const project = join(temporaryRoot, "application");
  cpSync(exampleRoot, project, {
    recursive: true,
    filter: (source) => !["node_modules", ".fadeno", "dist", "expected", "scenarios"].some((name) =>
      source === join(exampleRoot, name) || source.startsWith(`${join(exampleRoot, name)}/`)),
  });
  const packagePath = join(project, "package.json");
  const projectPackage = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown> & {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  projectPackage["packageManager"] = "pnpm@11.7.0";
  projectPackage.dependencies["@fadeno/framework"] = `file:${tarball}`;
  projectPackage.scripts["postinstall"] = "node --input-type=module --eval \"await import('node:fs/promises').then(({writeFile}) => writeFile('.lifecycle-canary', 'executed'))\"";
  writeFileSync(packagePath, `${JSON.stringify(projectPackage, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  assert.equal(existsSync(join(project, ".lifecycle-canary")), false);
  const executable = join(project, "node_modules/.bin/fadeno");
  const secret = "FADENO_DEPLOY_SECRET_CANARY_0c8e1f62";
  writeFileSync(join(project, ".env"), `APPLICATION_SECRET=${secret}\n`);

  const usage = run(executable, ["deploy", "--project-root", project], project);
  assert.deepEqual(usage, {
    status: 2,
    stdout: "",
    stderr: "FADENO_DEPLOY_USAGE: fadeno deploy --project-root <path> --output <missing-path>\n",
  });
  const containedOutput = join(project, ".fadeno/deployment");
  const contained = run(executable, ["deploy", "--project-root", project, "--output", containedOutput], project);
  assert.equal(contained.status, 1);
  assert.match(contained.stderr, /^FADENO_DEPLOY_OUTPUT_BOUNDARY:/u);
  assert.equal(existsSync(containedOutput), false);

  const existingOutput = join(temporaryRoot, "existing-release");
  mkdirSync(existingOutput);
  writeFileSync(join(existingOutput, "sentinel"), "preserve\n");
  const existing = run(executable, ["deploy", "--project-root", project, "--output", existingOutput], project);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /^FADENO_DEPLOY_TARGET_EXISTS:/u);
  assert.equal(readFileSync(join(existingOutput, "sentinel"), "utf8"), "preserve\n");

  const release1 = join(temporaryRoot, "release-1");
  const first = requireSuccess(executable, ["deploy", "--project-root", project, "--output", release1], project);
  assert.equal(first.stdout.replaceAll(release1, "<ARTIFACT_ROOT>"), expected("success.txt"));
  const release1Identity = artifactIdentity(release1);
  const runtimePackage = JSON.parse(readFileSync(join(release1, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.deepEqual({
    schemaVersion: 1,
    rootEntries: readdirSync(release1).sort(),
    runtimeManifestFields: Object.keys(runtimePackage).sort(),
    start: runtimePackage.scripts["start"],
    sourcePresent: existsSync(join(release1, "src")),
    testPresent: existsSync(join(release1, "test")),
    configurationPresent: existsSync(join(release1, "fadeno.config.ts")),
    environmentPresent: existsSync(join(release1, ".env")),
    lockfilePresent: existsSync(join(release1, "pnpm-lock.yaml")),
    projectDevelopmentDependencyPresent: existsSync(join(release1, "node_modules/@types/node")),
    lifecycleSideEffectPresent: existsSync(join(release1, ".lifecycle-canary")),
    secretPresent: treeContains(release1, secret),
    runtimeClosureVerified: true,
  }, expectedJson("artifact.json"));

  const missingConfiguration = startRefusal(release1, { FADENO_PORT: String(await reservePort()) });
  assert.equal(missingConfiguration.status, 1);
  assert.equal(`${missingConfiguration.stdout}${missingConfiguration.stderr}`, expected("diagnostic-human.txt"));
  assert.deepEqual({
    operation: "start-candidate",
    exitCode: missingConfiguration.status,
    code: missingConfiguration.stderr.trim(),
    ready: missingConfiguration.stdout.includes("production server ready"),
  }, expectedJson("diagnostic.json"));
  assert.deepEqual({
    artifact: basename(release1),
    origin: null,
    sessionKeys: null,
    accepted: false,
    diagnostic: missingConfiguration.stderr.trim(),
  }, expectedJson("correction-before.json"));

  const insecureOrigin = startRefusal(release1, {
    FADENO_PORT: String(await reservePort()),
    FADENO_ORIGIN: "http://app.example",
    FADENO_SESSION_KEYS: keyring,
  });
  assert.equal(insecureOrigin.status, 1);
  assert.equal(insecureOrigin.stderr.trim(), "FADENO_ACTION_ORIGIN");
  const invalidKeys = startRefusal(release1, {
    FADENO_PORT: String(await reservePort()),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: "invalid",
  });
  assert.equal(invalidKeys.status, 1);
  assert.equal(invalidKeys.stderr.trim(), "FADENO_SESSION_KEYS");

  active = await startSecureDeployment(release1);
  const firstHealth = await secureHealth(active.origin);
  assert.equal(firstHealth.status, 200);
  assert.match(firstHealth.body, /First running Fadeno application/u);
  const correctedOrigin = active.origin.replace(/:\d+$/u, ":<PORT>");
  assert.deepEqual({
    artifact: basename(release1),
    origin: correctedOrigin,
    sessionKeys: "<INJECTED_KEYRING>",
    accepted: true,
    health: { path: "/", status: firstHealth.status, document: "First running Fadeno application" },
  }, expectedJson("correction-after.json"));
  const firstGracefulStop = await stopSecure(active);
  active = null;

  const staleRoute = join(project, "src/routes/deployment-stale/page.tsx");
  mkdirSync(join(project, "src/routes/deployment-stale"), { recursive: true });
  writeFileSync(staleRoute, [
    'import type { Page } from "@fadeno/framework";',
    "const page: Page = () => <p>stale deployment route</p>;",
    "export default page;",
    "",
  ].join("\n"));
  const release2 = join(temporaryRoot, "release-2");
  requireSuccess(executable, ["deploy", "--project-root", project, "--output", release2], project);
  assert.equal(existsSync(join(release2, "dist/src/routes/deployment-stale/page.js")), true);
  appendFileSync(join(release2, "dist/server/bootstrap.js"), "\n// corrupted candidate\n");
  const failedCandidate = startRefusal(release2, {
    FADENO_PORT: String(await reservePort()),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: keyring,
  });
  assert.equal(failedCandidate.status, 1);
  assert.equal(failedCandidate.stderr.trim(), "FADENO_BUILD_RUNTIME_IDENTITY");
  assert.equal(failedCandidate.stdout.includes("production server ready"), false);

  active = await startSecureDeployment(release1);
  const rollbackHealth = await secureHealth(active.origin);
  const rollbackGracefulStop = await stopSecure(active);
  active = null;
  assert.equal(rollbackHealth.status, 200);
  assert.equal(artifactIdentity(release1), release1Identity);

  unlinkSync(staleRoute);
  rmSync(join(project, "src/routes/deployment-stale"), { recursive: true });
  const release3 = join(temporaryRoot, "release-3");
  const correctedDeploy = requireSuccess(executable, ["deploy", "--project-root", project, "--output", release3], project);
  assert.equal(correctedDeploy.stdout.includes("FADENO_BUILD_RUNTIME_IDENTITY"), false);
  assert.equal(existsSync(join(release3, "dist/src/routes/deployment-stale/page.js")), false);
  active = await startSecureDeployment(release3);
  const recoveryHealth = await secureHealth(active.origin);
  const recoveryGracefulStop = await stopSecure(active);
  active = null;
  assert.equal(recoveryHealth.status, 200);

  assert.deepEqual({
    failedCandidate: {
      artifact: basename(release2),
      diagnostic: failedCandidate.stderr.trim(),
      ready: failedCandidate.stdout.includes("production server ready"),
    },
    rollback: {
      artifact: basename(release1),
      bytesUnchanged: artifactIdentity(release1) === release1Identity,
      healthStatus: rollbackHealth.status,
      gracefulStop: rollbackGracefulStop,
    },
    recovery: {
      artifact: basename(release3),
      accepted: correctedDeploy.status === 0,
      healthStatus: recoveryHealth.status,
      staleDiagnosticPresent: `${correctedDeploy.stdout}${correctedDeploy.stderr}`.includes("FADENO_BUILD_RUNTIME_IDENTITY"),
      staleGeneratedRoutePresent: existsSync(join(release3, "dist/src/routes/deployment-stale/page.js")),
    },
  }, expectedJson("recovery.json"));

  assert.deepEqual({
    operation: "fadeno deploy",
    causes: [
      "accepted production build",
      "pinned production-only dependency installation",
      "build and installed-runtime identity verification",
      "process-injected external origin and session key ring",
      "application-owned health through the external HTTPS boundary",
    ],
    ownership: {
      source: "application project",
      artifact: "missing immutable release directory",
      listener: "Fadeno loopback process",
      https: "operator boundary",
      runtimeConfiguration: "process environment",
      rollback: "previous immutable release directory",
    },
    skippedWork: [
      "application source and tests",
      "project development dependencies",
      "environment and secret files",
      "dependency lifecycle scripts",
      "existing-release overwrite",
      "public machine schema",
      "multi-process session ownership",
    ],
    outcome: {
      artifactAccepted: first.status === 0,
      secureHealthStatus: firstHealth.status,
      gracefulStop: firstGracefulStop && recoveryGracefulStop,
      failedCandidateRefused: failedCandidate.status === 1,
      priorReleaseRestarted: rollbackHealth.status === 200,
      correctedReleaseAccepted: recoveryHealth.status === 200,
    },
  }, expectedJson("flow.json"));

  const lockPath = join(project, "pnpm-lock.yaml");
  const lockBytes = readFileSync(lockPath);
  unlinkSync(lockPath);
  const missingLockOutput = join(temporaryRoot, "missing-lock-release");
  const missingLock = run(executable, ["deploy", "--project-root", project, "--output", missingLockOutput], project);
  assert.equal(missingLock.status, 1);
  assert.match(missingLock.stderr, /^FADENO_DEPLOY_LOCKFILE:/u);
  assert.equal(existsSync(missingLockOutput), false);
  writeFileSync(lockPath, lockBytes);

  console.log("A0 packed deployment passed (production artifact, secure health, refusal, rollback, stale-output recovery)");
} finally {
  if (active) {
    try { active.proxy.close(); } catch { /* best-effort harness cleanup */ }
    if (active.backend.child.exitCode === null && active.backend.child.signalCode === null) active.backend.child.kill("SIGKILL");
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
