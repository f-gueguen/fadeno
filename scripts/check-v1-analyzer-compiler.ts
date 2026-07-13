import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PrivateCompilerValidationError,
  PrivateCompilerValidator,
} from "../packages/framework/src/internal/analyzer-compiler.ts";
import {
  PrivateProjectAnalyzer,
  type PrivateProjectRefreshHandle,
} from "../packages/framework/src/internal/analyzer-project.ts";

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
  writeFileSync(directPath, `${directBytes}\nconst compilerFailure: string = 1;\n`);
  const directFailure = await compilerFailure(analyzer.refresh());
  assert.equal(directFailure.code, "FADENO_ANALYZER_COMPILER_DIAGNOSTIC");
  assert.equal(directFailure.diagnosticCodes.includes(2322), true);
  assertOutput(root, firstOutput);
  assertNoCompilerOutput(root);
  writeFileSync(directPath, directBytes);
  const directRecovery = await analyzer.refresh().result;
  assert.equal(directRecovery.application.changed, false);

  const helperDirectory = join(root, "src/support");
  const helperPath = join(helperDirectory, "message.ts");
  mkdirSync(helperDirectory, { recursive: true });
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

const lifecycleRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-lifecycle-"));
const controlRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-compiler-control-"));
try {
  copyApplication(lifecycleRoot);
  const counter = join(controlRoot, "counter.txt");
  const release = join(controlRoot, "release.txt");
  const childScript = join(controlRoot, "compiler-child.mjs");
  writeFileSync(childScript, [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'const [counter, release] = process.argv.slice(2);',
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
    command: Object.freeze({ executable: process.execPath, argumentsPrefix: Object.freeze([childScript, counter, release]) }),
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
