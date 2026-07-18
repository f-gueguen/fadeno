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
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PrivateAnalyzerOperationHandle } from "../packages/framework/src/internal/analyzer-coordinator.ts";
import type { PrivateProjectRefresh } from "../packages/framework/src/internal/analyzer-project.ts";
import type {
  PrivateFilesystemRefreshCycle,
  PrivateFilesystemRefreshTarget,
} from "../packages/framework/src/internal/analyzer-watcher.ts";

type AnalyzerProjectModule = typeof import("../packages/framework/src/internal/analyzer-project.ts");
type AnalyzerCompilerModule = typeof import("../packages/framework/src/internal/analyzer-compiler.ts");
type AnalyzerWatcherModule = typeof import("../packages/framework/src/internal/analyzer-watcher.ts");
type OutputBytes = Readonly<Record<string, string>>;

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const fixtureRoot = join(root, "fixtures/v1-analyzer");
const packageName = "@fadeno/framework";
const generatedNames = Object.freeze([
  "app.ts",
  "index.d.ts",
  "index.js",
  "loader.ts",
  "manifest.json",
  "owner.json",
  "virtual.ts",
]);

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolvePromise = accept; rejectPromise = refuse; });
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_PACKED_INTERRUPTION_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function treeIdentity(directory: string): readonly Readonly<{ path: string; sha256: string }>[] {
  const files: { path: string; sha256: string }[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(directory, path).split("\\").join("/"),
        sha256: sha256(readFileSync(path)),
      });
      else throw new TypeError("FADENO_PACKED_INTERRUPTION_IDENTITY_ENTRY");
    }
  };
  visit(directory);
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

function readOutput(application: string): OutputBytes {
  const output = join(application, ".fadeno/routes");
  const names = readdirSync(output).sort();
  assert.deepEqual(names, generatedNames);
  return Object.freeze(Object.fromEntries(names.map((name) => [name, readFileSync(join(output, name), "utf8")])));
}

function routeIds(output: OutputBytes): readonly string[] {
  const manifest = JSON.parse(output["manifest.json"]!) as { routes: readonly { id: string }[] };
  return Object.freeze(manifest.routes.map(({ id }) => id).sort());
}

function assertApplied(cycle: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>, output: OutputBytes): void {
  assert.equal(cycle.refresh.diagnostics.diagnostics.length, 0);
  assert.equal(cycle.refresh.publication.operationId, cycle.refresh.diagnostics.identity.operationId);
  assert.equal(cycle.refresh.publication.artifacts.length, generatedNames.length);
  for (const artifact of cycle.refresh.publication.artifacts) {
    const name = artifact.path.replace(/^\.fadeno\/routes\//u, "");
    assert.ok(generatedNames.includes(name));
    const value = artifact.value as Readonly<{ bytes: string; encoding: string; sha256: string }>;
    assert.equal(value.encoding, "utf8");
    assert.equal(value.sha256, sha256(value.bytes));
    assert.equal(output[name], value.bytes, name);
  }
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

async function captureError(promise: Promise<unknown>, code: string): Promise<Readonly<{ code: string; requestId: string | null }>> {
  let captured: unknown = null;
  await assert.rejects(promise, (error: unknown) => {
    captured = error;
    return error instanceof Error && error.message === code;
  });
  const record = captured as { code?: unknown; requestId?: unknown };
  return Object.freeze({
    code,
    requestId: typeof record.requestId === "string" ? record.requestId : null,
  });
}

function assertFixture(name: string, actual: unknown): void {
  const expected = JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as unknown;
  assert.deepEqual(actual, expected, name);
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-v1-packed-interruption-"));
let projections: Readonly<Record<string, unknown>> | null = null;
try {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  run("pnpm", ["--filter", packageName, "build"], root);

  const tarballs = join(temporary, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new TypeError("FADENO_PACKED_INTERRUPTION_TARBALL");
  const tarball = join(tarballs, tarballName);
  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", tarball, "-C", extracted], temporary);
  const expectedPackageIdentity = treeIdentity(join(extracted, "package"));

  const application = join(temporary, "application");
  mkdirSync(application);
  cpSync(join(root, "examples/v1-app/src"), join(application, "src"), { recursive: true });
  cpSync(join(root, "examples/v1-app/fadeno.config.ts"), join(application, "fadeno.config.ts"));
  cpSync(join(root, "examples/v1-app/tsconfig.json"), join(application, "tsconfig.json"));
  const applicationPackage = JSON.parse(readFileSync(join(root, "examples/v1-app/package.json"), "utf8")) as {
    name: string;
    dependencies: Record<string, string>;
  };
  applicationPackage.name = "fadeno-packed-interruption-consumer";
  applicationPackage.dependencies[packageName] = `file:${tarball}`;
  writeFileSync(join(application, "package.json"), `${JSON.stringify(applicationPackage, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], application);

  const installedPackage = join(application, "node_modules", packageName);
  assert.deepEqual(treeIdentity(installedPackage), expectedPackageIdentity);
  const analyzerPath = join(installedPackage, "dist/internal/analyzer-project.js");
  const compilerPath = join(installedPackage, "dist/internal/analyzer-compiler.js");
  const watcherPath = join(installedPackage, "dist/internal/analyzer-watcher.js");
  const analyzerBytes = readFileSync(analyzerPath);
  writeFileSync(analyzerPath, `${analyzerBytes.toString("utf8")}\n// stale interruption canary\n`);
  assert.notDeepEqual(treeIdentity(installedPackage), expectedPackageIdentity);
  writeFileSync(analyzerPath, analyzerBytes);
  assert.deepEqual(treeIdentity(installedPackage), expectedPackageIdentity);

  const control = join(temporary, "control");
  mkdirSync(control);
  const modePath = join(control, "mode.txt");
  const barrierChild = join(control, "compiler-barrier-child.ts");
  writeFileSync(barrierChild, [
    'import { existsSync, readFileSync, watch, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const [control, ownedInput] = process.argv.slice(2);',
    'if (!control || !ownedInput) throw new TypeError("FADENO_C4_CHILD_INPUT");',
    'const mode = readFileSync(join(control, "mode.txt"), "utf8").trim();',
    'if (mode === "pass") { console.log(ownedInput); process.exit(0); }',
    'const ready = join(control, `${process.pid}.ready`);',
    'const release = join(control, `${process.pid}.release`);',
    'const finish = (): void => {',
    '  if (!existsSync(release)) return;',
    '  console.log(ownedInput);',
    '  process.exit(0);',
    '};',
    'if (mode === "block-uncooperative") process.on("SIGTERM", () => undefined);',
    'else if (mode !== "block-cooperative") throw new TypeError("FADENO_C4_CHILD_MODE");',
    'writeFileSync(ready, mode);',
    'if (mode === "block-uncooperative") { watch(control, finish); finish(); }',
    'setInterval(() => undefined, 1_000);',
    '',
  ].join("\n"));

  const analyzerModule = await import(pathToFileURL(analyzerPath).href) as AnalyzerProjectModule;
  const compilerModule = await import(pathToFileURL(compilerPath).href) as AnalyzerCompilerModule;
  const watcherModule = await import(pathToFileURL(watcherPath).href) as AnalyzerWatcherModule;
  const spawned: number[] = [];
  const closed: Readonly<{ pid: number; code: number | null; signal: NodeJS.Signals | null }>[] = [];
  let awaitedSpawn: ReturnType<typeof deferred<number>> | null = null;
  const compiler = new compilerModule.PrivateCompilerValidator(application, {
    command: Object.freeze({
      executable: process.execPath,
      argumentsPrefix: Object.freeze([
        "--no-warnings",
        "--experimental-strip-types",
        barrierChild,
        control,
        join(application, "src/projects.ts"),
      ]),
    }),
    onSpawn: (pid) => {
      spawned.push(pid);
      awaitedSpawn?.resolve(pid);
      awaitedSpawn = null;
    },
    onClose: (pid, code, signal) => { closed.push(Object.freeze({ pid, code, signal })); },
  });
  const analyzer = new analyzerModule.PrivateProjectAnalyzer(application, { compiler });

  const nextBlockedSpawn = (): Promise<number> => {
    assert.equal(awaitedSpawn, null);
    awaitedSpawn = deferred<number>();
    return awaitedSpawn.promise;
  };
  const handlesA: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>[] = [];
  const handlesB: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>[] = [];
  const handlesC: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>[] = [];
  const target = (
    handles: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>[],
  ): PrivateFilesystemRefreshTarget<PrivateProjectRefresh> => Object.freeze({
    ownsProject: (projectRoot: string) => analyzer.ownsProject(projectRoot),
    refresh: () => {
      const handle = analyzer.refresh();
      handles.push(handle);
      return handle;
    },
    close: () => analyzer.close(),
  });
  const cyclesA: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>[] = [];
  const cyclesB: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>[] = [];
  const cyclesC: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>[] = [];
  const failuresA: unknown[] = [];
  const failuresB: unknown[] = [];
  const failuresC: unknown[] = [];
  const adapter = (
    handles: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>[],
    cycles: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>[],
    failures: unknown[],
  ) => new watcherModule.PrivateFilesystemInvalidationAdapter(application, target(handles), {
    debounceMs: 0,
    maximumDelayMs: 1,
    onCycle: (cycle) => { cycles.push(cycle); },
    onFailure: (_batch, error) => { failures.push(error); },
  });
  const adapterA = adapter(handlesA, cyclesA, failuresA);
  const adapterB = adapter(handlesB, cyclesB, failuresB);
  const adapterC = adapter(handlesC, cyclesC, failuresC);

  writeFileSync(modePath, "pass\n");
  const baseline = await adapterA.flush();
  const baselineOutput = readOutput(application);
  assertApplied(baseline, baselineOutput);

  const cancelledRoute = join(application, "src/routes/c4-cancelled/page.tsx");
  mkdirSync(dirname(cancelledRoute), { recursive: true });
  writeFileSync(cancelledRoute, "export default function Page(): string { return 'cancelled'; }\n");
  writeFileSync(modePath, "block-cooperative\n");
  const cancelledSpawn = nextBlockedSpawn();
  adapterA.notify({ kind: "change", path: cancelledRoute });
  const cancelledFlush = adapterA.flush();
  const cancelledHandle = handlesA.at(-1)!;
  const cancelledFlushError = captureError(cancelledFlush, "FADENO_ANALYZER_PROJECT_CANCELLED");
  const cancelledHandleError = captureError(cancelledHandle.result, "FADENO_ANALYZER_PROJECT_CANCELLED");
  const cancelledPid = await cancelledSpawn;
  await waitForPath(join(control, `${cancelledPid}.ready`));
  cancelledHandle.cancel();
  const [cancelledDelivery, cancelledOperation] = await Promise.all([cancelledFlushError, cancelledHandleError]);
  assert.notEqual(cancelledDelivery.requestId, null);
  assert.notEqual(cancelledOperation.requestId, null);
  assert.deepEqual(readOutput(application), baselineOutput);
  assert.deepEqual(failuresA, []);

  writeFileSync(modePath, "pass\n");
  adapterA.notify({ kind: "change", path: cancelledRoute });
  const recovery = await adapterA.flush();
  const recoveryOutput = readOutput(application);
  assertApplied(recovery, recoveryOutput);
  assert.equal(routeIds(recoveryOutput).includes("/c4-cancelled"), true);

  const obsoleteRoute = join(application, "src/routes/c4-obsolete/page.tsx");
  mkdirSync(dirname(obsoleteRoute), { recursive: true });
  writeFileSync(obsoleteRoute, "export default function Page(): string { return 'obsolete'; }\n");
  writeFileSync(modePath, "block-uncooperative\n");
  const obsoleteSpawn = nextBlockedSpawn();
  adapterA.notify({ kind: "change", path: obsoleteRoute });
  const obsoleteFlush = adapterA.flush();
  const obsoleteHandle = handlesA.at(-1)!;
  const obsoleteFlushError = captureError(obsoleteFlush, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const obsoleteHandleError = captureError(obsoleteHandle.result, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const obsoletePid = await obsoleteSpawn;
  await waitForPath(join(control, `${obsoletePid}.ready`));

  rmSync(dirname(obsoleteRoute), { recursive: true });
  const newestRoute = join(application, "src/routes/c4-current/page.tsx");
  mkdirSync(dirname(newestRoute), { recursive: true });
  writeFileSync(newestRoute, "export default function Page(): string { return 'current'; }\n");
  writeFileSync(modePath, "pass\n");
  adapterB.notify({ kind: "rename", path: newestRoute });
  const newestFlush = adapterB.flush();
  assert.equal(analyzer.ownership().coordinator.activeOperations, 1);
  assert.equal(compiler.ownership().activeValidations, 1);
  writeFileSync(join(control, `${obsoletePid}.release`), "release\n");
  const [obsoleteDelivery, obsoleteOperation, newest] = await Promise.all([
    obsoleteFlushError,
    obsoleteHandleError,
    newestFlush,
  ]);
  assert.notEqual(obsoleteDelivery.requestId, null);
  assert.notEqual(obsoleteOperation.requestId, null);
  const newestOutput = readOutput(application);
  assertApplied(newest, newestOutput);
  assert.equal(routeIds(newestOutput).includes("/c4-obsolete"), false);
  assert.equal(routeIds(newestOutput).includes("/c4-current"), true);
  assert.deepEqual(failuresA, []);
  assert.deepEqual(failuresB, []);
  assert.equal(cyclesB.length, 1);

  const closingRoute = join(application, "src/routes/c4-closing/page.tsx");
  mkdirSync(dirname(closingRoute), { recursive: true });
  writeFileSync(closingRoute, "export default function Page(): string { return 'closing'; }\n");
  writeFileSync(modePath, "block-uncooperative\n");
  const closingSpawn = nextBlockedSpawn();
  adapterC.notify({ kind: "change", path: closingRoute });
  const closingFlush = adapterC.flush();
  const closingHandle = handlesC.at(-1)!;
  const closingFlushError = captureError(closingFlush, "FADENO_ANALYZER_WATCH_CLOSED");
  const closingHandleError = captureError(closingHandle.result, "FADENO_ANALYZER_PROJECT_CANCELLED");
  const closingPid = await closingSpawn;
  await waitForPath(join(control, `${closingPid}.ready`));
  let closeSettled = false;
  const closing = adapterC.close().then(() => { closeSettled = true; });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  assert.equal(adapterC.ownership().activeOperations, 1);
  assert.equal(adapterC.ownership().observers, 0);
  writeFileSync(join(control, `${closingPid}.release`), "release\n");
  const [closeRefusal, closeOperation] = await Promise.all([closingFlushError, closingHandleError]);
  await closing;
  await adapterA.close();
  await adapterB.close();
  assert.throws(
    () => adapterC.notify({ kind: "change", path: closingRoute }),
    /FADENO_ANALYZER_WATCH_CLOSED/u,
  );
  await assert.rejects(adapterC.flush(), /FADENO_ANALYZER_WATCH_CLOSED/u);
  assert.deepEqual(readOutput(application), newestOutput);
  assert.deepEqual(failuresC, []);
  assert.deepEqual(cyclesC, []);

  const zeroAdapter = {
    state: "closed",
    pendingHints: 0,
    pendingAliases: 0,
    pendingReasons: 0,
    pendingBytes: 0,
    pendingNotifications: 0,
    waiters: 0,
    timers: 0,
    activeOperations: 0,
    retainedCycles: 0,
    observers: 0,
  } as const;
  assert.deepEqual(adapterA.ownership(), zeroAdapter);
  assert.deepEqual(adapterB.ownership(), zeroAdapter);
  assert.deepEqual(adapterC.ownership(), zeroAdapter);
  const analyzerOwnership = analyzer.ownership();
  assert.deepEqual(analyzerOwnership, {
    coordinator: {
      state: "closed",
      queuedOperations: 0,
      activeOperations: 0,
      pendingAnalysisOperations: 0,
      drainWorkers: 0,
    },
    currentAnalysisTokens: 0,
    latestAnalysisRequests: 0,
    pendingApplicationRecoveries: 0,
    pendingRollbacks: 0,
    pendingCleanups: 0,
    compiler: { state: "closed", activeValidations: 0 },
  });
  assert.equal(spawned.length, closed.length);
  assert.deepEqual([...spawned].sort((left, right) => left - right), closed.map(({ pid }) => pid).sort((left, right) => left - right));
  assert.deepEqual(readdirSync(join(application, ".fadeno")).sort(), ["routes"]);

  projections = Object.freeze({
    interruption: {
      explicitCancellation: {
        barrier: "compiler-child-ready",
        deliveryCode: cancelledDelivery.code,
        operationCode: cancelledOperation.code,
        requestIdentityMatches: cancelledDelivery.requestId === cancelledOperation.requestId,
        consumerCyclePublished: false,
        failureCallbackPublished: false,
        lastGoodArtifactsPreserved: true,
      },
      supersession: {
        barrier: "compiler-child-ready",
        obsoleteDeliveryCode: obsoleteDelivery.code,
        obsoleteOperationCode: obsoleteOperation.code,
        requestIdentityMatches: obsoleteDelivery.requestId === obsoleteOperation.requestId,
        obsoleteConsumerCyclePublished: false,
        obsoleteFailureCallbackPublished: false,
        newestConsumerCyclesPublished: 1,
        provisionalObsoleteGenerationNotDelivered: true,
        obsoleteRouteAbsent: true,
        newestRoutePresent: true,
      },
      close: {
        barrier: "compiler-child-ready",
        flushRefusalCode: closeRefusal.code,
        operationCode: closeOperation.code,
        closeWaitedForActiveOwnership: true,
        consumerCyclePublished: false,
        failureCallbackPublished: false,
        lastGoodArtifactsPreserved: true,
      },
    },
    refusal: {
      afterCloseNotify: "FADENO_ANALYZER_WATCH_CLOSED",
      afterCloseFlush: "FADENO_ANALYZER_WATCH_CLOSED",
      ordinaryFailureCallbackUsed: false,
      publicCorrectionAvailable: false,
    },
    flow: [
      { step: "baseline", outcome: "accepted-current-generation" },
      { step: "explicit-cancellation", cause: "consumer-cancel", outcome: "no-delivery-last-good-preserved" },
      { step: "recovery", cause: "fresh-rescan", outcome: "accepted-cancelled-route" },
      { step: "supersession", cause: "newer-adapter-refresh", outcome: "obsolete-suppressed-newest-accepted" },
      { step: "close-during-work", cause: "consumer-close", outcome: "no-delivery-ownership-drained" },
    ],
    recovery: {
      cancelledRouteAcceptedAfterRecovery: true,
      obsoleteRouteAbsent: true,
      newestRoutePresent: true,
      exactNewestPublicationBytesApplied: true,
      staleArtifactsAbsent: true,
      staleDiagnosticsAbsent: true,
      transactionDebrisAbsent: true,
    },
    cleanup: {
      adapters: [adapterA.ownership(), adapterB.ownership(), adapterC.ownership()],
      analyzer: analyzerOwnership,
      compilerChildrenSpawned: spawned.length,
      compilerChildrenClosed: closed.length,
      childLifecycleBalanced: true,
      generatedTransactionDebris: 0,
      retainedAcceptedRouteDirectory: true,
      disposableConsumerRootRemoved: true,
    },
  });
} finally {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}

assert.ok(projections);
assert.equal(existsSync(temporary), false);
assertFixture("interruption.normalized.json", projections["interruption"]);
assertFixture("interruption-refusal.normalized.json", projections["refusal"]);
assertFixture("interruption-flow.normalized.json", projections["flow"]);
assertFixture("interruption-recovery.normalized.json", projections["recovery"]);
assertFixture("interruption-cleanup.normalized.json", projections["cleanup"]);
console.log("V1 packed analyzer interruption passed (cancellation, supersession, newest-only delivery, close, cleanup)");
