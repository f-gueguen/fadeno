import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanModuleReferences } from "./lib/package-boundaries.ts";

interface PackedIdentity {
  readonly bin: Readonly<{ fadeno: "./dist/cli.js" }>;
  readonly files: readonly Readonly<{ path: string; sha256: string }>[];
}

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command: string, arguments_: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function requireSuccess(command: string, arguments_: readonly string[], cwd: string): string {
  const result = run(command, arguments_, cwd);
  if (result.status !== 0) throw new Error(`FADENO_ANALYZER_WORKFLOW_COMMAND:${command}:${result.status}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function packageIdentity(packageDirectory: string): PackedIdentity {
  const manifestBytes = readFileSync(join(packageDirectory, "package.json"), "utf8");
  const manifest = JSON.parse(manifestBytes) as { bin?: unknown };
  assert.deepEqual(manifest.bin, { fadeno: "./dist/cli.js" });
  const pending = [join(packageDirectory, "dist/cli.js")];
  const files = new Map<string, string>([["package.json", sha256(Buffer.from(manifestBytes.trimEnd()))]]);
  while (pending.length > 0) {
    const path = pending.pop()!;
    const containment = relative(packageDirectory, path);
    if (containment.startsWith("..") || isAbsolute(containment) || !existsSync(path)) throw new Error("FADENO_PACKED_IDENTITY_CONTAINMENT");
    const key = containment.split("\\").join("/");
    if (files.has(key)) continue;
    const bytes = readFileSync(path);
    files.set(key, sha256(bytes));
    for (const reference of scanModuleReferences(bytes.toString("utf8"))) {
      if (!reference.specifier.startsWith(".")) continue;
      pending.push(resolve(dirname(path), reference.specifier));
    }
  }
  return Object.freeze({
    bin: Object.freeze({ fadeno: "./dist/cli.js" as const }),
    files: Object.freeze([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([path, digest]) => Object.freeze({ path, sha256: digest }))),
  });
}

function assertPackageIdentity(packageDirectory: string, expected: PackedIdentity): void {
  const actual = packageIdentity(packageDirectory);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError("FADENO_PACKED_IDENTITY_STALE");
}

function fixture(name: string): string {
  return readFileSync(join(root, "examples/v1-app/expected", name), "utf8");
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-workflow-"));
try {
  requireSuccess("pnpm", ["--filter", "fadeno-framework-internal", "build"], root);
  const builtIdentity = packageIdentity(packageRoot);
  const tarballs = join(temporary, "tarballs");
  mkdirSync(tarballs);
  requireSuccess("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_ANALYZER_WORKFLOW_TARBALL");

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: "fadeno-project-check-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { "fadeno-framework-internal": `file:${join(tarballs, tarballName)}` },
  }, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  const installedPackage = join(consumer, "node_modules/fadeno-framework-internal");
  assertPackageIdentity(installedPackage, builtIdentity);

  const installedCli = join(installedPackage, "dist/cli.js");
  const installedCliBytes = readFileSync(installedCli);
  writeFileSync(installedCli, `${installedCliBytes.toString("utf8")}\n// stale package canary\n`);
  assert.throws(() => assertPackageIdentity(installedPackage, builtIdentity), /FADENO_PACKED_IDENTITY_STALE/u);
  writeFileSync(installedCli, installedCliBytes);
  assertPackageIdentity(installedPackage, builtIdentity);

  const application = join(consumer, "app");
  mkdirSync(application);
  cpSync(join(root, "examples/v1-app/src"), join(application, "src"), { recursive: true });
  cpSync(join(root, "examples/v1-app/fadeno.config.ts"), join(application, "fadeno.config.ts"));
  const executable = join(consumer, "node_modules/.bin/fadeno");

  const absolute = run(executable, ["check", "--project-root", application], consumer);
  assert.deepEqual(absolute, { status: 0, stdout: fixture("check-success.txt"), stderr: "" });
  const relative = run(executable, ["check", "--project-root", "app"], consumer);
  assert.deepEqual(relative, absolute);
  const successFlow = run(executable, ["check", "--project-root", "app", "--explain"], consumer);
  assert.deepEqual(successFlow, { status: 0, stdout: fixture("check-success-explain.txt"), stderr: "" });

  const collisionPath = join(application, "src/routes/handler.ts");
  cpSync(join(root, "examples/v1-app/scenarios/analyzer-project/handler.ts"), collisionPath);
  const collision = run(executable, ["check", "--project-root", "app"], consumer);
  assert.deepEqual(collision, { status: 1, stdout: "", stderr: fixture("check-collision.txt") });
  const collisionFlow = run(executable, ["check", "--project-root", "app", "--explain"], consumer);
  assert.deepEqual(collisionFlow, { status: 1, stdout: "", stderr: fixture("check-collision-explain.txt") });

  rmSync(collisionPath);
  const recovery = run(executable, ["check", "--project-root", "app"], consumer);
  assert.deepEqual(recovery, absolute);
  assert.equal(`${recovery.stdout}${recovery.stderr}`.includes("FADENO_ROUTE_ROUTE_ROLE_COLLISION"), false);
  assert.equal(existsSync(join(application, ".fadeno")), false);
  assert.equal(existsSync(join(application, "dist")), false);

  const mutationPath = join(application, "changed-by-check.txt");
  writeFileSync(join(application, "fadeno.config.ts"), [
    'import { writeFileSync } from "node:fs";',
    'console.log("FADENO_CONFIG_SECRET_STDOUT");',
    'process.stderr.write("FADENO_CONFIG_SECRET_STDERR\\n");',
    'writeFileSync(new URL("./changed-by-check.txt", import.meta.url), "changed");',
    "export default { routes: { root: 'src/routes' } };",
    "",
  ].join("\n"));
  const sideEffecting = run(executable, ["check", "--project-root", "app"], consumer);
  assert.equal(sideEffecting.status, 1);
  assert.match(sideEffecting.stderr, /^FADENO_CONFIG_STATIC:/u);
  assert.equal(`${sideEffecting.stdout}${sideEffecting.stderr}`.includes("CONFIG_SECRET"), false);
  assert.equal(existsSync(mutationPath), false);

  for (const arguments_ of [
    ["check", "--project-root", "app", "--json"],
    ["check", "--project-root", "app", "--format", "json"],
  ]) {
    assert.deepEqual(run(executable, arguments_, consumer), {
      status: 2,
      stdout: "",
      stderr: "FADENO_CHECK_USAGE: fadeno check --project-root <path> [--explain]\n",
    });
  }

  console.log("V1 packed project check passed (identity, success, collision, flow, recovery, no writes)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
