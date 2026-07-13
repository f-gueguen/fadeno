import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  PrivateCompilerValidationError,
  PrivateCompilerValidator,
} from "../packages/framework/src/internal/analyzer-compiler.ts";
import {
  PrivateProjectAnalyzer,
  type PrivateProjectRefreshHandle,
} from "../packages/framework/src/internal/analyzer-project.ts";
import type { RouteArtifactMutationFileSystem } from "../packages/framework/src/internal/routing/generator.ts";

function copyApplication(root: string): void {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  cpSync(new URL("../examples/v1-app/fadeno.config.ts", import.meta.url), join(root, "fadeno.config.ts"));
  cpSync(new URL("../examples/v1-app/tsconfig.json", import.meta.url), join(root, "tsconfig.json"));
  cpSync(new URL("../examples/v1-app/package.json", import.meta.url), join(root, "package.json"));
  symlinkSync(resolve(new URL("../examples/v1-app/node_modules", import.meta.url).pathname), join(root, "node_modules"));
}

function outputBytes(root: string): Readonly<Record<string, Buffer>> {
  const output = join(root, ".fadeno/routes");
  return Object.freeze(Object.fromEntries(readdirSync(output).sort().map((name) => [name, readFileSync(join(output, name))])));
}

function assertOutput(root: string, expected: Readonly<Record<string, Buffer>>): void {
  const actual = outputBytes(root);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) assert.equal(actual[name]?.equals(bytes), true, name);
}

async function compilerFailure(handle: PrivateProjectRefreshHandle): Promise<PrivateCompilerValidationError> {
  try {
    await handle.result;
  } catch (error) {
    assert.equal(error instanceof PrivateCompilerValidationError, true);
    return error as PrivateCompilerValidationError;
  }
  throw new Error("FADENO_TEST_COMPILER_ACCEPTED");
}

function assertNoCompilerOutput(root: string): void {
  assert.equal(existsSync(join(root, "dist")), false);
  assert.equal(readdirSync(root).some((name) => name.endsWith(".tsbuildinfo")), false);
  const parent = join(root, ".fadeno");
  if (existsSync(parent)) {
    assert.equal(readdirSync(parent).some((name) => /routes\.(?:pending|previous|empty)-/u.test(name)), false);
  }
}

function oneTimeRollbackFailure(root: string): RouteArtifactMutationFileSystem {
  const output = join(root, ".fadeno/routes");
  let refused = false;
  return Object.freeze({
    mkdir: (path: string) => mkdirSync(path),
    writeFile: (path: string, bytes: string) => writeFileSync(path, bytes),
    rename: (from: string, to: string) => renameSync(from, to),
    remove: (path: string) => {
      if (!refused && path === output) {
        refused = true;
        throw new Error("FADENO_TEST_ROLLBACK_REMOVE_FAILURE");
      }
      rmSync(path, { recursive: true, force: true });
    },
  });
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

async function waitForCounter(path: string, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (existsSync(path) && readFileSync(path, "utf8") === String(expected)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`FADENO_TEST_COMPILER_COUNTER_${expected}`);
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-refresh-"));
try {
  copyApplication(root);
  const analyzer = new PrivateProjectAnalyzer(root);
  const first = await analyzer.refresh().result;
  assert.equal(first.application.changed, true);
  assert.equal(first.compiler.publicationOperationId, first.publication.operationId);
  assert.equal(first.compiler.artifactSourceSha256, first.application.sourceSha256);
  assert.equal(first.compiler.generation, first.generation);
  assertNoCompilerOutput(root);
  const firstOutput = outputBytes(root);

  const directPath = join(root, "src/server.ts");
  const directBytes = readFileSync(directPath, "utf8");
  writeFileSync(directPath, `${directBytes}\n// FADENO_TEST_PRIVATE_COMPILER_SENTINEL\nconst compilerFailure: string = 1;\n`);
  const directFailure = await compilerFailure(analyzer.refresh());
  assert.equal(directFailure.code, "FADENO_ANALYZER_COMPILER_DIAGNOSTIC");
  assert.equal(directFailure.diagnosticCodes.includes(2322), true);
  assert.equal(JSON.stringify(directFailure).includes("FADENO_TEST_PRIVATE_COMPILER_SENTINEL"), false);
  assertOutput(root, firstOutput);
  assertNoCompilerOutput(root);
  writeFileSync(directPath, directBytes);
  const directRecovery = await analyzer.refresh().result;
  assert.equal(directRecovery.application.changed, false);

  const helperDirectory = join(root, "src/support");
  const helperEntryPath = join(helperDirectory, "message.ts");
  const helperMiddlePath = join(helperDirectory, "message-middle.ts");
  const helperPath = join(helperDirectory, "message-value.ts");
  mkdirSync(helperDirectory, { recursive: true });
  writeFileSync(helperEntryPath, "export { message } from './message-middle.ts';\n");
  writeFileSync(helperMiddlePath, "export { message } from './message-value.ts';\n");
  writeFileSync(helperPath, "export const message: string = 'ready';\n");
  const pagePath = join(root, "src/routes/page.tsx");
  const pageBytes = readFileSync(pagePath, "utf8");
  writeFileSync(pagePath, `import { message } from '../support/message.ts';\n${pageBytes.replace(
    '<h1 id="welcome-heading">First running Fadeno application</h1>',
    '<h1 id="welcome-heading">{message}</h1>',
  )}`);
  const transitiveBaseline = await analyzer.refresh().result;
  assert.equal(transitiveBaseline.application.changed, true);
  const transitiveOutput = outputBytes(root);

  writeFileSync(helperPath, "export const message: string = 1;\n");
  const transitiveFailure = await compilerFailure(analyzer.refresh());
  assert.equal(transitiveFailure.diagnosticCodes.includes(2322), true);
  assertOutput(root, transitiveOutput);
  writeFileSync(helperPath, "export const message: string = 'recovered';\n");
  await analyzer.refresh().result;

  rmSync(helperPath);
  const deletedFailure = await compilerFailure(analyzer.refresh());
  assert.equal(deletedFailure.diagnosticCodes.includes(2307), true);
  assertOutput(root, transitiveOutput);
  writeFileSync(helperPath, "export const message: string = 'renamed-recovery';\n");
  await analyzer.refresh().result;

  const movedHelperPath = join(helperDirectory, "message-moved.ts");
  renameSync(helperPath, movedHelperPath);
  const renamedFailure = await compilerFailure(analyzer.refresh());
  assert.equal(renamedFailure.diagnosticCodes.includes(2307), true);
  assertOutput(root, transitiveOutput);
  renameSync(movedHelperPath, helperPath);
  await analyzer.refresh().result;

  const beforeRouteChangingFailure = outputBytes(root);
  writeFileSync(pagePath, `${readFileSync(pagePath, "utf8")}\n// route-owned change before compiler refusal\n`);
  writeFileSync(helperPath, "export const message: string = 1;\n");
  await compilerFailure(analyzer.refresh());
  assertOutput(root, beforeRouteChangingFailure);
  writeFileSync(helperPath, "export const message: string = 'final';\n");
  await analyzer.refresh().result;

  const beforeLateSource = outputBytes(root);
  mkdirSync(join(root, "src/routes/late-source"), { recursive: true });
  writeFileSync(join(root, "src/routes/late-source/page.tsx"), "export default function Page(): string { return 'late'; }\n");
  const lateSource = analyzer.refresh({ beforeCommit: () => {
    writeFileSync(directPath, `${directBytes}\nconst lateCompilerFailure: string = 1;\n`);
  } });
  const lateSourceFailure = await compilerFailure(lateSource);
  assert.equal(lateSourceFailure.code, "FADENO_ANALYZER_COMPILER_INPUT");
  assertOutput(root, beforeLateSource);
  writeFileSync(directPath, directBytes);
  await analyzer.refresh().result;

  const beforeArtifactDrift = outputBytes(root);
  mkdirSync(join(root, "src/routes/artifact-drift"), { recursive: true });
  writeFileSync(join(root, "src/routes/artifact-drift/page.tsx"), "export default function Page(): string { return 'artifact'; }\n");
  const artifactDrift = analyzer.refresh({ beforeCommit: () => {
    writeFileSync(join(root, ".fadeno/routes/index.d.ts"), "// corrupted provisional artifact\n");
  } });
  const artifactDriftFailure = await compilerFailure(artifactDrift);
  assert.equal(artifactDriftFailure.code, "FADENO_ANALYZER_COMPILER_INPUT");
  assertOutput(root, beforeArtifactDrift);
  assertNoCompilerOutput(root);
  await analyzer.refresh().result;

  const beforeRollbackFailure = outputBytes(root);
  mkdirSync(join(root, "src/routes/rollback-failure"), { recursive: true });
  writeFileSync(join(root, "src/routes/rollback-failure/page.tsx"), "export default function Page(): string { return 'rollback'; }\n");
  writeFileSync(helperPath, "export const message: string = 1;\n");
  await compilerFailure(analyzer.refresh({ application: { fileSystem: oneTimeRollbackFailure(root) } }));
  assertOutput(root, beforeRollbackFailure);
  assertNoCompilerOutput(root);
  writeFileSync(helperPath, "export const message: string = 'rollback-recovered';\n");
  await analyzer.refresh().result;

  const lateAdmission = deferred<PrivateProjectRefreshHandle>();
  const lateOld = analyzer.refresh({ beforeCommit: () => { lateAdmission.resolve(analyzer.refresh()); } });
  await assert.rejects(lateOld.result, /FADENO_ANALYZER_PROJECT_SUPERSEDED/u);
  const late = await lateAdmission.promise;
  await late.result;
  assertNoCompilerOutput(root);
  await analyzer.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

const firstFailureRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-first-failure-"));
try {
  copyApplication(firstFailureRoot);
  const server = join(firstFailureRoot, "src/server.ts");
  writeFileSync(server, `${readFileSync(server, "utf8")}\nconst firstFailure: string = 1;\n`);
  const analyzer = new PrivateProjectAnalyzer(firstFailureRoot);
  await compilerFailure(analyzer.refresh());
  assert.equal(existsSync(join(firstFailureRoot, ".fadeno/routes")), false);
  assertNoCompilerOutput(firstFailureRoot);
  await analyzer.close();
} finally {
  rmSync(firstFailureRoot, { recursive: true, force: true });
}

const configurationRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-configuration-"));
const externalConfigurationRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-external-configuration-"));
try {
  copyApplication(configurationRoot);
  const config = join(configurationRoot, "tsconfig.json");
  const retainedConfig = join(configurationRoot, "tsconfig.retained.json");
  const externalConfig = join(externalConfigurationRoot, "tsconfig.json");
  writeFileSync(externalConfig, readFileSync(config));
  const compiler = new PrivateCompilerValidator(configurationRoot);
  renameSync(config, retainedConfig);
  symlinkSync(externalConfig, config);
  assert.throws(() => compiler.validate({
    requestId: "configuration-request",
    generation: 1,
    publicationOperationId: "configuration-publication",
    artifactSourceSha256: "0".repeat(64),
    signal: new AbortController().signal,
  }), /FADENO_ANALYZER_COMPILER_CONFIG/u);
  rmSync(config);
  renameSync(retainedConfig, config);
  await compiler.close();
  rmSync(config);
  assert.throws(() => new PrivateCompilerValidator(configurationRoot), /FADENO_ANALYZER_COMPILER_CONFIG/u);
} finally {
  rmSync(configurationRoot, { recursive: true, force: true });
  rmSync(externalConfigurationRoot, { recursive: true, force: true });
}

const ownershipRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-ownership-"));
const outsideOwnershipRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-outside-"));
const foreignProjectRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-foreign-project-"));
try {
  copyApplication(ownershipRoot);
  copyApplication(foreignProjectRoot);
  const analyzer = new PrivateProjectAnalyzer(ownershipRoot);
  await analyzer.refresh().result;
  const baseline = outputBytes(ownershipRoot);
  const configPath = join(ownershipRoot, "tsconfig.json");
  const configBytes = readFileSync(configPath, "utf8");
  const config = JSON.parse(configBytes) as { compilerOptions: Record<string, unknown>; include: string[] };
  const outsidePath = join(outsideOwnershipRoot, "outside.ts");
  writeFileSync(join(outsideOwnershipRoot, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(outsidePath, "export const outside: string = 'outside';\n");
  config.compilerOptions["rootDir"] = resolve("/");
  config.include.push(relative(ownershipRoot, outsidePath));
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const externalInclude = await compilerFailure(analyzer.refresh());
  assert.equal(externalInclude.code, "FADENO_ANALYZER_COMPILER_INPUT");
  assertOutput(ownershipRoot, baseline);
  writeFileSync(configPath, configBytes);

  const serverPath = join(ownershipRoot, "src/server.ts");
  const serverBytes = readFileSync(serverPath, "utf8");
  const linkedInput = join(ownershipRoot, "src/external-linked.ts");
  symlinkSync(outsidePath, linkedInput);
  writeFileSync(serverPath, `import { outside } from './external-linked.ts';\nvoid outside;\n${serverBytes}`);
  const linkedFailure = await compilerFailure(analyzer.refresh());
  assert.equal(linkedFailure.code, "FADENO_ANALYZER_COMPILER_INPUT");
  assertOutput(ownershipRoot, baseline);
  writeFileSync(serverPath, serverBytes);
  rmSync(linkedInput);

  const importPath = relative(dirname(serverPath), outsidePath).replaceAll("\\", "/");
  const importSpecifier = importPath.startsWith(".") ? importPath : `./${importPath}`;
  const importConfig = JSON.parse(configBytes) as { compilerOptions: Record<string, unknown>; include: string[] };
  importConfig.compilerOptions["rootDir"] = resolve("/");
  writeFileSync(configPath, `${JSON.stringify(importConfig, null, 2)}\n`);
  writeFileSync(serverPath, `import { outside } from ${JSON.stringify(importSpecifier)};\nvoid outside;\n${serverBytes}`);
  const externalImport = await compilerFailure(analyzer.refresh());
  assert.equal(externalImport.code, "FADENO_ANALYZER_COMPILER_INPUT");
  assertOutput(ownershipRoot, baseline);
  writeFileSync(serverPath, serverBytes);
  writeFileSync(configPath, configBytes);
  await analyzer.refresh().result;
  await analyzer.close();

  const foreignCompiler = new PrivateCompilerValidator(foreignProjectRoot);
  assert.throws(
    () => new PrivateProjectAnalyzer(ownershipRoot, { compiler: foreignCompiler }),
    /FADENO_ANALYZER_COMPILER_CONFIG/u,
  );
  await foreignCompiler.close();
} finally {
  rmSync(ownershipRoot, { recursive: true, force: true });
  rmSync(outsideOwnershipRoot, { recursive: true, force: true });
  rmSync(foreignProjectRoot, { recursive: true, force: true });
}

const observerRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-observer-"));
try {
  copyApplication(observerRoot);
  const child = join(observerRoot, "compiler-observer-child.mjs");
  writeFileSync(child, `console.log(${JSON.stringify(join(observerRoot, "src/server.ts"))});\nprocess.exit(0);\n`);
  const observerCancellation = new AbortController();
  const request = Object.freeze({
    requestId: "observer-request",
    generation: 1,
    publicationOperationId: "observer-publication",
    artifactSourceSha256: "0".repeat(64),
    signal: observerCancellation.signal,
  });
  let spawnObserved = false;
  let closeObserved = false;
  let compiler!: PrivateCompilerValidator;
  compiler = new PrivateCompilerValidator(observerRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([child]) }),
    onSpawn: () => {
      spawnObserved = true;
      assert.throws(() => compiler.validate(request), /FADENO_ANALYZER_COMPILER_STATE/u);
      observerCancellation.abort();
      throw new Error("FADENO_TEST_SPAWN_OBSERVER_FAILURE");
    },
    onClose: () => {
      closeObserved = true;
      throw new Error("FADENO_TEST_CLOSE_OBSERVER_FAILURE");
    },
  });
  await assert.rejects(compiler.validate(request), /AbortError/u);
  assert.equal(spawnObserved, true);
  assert.equal(closeObserved, true);
  const observerClose = compiler.close();
  assert.equal(compiler.close(), observerClose);
  await observerClose;

  let spawnedDuringCancelledInventory = false;
  const cancellation = new AbortController();
  const cancelledCompiler = new PrivateCompilerValidator(observerRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([child]) }),
    onSpawn: () => { spawnedDuringCancelledInventory = true; },
  });
  const cancelled = cancelledCompiler.validate({ ...request, signal: cancellation.signal });
  cancellation.abort();
  await assert.rejects(cancelled, /AbortError/u);
  assert.equal(spawnedDuringCancelledInventory, false);
  await cancelledCompiler.close();
} finally {
  rmSync(observerRoot, { recursive: true, force: true });
}

const processFailureRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-process-failure-"));
try {
  copyApplication(processFailureRoot);
  const baselineAnalyzer = new PrivateProjectAnalyzer(processFailureRoot);
  await baselineAnalyzer.refresh().result;
  await baselineAnalyzer.close();
  const baseline = outputBytes(processFailureRoot);
  const failingChild = join(processFailureRoot, "compiler-process-failure.mjs");
  writeFileSync(failingChild, "process.exit(7);\n");
  const compiler = new PrivateCompilerValidator(processFailureRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([failingChild]) }),
  });
  mkdirSync(join(processFailureRoot, "src/routes/process-failure"), { recursive: true });
  writeFileSync(
    join(processFailureRoot, "src/routes/process-failure/page.tsx"),
    "export default function Page(): string { return 'process-failure'; }\n",
  );
  const analyzer = new PrivateProjectAnalyzer(processFailureRoot, { compiler });
  const failure = await compilerFailure(analyzer.refresh());
  assert.equal(failure.code, "FADENO_ANALYZER_COMPILER_PROCESS");
  assertOutput(processFailureRoot, baseline);
  assertNoCompilerOutput(processFailureRoot);
  await analyzer.close();
} finally {
  rmSync(processFailureRoot, { recursive: true, force: true });
}

const negativeChildRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-negative-child-"));
const negativeChildControlRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-negative-control-"));
try {
  copyApplication(negativeChildRoot);
  const baselineAnalyzer = new PrivateProjectAnalyzer(negativeChildRoot);
  await baselineAnalyzer.refresh().result;
  await baselineAnalyzer.close();
  const baseline = outputBytes(negativeChildRoot);
  const ownedInput = join(negativeChildRoot, "src/server.ts");

  mkdirSync(join(negativeChildRoot, "src/routes/output-mutation"), { recursive: true });
  writeFileSync(join(negativeChildRoot, "src/routes/output-mutation/page.tsx"), "export default function Page(): string { return 'output'; }\n");
  const outputChild = join(negativeChildRoot, "compiler-output-child.mjs");
  writeFileSync(outputChild, [
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("compiler-output.txt", "unexpected\\n");',
    `console.log(${JSON.stringify(ownedInput)});`,
    "",
  ].join("\n"));
  const outputCompiler = new PrivateCompilerValidator(negativeChildRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([outputChild]) }),
  });
  const outputAnalyzer = new PrivateProjectAnalyzer(negativeChildRoot, { compiler: outputCompiler });
  const outputFailure = await compilerFailure(outputAnalyzer.refresh());
  assert.equal(outputFailure.code, "FADENO_ANALYZER_COMPILER_OUTPUT");
  assertOutput(negativeChildRoot, baseline);
  assert.equal(existsSync(join(negativeChildRoot, "compiler-output.txt")), true);
  rmSync(join(negativeChildRoot, "compiler-output.txt"));
  await outputAnalyzer.close();

  mkdirSync(join(negativeChildRoot, "src/routes/output-limit"), { recursive: true });
  writeFileSync(join(negativeChildRoot, "src/routes/output-limit/page.tsx"), "export default function Page(): string { return 'limit'; }\n");
  const limitChild = join(negativeChildRoot, "compiler-output-limit-child.mjs");
  writeFileSync(limitChild, 'process.stdout.write("x".repeat(4_300_000));\nsetInterval(() => undefined, 1_000);\n');
  const limitCompiler = new PrivateCompilerValidator(negativeChildRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([limitChild]) }),
  });
  const limitAnalyzer = new PrivateProjectAnalyzer(negativeChildRoot, { compiler: limitCompiler });
  const limitFailure = await compilerFailure(limitAnalyzer.refresh());
  assert.equal(limitFailure.code, "FADENO_ANALYZER_COMPILER_OUTPUT_LIMIT");
  assertOutput(negativeChildRoot, baseline);
  await limitAnalyzer.close();

  mkdirSync(join(negativeChildRoot, "src/routes/spawn-failure"), { recursive: true });
  writeFileSync(join(negativeChildRoot, "src/routes/spawn-failure/page.tsx"), "export default function Page(): string { return 'spawn'; }\n");
  const spawnCompiler = new PrivateCompilerValidator(negativeChildRoot, {
    command: Object.freeze({ executable: join(negativeChildRoot, "missing-compiler"), argumentsPrefix: Object.freeze([]) }),
  });
  const spawnAnalyzer = new PrivateProjectAnalyzer(negativeChildRoot, { compiler: spawnCompiler });
  const spawnFailure = await compilerFailure(spawnAnalyzer.refresh());
  assert.equal(spawnFailure.code, "FADENO_ANALYZER_COMPILER_PROCESS");
  assertOutput(negativeChildRoot, baseline);
  await spawnAnalyzer.close();

  mkdirSync(join(negativeChildRoot, "src/routes/forced-termination"), { recursive: true });
  writeFileSync(join(negativeChildRoot, "src/routes/forced-termination/page.tsx"), "export default function Page(): string { return 'forced'; }\n");
  const forcedChild = join(negativeChildRoot, "compiler-forced-termination-child.mjs");
  const forcedReady = join(negativeChildControlRoot, "compiler-forced-termination-ready.txt");
  writeFileSync(forcedChild, [
    'import { writeFileSync } from "node:fs";',
    'process.on("SIGTERM", () => undefined);',
    'writeFileSync(process.argv[2], "1");',
    `console.log(${JSON.stringify(ownedInput)});`,
    'setInterval(() => undefined, 1_000);',
    "",
  ].join("\n"));
  const forcedSpawn = deferred<number>();
  let forcedSignal: NodeJS.Signals | null = null;
  const forcedCompiler = new PrivateCompilerValidator(negativeChildRoot, {
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([forcedChild, forcedReady]) }),
    onSpawn: (pid) => forcedSpawn.resolve(pid),
    onClose: (_pid, _code, signal) => { forcedSignal = signal; },
  });
  const forcedAnalyzer = new PrivateProjectAnalyzer(negativeChildRoot, { compiler: forcedCompiler });
  const forced = forcedAnalyzer.refresh();
  await forcedSpawn.promise;
  await waitForCounter(forcedReady, 1);
  forced.cancel();
  await assert.rejects(forced.result, /FADENO_ANALYZER_PROJECT_CANCELLED/u);
  assert.equal(forcedSignal, "SIGKILL");
  assertOutput(negativeChildRoot, baseline);
  await forcedAnalyzer.close();
  rmSync(forcedReady);
  assertNoCompilerOutput(negativeChildRoot);

  const recovery = new PrivateProjectAnalyzer(negativeChildRoot);
  await recovery.refresh().result;
  await recovery.close();
} finally {
  rmSync(negativeChildRoot, { recursive: true, force: true });
  rmSync(negativeChildControlRoot, { recursive: true, force: true });
}

const lifecycleRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-lifecycle-"));
const controlRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-control-"));
try {
  copyApplication(lifecycleRoot);
  const counter = join(controlRoot, "counter.txt");
  const release = join(controlRoot, "release.txt");
  const childScript = join(controlRoot, "compiler-child.mjs");
  writeFileSync(childScript, [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'const [counter, release, ownedInput] = process.argv.slice(2);',
    'console.log(ownedInput);',
    'const run = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;',
    'writeFileSync(counter, String(run));',
    'if (run % 2 === 0) process.exit(0);',
    'if (run === 5) { const timer = setInterval(() => { if (existsSync(release)) { clearInterval(timer); process.exit(0); } }, 5); }',
    'else setInterval(() => undefined, 1_000);',
    "",
  ].join("\n"));
  const spawned: number[] = [];
  const closed: number[] = [];
  let nextSpawn = deferred<number>();
  const compiler = new PrivateCompilerValidator(lifecycleRoot, {
    command: Object.freeze({
      executable: process.execPath,
      argumentsPrefix: Object.freeze([childScript, counter, release, join(lifecycleRoot, "src/server.ts")]),
    }),
    onSpawn: (pid) => {
      if (spawned.length > 0) assert.equal(closed.includes(spawned.at(-1)!), true, "new compiler started before old close");
      spawned.push(pid);
      nextSpawn.resolve(pid);
    },
    onClose: (pid) => { closed.push(pid); },
  });
  const analyzer = new PrivateProjectAnalyzer(lifecycleRoot, { compiler });
  const baselineAnalyzer = new PrivateProjectAnalyzer(lifecycleRoot);
  await baselineAnalyzer.refresh().result;
  await baselineAnalyzer.close();
  const initialOutput = outputBytes(lifecycleRoot);

  mkdirSync(join(lifecycleRoot, "src/routes/superseded"), { recursive: true });
  writeFileSync(join(lifecycleRoot, "src/routes/superseded/page.tsx"), "export default function Page(): string { return 'superseded'; }\n");
  const obsolete = analyzer.refresh();
  await nextSpawn.promise;
  await waitForCounter(counter, 1);
  nextSpawn = deferred<number>();
  const newest = analyzer.refresh();
  await assert.rejects(obsolete.result, /FADENO_ANALYZER_PROJECT_SUPERSEDED/u);
  await nextSpawn.promise;
  await newest.result;
  assert.equal(closed.length >= 2, true);
  assertNoCompilerOutput(lifecycleRoot);

  mkdirSync(join(lifecycleRoot, "src/routes/cancelled"), { recursive: true });
  writeFileSync(join(lifecycleRoot, "src/routes/cancelled/page.tsx"), "export default function Page(): string { return 'cancelled'; }\n");
  const beforeCancellation = outputBytes(lifecycleRoot);
  nextSpawn = deferred<number>();
  const cancelled = analyzer.refresh();
  await nextSpawn.promise;
  await waitForCounter(counter, 3);
  cancelled.cancel();
  await assert.rejects(cancelled.result, /FADENO_ANALYZER_PROJECT_CANCELLED/u);
  assertOutput(lifecycleRoot, beforeCancellation);
  assert.notDeepEqual(beforeCancellation, initialOutput);
  nextSpawn = deferred<number>();
  await analyzer.refresh().result;
  await nextSpawn.promise;

  mkdirSync(join(lifecycleRoot, "src/routes/closing"), { recursive: true });
  writeFileSync(join(lifecycleRoot, "src/routes/closing/page.tsx"), "export default function Page(): string { return 'closing'; }\n");
  nextSpawn = deferred<number>();
  const closingRefresh = analyzer.refresh();
  await nextSpawn.promise;
  await waitForCounter(counter, 5);
  let closeSettled = false;
  const closing = analyzer.close().then(() => { closeSettled = true; });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  writeFileSync(release, "release\n");
  await assert.rejects(closingRefresh.result, /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await closing;
  assert.equal(spawned.length, closed.length);
  assertNoCompilerOutput(lifecycleRoot);
} finally {
  rmSync(lifecycleRoot, { recursive: true, force: true });
  rmSync(controlRoot, { recursive: true, force: true });
}

console.log("V1 retained compiler validation passed (stock graph, rollback, cancellation, supersession, close)");
