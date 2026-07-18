import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type RuntimeIdentity = Readonly<{
  schemaVersion: 1;
  files: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  sha256: string;
}>;
type DecisionModule = Readonly<{
  assertPrivateRuntimeIdentity(root: string, expected: RuntimeIdentity): void;
  capturePrivateEnvironment(root: string, values: Readonly<Record<string, string | undefined>>): Readonly<{
    values: Readonly<Record<string, string>>;
    sha256: string;
  }>;
  capturePrivateRuntimeIdentity(root: string, paths: readonly string[]): RuntimeIdentity;
}>;
type ChildResult = Readonly<{
  schemaVersion: 1;
  generation: number;
  status: "diagnostics" | "emitted";
  environmentSha256: string;
  inputSha256: string;
  diagnostics: readonly Readonly<{
    code: number;
    category: number;
    file: string | null;
    start: number | null;
    end: number | null;
    rangeReason: "global" | null;
    text: string;
  }>[];
  output?: RuntimeIdentity;
  operationSha256?: string;
}>;

const packageName = "@fadeno/framework";
const repositoryRoot = realpathSync(new URL("../", import.meta.url).pathname);

function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function identityPaths(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new Error("FADENO_BUILD_DECISION_RUNTIME_SYMLINK");
    if (entry.isDirectory()) paths.push(...identityPaths(root, path));
    else if (entry.isFile()) paths.push(path.slice(root.length + 1).split("\\").join("/"));
    else throw new Error("FADENO_BUILD_DECISION_RUNTIME_FILE");
  }
  return paths;
}
function run(command: string, arguments_: readonly string[], cwd: string, environment?: Readonly<Record<string, string>>): string {
  const result = spawnSync(command, arguments_, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_BUILD_DECISION_COMMAND:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function projectSources(
  projectRoot: string,
  generation: number,
  handlerValue: string,
  runtimeGuard: Readonly<{ root: string; identity: RuntimeIdentity }>,
  invalid = false,
): void {
  mkdirSync(join(projectRoot, ".fadeno/routes"), { recursive: true });
  mkdirSync(join(projectRoot, "server"), { recursive: true });
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  mkdirSync(join(projectRoot, "types"), { recursive: true });
  writeJson(join(projectRoot, "package.json"), { name: "fadeno-private-build-decision-project", private: true, type: "module" });
  writeJson(join(projectRoot, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      rootDir: ".",
      outDir: "dist",
      jsx: "react-jsx",
      jsxImportSource: packageName,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      isolatedModules: true,
      strict: true,
      types: ["node"],
    },
    include: [".fadeno/routes/**/*.ts", "server/**/*.ts", "src/**/*.ts", "types/**/*.d.ts"],
  });
  writeFileSync(join(projectRoot, ".fadeno/routes/loader.ts"), [
    'import { registerHooks } from "node:module";',
    "registerHooks({",
    "  resolve(specifier, context, nextResolve) {",
    "    if (specifier === 'fadeno:routes') return { url: new URL('./virtual.js', import.meta.url).href, shortCircuit: true };",
    "    return nextResolve(specifier, context);",
    "  },",
    "});",
    "",
  ].join("\n"));
  writeFileSync(join(projectRoot, ".fadeno/routes/virtual.ts"), `export const generation = ${generation};\n`);
  writeFileSync(join(projectRoot, "types/fadeno-routes.d.ts"), 'declare module "fadeno:routes" { export const generation: number; }\n');
  writeFileSync(join(projectRoot, "src/handler.ts"), invalid
    ? 'export const handlerValue: number = "invalid";\n'
    : `export const handlerValue = ${JSON.stringify(handlerValue)};\n`);
  writeFileSync(join(projectRoot, "server/bootstrap.ts"), [
    'import { createHash } from "node:crypto";',
    'import { lstatSync, readFileSync, realpathSync } from "node:fs";',
    'import { join } from "node:path";',
    `const runtimeRoot = ${JSON.stringify(runtimeGuard.root)};`,
    `const expected = ${JSON.stringify(runtimeGuard.identity)} as const;`,
    "const identity = createHash('sha256');",
    "for (const file of expected.files) {",
    "  const path = join(runtimeRoot, file.path);",
    "  const metadata = lstatSync(path);",
    "  if (metadata.isSymbolicLink() || !metadata.isFile() || realpathSync(path) !== path) throw new Error('FADENO_TEST_RUNTIME_IDENTITY');",
    "  const bytes = readFileSync(path);",
    "  const sha256 = createHash('sha256').update(bytes).digest('hex');",
    "  if (bytes.byteLength !== file.bytes || sha256 !== file.sha256) throw new Error('FADENO_TEST_RUNTIME_IDENTITY');",
    "  identity.update(`${file.path}\\0${file.bytes}\\0${file.sha256}\\n`);",
    "}",
    "if (identity.digest('hex') !== expected.sha256) throw new Error('FADENO_TEST_RUNTIME_IDENTITY');",
    'const { generation } = await import("fadeno:routes");',
    'const { handlerValue } = await import("../src/handler.js");',
    "process.stdout.write(`${JSON.stringify({ generation, handlerValue, environment: process.env['GENERATION_VALUE'], pid: process.pid })}\\n`);",
    "",
  ].join("\n"));
}

function acceptStage(projectRoot: string, stageRoot: string): void {
  const output = join(projectRoot, "dist");
  const rollback = join(projectRoot, ".fadeno/build-stage/rollback");
  rmSync(rollback, { recursive: true, force: true });
  if (readdirSync(join(projectRoot, ".fadeno/build-stage")).includes("rollback")) throw new Error("FADENO_BUILD_DECISION_ROLLBACK");
  try {
    renameSync(output, rollback);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    renameSync(stageRoot, output);
    rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    try { renameSync(rollback, output); } catch { /* the assertion below preserves the original failure */ }
    throw error;
  }
}

function runtime(projectRoot: string, environment: Readonly<Record<string, string>>, withLoader = true): Readonly<{
  generation: number;
  handlerValue: string;
  environment: string;
  pid: number;
}> {
  const arguments_ = withLoader
    ? ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"]
    : ["./dist/server/bootstrap.js"];
  const result = spawnSync(process.execPath, arguments_, { cwd: projectRoot, env: environment, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (!withLoader) {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /ERR_UNSUPPORTED_ESM_URL_SCHEME/u);
    return Object.freeze({ generation: 0, handlerValue: "", environment: "", pid: 0 });
  }
  if (result.error || result.status !== 0) throw new Error(`FADENO_BUILD_DECISION_RUNTIME\n${result.stdout}\n${result.stderr}`);
  return Object.freeze(JSON.parse(result.stdout.trim()) as { generation: number; handlerValue: string; environment: string; pid: number });
}

function assertRuntimeIdentityRefusal(projectRoot: string, environment: Readonly<Record<string, string>>): void {
  const result = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /FADENO_TEST_RUNTIME_IDENTITY/u);
}

const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "fadeno-v1-build-dev-packed-decision-"));
try {
  run("pnpm", ["--filter", packageName, "build"], repositoryRoot);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], join(repositoryRoot, "packages/framework"));
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  assert.ok(tarballName);
  const consumerRoot = join(temporaryRoot, "consumer");
  mkdirSync(consumerRoot);
  writeJson(join(consumerRoot, "package.json"), {
    name: "fadeno-private-build-decision-consumer",
    private: true,
    type: "module",
    dependencies: {
      [packageName]: `file:${join(tarballs, tarballName)}`,
      "@types/node": "22.20.1",
    },
  });
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumerRoot);

  const installedPackage = realpathSync(join(consumerRoot, "node_modules", packageName));
  const installedDecision = join(installedPackage, "dist/internal/build-dev-decision.js");
  const child = join(installedPackage, "dist/internal/build-dev-generation-child.js");
  const decision = await import(pathToFileURL(installedDecision).href) as DecisionModule;
  const packageIdentity = decision.capturePrivateRuntimeIdentity(installedPackage, identityPaths(installedPackage));
  const installedRequire = createRequire(join(installedPackage, "package.json"));
  const typescriptRoot = realpathSync(dirname(installedRequire.resolve("typescript/package.json")));
  const typescriptIdentity = decision.capturePrivateRuntimeIdentity(typescriptRoot, identityPaths(typescriptRoot));
  const getCompilerPath = (await import(pathToFileURL(join(typescriptRoot, "lib/getExePath.js")).href) as { default(): string }).default;
  const nativeCompiler = realpathSync(getCompilerPath());
  const nativeRoot = dirname(dirname(nativeCompiler));
  const nativeIdentity = decision.capturePrivateRuntimeIdentity(nativeRoot, identityPaths(nativeRoot));
  const consumerRequire = createRequire(join(consumerRoot, "package.json"));
  const nodeTypesRoot = realpathSync(dirname(consumerRequire.resolve("@types/node/package.json")));
  const nodeTypesIdentity = decision.capturePrivateRuntimeIdentity(nodeTypesRoot, identityPaths(nodeTypesRoot));
  const nodeTypesRequire = createRequire(join(nodeTypesRoot, "package.json"));
  const undiciTypesRoot = realpathSync(dirname(nodeTypesRequire.resolve("undici-types/package.json")));
  const undiciTypesIdentity = decision.capturePrivateRuntimeIdentity(undiciTypesRoot, identityPaths(undiciTypesRoot));
  const guardRoot = join(temporaryRoot, "runtime-guard");
  mkdirSync(guardRoot);
  writeFileSync(join(guardRoot, "identity.txt"), "accepted-runtime\n");
  const guardIdentity = decision.capturePrivateRuntimeIdentity(guardRoot, ["identity.txt"]);
  const runtimeClosures = Object.freeze([
    Object.freeze({ root: installedPackage, identity: packageIdentity }),
    Object.freeze({ root: typescriptRoot, identity: typescriptIdentity }),
    Object.freeze({ root: nativeRoot, identity: nativeIdentity }),
    Object.freeze({ root: nodeTypesRoot, identity: nodeTypesIdentity }),
    Object.freeze({ root: undiciTypesRoot, identity: undiciTypesIdentity }),
    Object.freeze({ root: guardRoot, identity: guardIdentity }),
  ]);

  const projectRoot = join(consumerRoot, "project");
  mkdirSync(projectRoot);
  const supervisorGenerationValue = process.env["GENERATION_VALUE"];
  const baseProcessEnvironment = Object.freeze({
    PATH: process.env["PATH"],
    __CF_USER_TEXT_ENCODING: process.env["__CF_USER_TEXT_ENCODING"],
  });
  const compile = (generation: number, environmentValue: string): Readonly<{
    result: ChildResult;
    environment: Readonly<Record<string, string>>;
    stageRoot: string;
    status: number | null;
    stderr: string;
  }> => {
    for (const closure of runtimeClosures.slice(0, -1)) {
      decision.assertPrivateRuntimeIdentity(closure.root, closure.identity);
    }
    writeFileSync(join(projectRoot, ".env"), `GENERATION_VALUE=${environmentValue}\n`);
    const environment = decision.capturePrivateEnvironment(projectRoot, baseProcessEnvironment);
    const stageRoot = join(projectRoot, ".fadeno/build-stage", `generation-${generation}`);
    const request = Object.freeze({
      schemaVersion: 1,
      generation,
      projectRoot,
      stageRoot,
      environmentSha256: environment.sha256,
      runtimeClosures,
    });
    const childResult = spawnSync(process.execPath, [child], {
      cwd: projectRoot,
      env: environment.values,
      input: JSON.stringify(request),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const result = childResult.status === 0 ? JSON.parse(childResult.stdout.trim()) as ChildResult : Object.freeze({
      schemaVersion: 1 as const,
      generation,
      status: "diagnostics" as const,
      environmentSha256: environment.sha256,
      inputSha256: "",
      diagnostics: Object.freeze([]),
    });
    return Object.freeze({ result, environment: environment.values, stageRoot, status: childResult.status, stderr: childResult.stderr });
  };

  const runtimeGuard = Object.freeze({ root: guardRoot, identity: guardIdentity });
  projectSources(projectRoot, 1, "one", runtimeGuard);
  const first = compile(1, "environment-one");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.result.status, "emitted", JSON.stringify(first.result.diagnostics));
  assert.equal(first.result.diagnostics.length, 0);
  assert.ok(first.result.operationSha256);
  acceptStage(projectRoot, first.stageRoot);
  runtime(projectRoot, first.environment, false);
  const firstRuntime = runtime(projectRoot, first.environment);
  assert.deepEqual({ ...firstRuntime, pid: 0 }, { generation: 1, handlerValue: "one", environment: "environment-one", pid: 0 });

  projectSources(projectRoot, 2, "two", runtimeGuard);
  const second = compile(2, "environment-two");
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.result.status, "emitted");
  assert.notEqual(second.result.inputSha256, first.result.inputSha256);
  assert.notEqual(second.result.environmentSha256, first.result.environmentSha256);
  acceptStage(projectRoot, second.stageRoot);
  const secondRuntime = runtime(projectRoot, second.environment);
  assert.deepEqual({ ...secondRuntime, pid: 0 }, { generation: 2, handlerValue: "two", environment: "environment-two", pid: 0 });
  assert.notEqual(secondRuntime.pid, firstRuntime.pid);

  projectSources(projectRoot, 3, "invalid", runtimeGuard, true);
  const refused = compile(3, "environment-three");
  assert.equal(refused.status, 0, refused.stderr);
  assert.equal(refused.result.status, "diagnostics");
  assert.equal(refused.result.diagnostics.length, 1);
  assert.deepEqual({ ...refused.result.diagnostics[0], text: "normalized" }, {
    code: 2322,
    category: 1,
    file: "src/handler.ts",
    start: 13,
    end: 25,
    rangeReason: null,
    text: "normalized",
  });
  assert.deepEqual({ ...runtime(projectRoot, second.environment), pid: 0 }, {
    generation: 2, handlerValue: "two", environment: "environment-two", pid: 0,
  });

  projectSources(projectRoot, 4, "three", runtimeGuard);
  const recovered = compile(4, "environment-three");
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(recovered.result.status, "emitted");
  assert.equal(recovered.result.diagnostics.length, 0);
  acceptStage(projectRoot, recovered.stageRoot);
  const recoveredRuntime = runtime(projectRoot, recovered.environment);
  assert.deepEqual({ ...recoveredRuntime, pid: 0 }, {
    generation: 4, handlerValue: "three", environment: "environment-three", pid: 0,
  });
  assert.notEqual(recoveredRuntime.pid, secondRuntime.pid);
  assert.equal(process.env["GENERATION_VALUE"], supervisorGenerationValue);

  writeFileSync(join(guardRoot, "identity.txt"), "mutated-runtime\n");
  const staleRuntime = compile(5, "environment-five");
  assert.equal(staleRuntime.status, 3);
  assert.match(staleRuntime.stderr, /FADENO_BUILD_RUNTIME_IDENTITY/u);
  assertRuntimeIdentityRefusal(projectRoot, recovered.environment);
  writeFileSync(join(guardRoot, "identity.txt"), "accepted-runtime\n");
  assert.deepEqual({ ...runtime(projectRoot, recovered.environment), pid: 0 }, {
    generation: 4, handlerValue: "three", environment: "environment-three", pid: 0,
  });
} finally {
  rmSync(join(repositoryRoot, "packages/framework/dist"), { recursive: true, force: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 private packed build/development decision evidence passed");
