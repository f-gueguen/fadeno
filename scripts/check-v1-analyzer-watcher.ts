import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PrivateAnalyzerOperationInterrupted,
  type PrivateAnalyzerOperationHandle,
} from "../packages/framework/src/internal/analyzer-coordinator.ts";
import { PrivateProjectAnalyzer, type PrivateProjectRefresh } from "../packages/framework/src/internal/analyzer-project.ts";
import {
  PrivateFilesystemInvalidationAdapter,
  type PrivateFilesystemInvalidationScheduler,
  type PrivateFilesystemRefreshCycle,
  type PrivateFilesystemRefreshTarget,
} from "../packages/framework/src/internal/analyzer-watcher.ts";

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return Object.freeze({ promise, resolve, reject });
}

class ManualScheduler implements PrivateFilesystemInvalidationScheduler {
  #now = 0;
  #sequence = 0;
  readonly #timers = new Map<number, Readonly<{ at: number; callback(): void }>>();

  now(): number { return this.#now; }

  setNow(milliseconds: number): void { this.#now = milliseconds; }

  set(delayMs: number, callback: () => void): unknown {
    const id = ++this.#sequence;
    this.#timers.set(id, Object.freeze({ at: this.#now + delayMs, callback }));
    return id;
  }

  clear(timer: unknown): void {
    this.#timers.delete(timer as number);
  }

  advance(milliseconds: number): void {
    const target = this.#now + milliseconds;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
      if (!due) break;
      this.#now = due[1].at;
      this.#timers.delete(due[0]);
      due[1].callback();
    }
    this.#now = target;
  }
}

type PendingRefresh = Readonly<{
  handle: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>;
  resolve(): void;
  reject(error: unknown): void;
}>;

class ManualRefreshTarget implements PrivateFilesystemRefreshTarget {
  readonly #root: string;
  #sequence = 0;
  #closed = false;
  readonly pending: PendingRefresh[] = [];
  closeCount = 0;

  constructor(root: string) { this.#root = resolve(root); }

  ownsProject(projectRoot: string): boolean { return resolve(projectRoot) === this.#root; }

  refresh(): PrivateAnalyzerOperationHandle<PrivateProjectRefresh> {
    if (this.#closed) throw new TypeError("FADENO_TEST_TARGET_CLOSED");
    const sequence = ++this.#sequence;
    const operation = deferred<PrivateProjectRefresh>();
    let settled = false;
    const handle = Object.freeze({
      requestId: `manual:request-${sequence}`,
      sequence,
      kind: "analysis" as const,
      result: operation.promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        operation.reject(new TypeError("FADENO_TEST_TARGET_CANCELLED"));
      },
    });
    this.pending.push(Object.freeze({
      handle,
      resolve: () => {
        if (settled) return;
        settled = true;
        operation.resolve(Object.freeze({ requestId: handle.requestId, generation: sequence }) as PrivateProjectRefresh);
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        operation.reject(error);
      },
    }));
    return handle;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.closeCount += 1;
  }
}

class InterruptibleRefreshTarget implements PrivateFilesystemRefreshTarget {
  readonly #root: string;
  #sequence = 0;
  readonly pending: PendingRefresh[] = [];

  constructor(root: string) { this.#root = resolve(root); }

  ownsProject(projectRoot: string): boolean { return resolve(projectRoot) === this.#root; }

  refresh(): PrivateAnalyzerOperationHandle<PrivateProjectRefresh> {
    const sequence = ++this.#sequence;
    const operation = deferred<PrivateProjectRefresh>();
    let settled = false;
    const requestId = `interruptible:request-${sequence}`;
    const handle = Object.freeze({
      requestId,
      sequence,
      kind: "analysis" as const,
      result: operation.promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        operation.reject(new PrivateAnalyzerOperationInterrupted("FADENO_ANALYZER_PROJECT_CANCELLED", requestId));
      },
    });
    this.pending.push(Object.freeze({
      handle,
      resolve: () => {
        if (settled) return;
        settled = true;
        operation.resolve(Object.freeze({ requestId, generation: sequence }) as PrivateProjectRefresh);
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        operation.reject(error);
      },
    }));
    return handle;
  }

  async close(): Promise<void> {}
}

function copyApplication(root: string): void {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/watcher-owner.ts"), "export {};\n");
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

const schedulerRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-watcher-scheduler-"));
const externalRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-watcher-external-"));
try {
  const scheduler = new ManualScheduler();
  const target = new ManualRefreshTarget(schedulerRoot);
  const cycles: PrivateFilesystemRefreshCycle[] = [];
  const failures: string[] = [];
  const adapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, target, {
    debounceMs: 25,
    maximumDelayMs: 100,
    maximumPendingHints: 2,
    scheduler,
    onCycle: (cycle) => { cycles.push(cycle); },
    onFailure: (_batch, error) => {
      failures.push(error instanceof Error ? error.message : String(error));
      throw new Error("FADENO_TEST_FAILURE_OBSERVER");
    },
  });

  assert.equal(adapter.notify({ kind: "change", path: "src/a.ts" }).reason, "contained-change");
  scheduler.advance(10);
  adapter.notify({ kind: "change", path: "src/b.ts" });
  scheduler.advance(10);
  assert.equal(adapter.notify({ kind: "change", path: "src/b.ts" }).reason, "duplicate-change");
  scheduler.advance(24);
  assert.equal(target.pending.length, 0);
  scheduler.advance(1);
  assert.equal(target.pending.length, 1);
  const burst = adapter.flush();
  target.pending[0]!.resolve();
  const burstCycle = await burst;
  assert.equal(burstCycle.batch.size, 3);
  assert.deepEqual(burstCycle.batch.hints, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(burstCycle.batch.reasons, ["contained-change", "duplicate-change"]);

  adapter.notify({ kind: "change", path: "src/alias.ts" });
  assert.equal(adapter.notify({ kind: "change", path: "src/./alias.ts" }).reason, "duplicate-alias-rescan");
  const alias = adapter.flush();
  target.pending[1]!.resolve();
  assert.equal((await alias).batch.fullWorkspace, true);

  adapter.notify({ kind: "change", path: "src/overflow-a.ts" });
  adapter.notify({ kind: "change", path: "src/overflow-b.ts" });
  assert.equal(adapter.notify({ kind: "change", path: "src/overflow-c.ts" }).reason, "overflow-rescan");
  const overflow = adapter.flush();
  target.pending[2]!.resolve();
  assert.equal((await overflow).batch.fullWorkspace, true);

  adapter.notify({ kind: "change", path: "src/active.ts" });
  scheduler.advance(25);
  assert.equal(target.pending.length, 4);
  const active = adapter.flush();
  adapter.notify({ kind: "change", path: "src/during-work.ts" });
  target.pending[3]!.resolve();
  await active;
  await Promise.resolve();
  await Promise.resolve();
  scheduler.advance(24);
  assert.equal(target.pending.length, 4);
  scheduler.advance(1);
  assert.equal(target.pending.length, 5);
  const dirty = adapter.flush();
  target.pending[4]!.resolve();
  assert.deepEqual((await dirty).batch.hints, ["src/during-work.ts"]);

  adapter.notify({ kind: "change", path: "src/max-0.ts" });
  for (let index = 1; index <= 4; index += 1) {
    scheduler.advance(20);
    adapter.notify({ kind: "change", path: `src/max-${index}.ts` });
  }
  scheduler.advance(20);
  assert.equal(target.pending.length, 6, "maximum delay did not force refresh");
  const maximum = adapter.flush();
  target.pending[5]!.resolve();
  assert.equal((await maximum).batch.fullWorkspace, true, "bounded hint overflow did not rescan workspace");

  assert.equal(adapter.notify({ kind: "change", path: ".fadeno/routes/index.js" }).status, "excluded");
  assert.equal(adapter.notify({ kind: "change", path: "dist/server/bootstrap.js" }).status, "excluded");
  assert.equal(adapter.notify({ kind: "change", path: ".git/index" }).status, "excluded");
  assert.equal(adapter.notify({ kind: "change", path: "../external.ts" }).status, "refused");
  assert.equal(adapter.notify({ kind: "change", path: "bad\0path" }).status, "refused");
  symlinkSync(externalRoot, join(schedulerRoot, "linked"));
  assert.equal(adapter.notify({ kind: "change", path: "linked/file.ts" }).reason, "symlink-path");
  assert.equal(adapter.notify({ kind: "rename", path: "src/renamed.ts" }).reason, "rename-rescan");
  assert.equal(adapter.notify({ kind: "change", path: null }).reason, "missing-name-rescan");
  const ambiguous = adapter.flush();
  target.pending[6]!.resolve();
  assert.equal((await ambiguous).batch.fullWorkspace, true);

  adapter.notify({ kind: "change", path: "src/failure.ts" });
  const failed = adapter.flush();
  target.pending[7]!.reject(new Error("FADENO_TEST_REFRESH_FAILURE"));
  await assert.rejects(failed, /FADENO_TEST_REFRESH_FAILURE/u);
  assert.deepEqual(failures, ["FADENO_TEST_REFRESH_FAILURE"]);

  adapter.notify({ kind: "change", path: "src/closing.ts" });
  scheduler.advance(25);
  const closingFlush = adapter.flush();
  const close = adapter.close();
  assert.equal(adapter.close(), close);
  await assert.rejects(closingFlush, /FADENO_ANALYZER_WATCH_CLOSED/u);
  await close;
  assert.equal(target.closeCount, 1);
  assert.throws(() => adapter.notify({ kind: "change", path: "src/closed.ts" }), /FADENO_ANALYZER_WATCH_CLOSED/u);
  await assert.rejects(adapter.flush(), /FADENO_ANALYZER_WATCH_CLOSED/u);
  assert.equal(cycles.length, 7);

  const identityScheduler = new ManualScheduler();
  const identityTarget = new ManualRefreshTarget(schedulerRoot);
  const identityAdapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, identityTarget, {
    debounceMs: 25,
    maximumDelayMs: 100,
    maximumPendingHints: 8,
    maximumPathBytes: 64,
    maximumPendingBytes: 128,
    scheduler: identityScheduler,
  });
  const firstIdentity = identityAdapter.notify({ kind: "change", path: "src/identity.ts" });
  const excludedIdentity = identityAdapter.notify({ kind: "change", path: ".git/index" });
  const refusedIdentity = identityAdapter.notify({ kind: "change", path: "../identity.ts" });
  assert.deepEqual(
    [firstIdentity.notificationSequence, excludedIdentity.notificationSequence, refusedIdentity.notificationSequence],
    [1, 2, 3],
  );
  assert.deepEqual(
    [firstIdentity.admissionSequence, excludedIdentity.admissionSequence, refusedIdentity.admissionSequence],
    [1, null, null],
  );
  for (let index = 0; index < 10; index += 1) {
    const duplicate = identityAdapter.notify({ kind: "change", path: "src/identity.ts" });
    assert.equal(duplicate.notificationSequence, index + 4);
    assert.equal(duplicate.admissionSequence, index + 2);
  }
  const distinctAfterDuplicates = identityAdapter.notify({ kind: "change", path: "src/identity-b.ts" });
  assert.equal(distinctAfterDuplicates.reason, "contained-change");
  assert.equal(distinctAfterDuplicates.admissionSequence, 12);
  const identityFlush = identityAdapter.flush();
  identityTarget.pending[0]!.resolve();
  const identityCycle = await identityFlush;
  assert.equal(identityCycle.batch.firstAdmissionSequence, 1);
  assert.equal(identityCycle.batch.latestAdmissionSequence, 12);
  assert.equal(identityCycle.batch.size, 12, "duplicate events must not silently truncate batch size");
  assert.deepEqual(identityCycle.batch.hints, ["src/identity-b.ts", "src/identity.ts"]);
  await identityAdapter.close();

  const byteScheduler = new ManualScheduler();
  const byteTarget = new ManualRefreshTarget(schedulerRoot);
  const byteAdapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, byteTarget, {
    debounceMs: 25,
    maximumDelayMs: 100,
    maximumPendingHints: 8,
    maximumPathBytes: 64,
    maximumPendingBytes: 80,
    scheduler: byteScheduler,
  });
  const overlong = byteAdapter.notify({ kind: "change", path: `src/${"x".repeat(61)}` });
  assert.equal(overlong.status, "refused");
  assert.equal(overlong.reason, "invalid-path");
  assert.equal(overlong.admissionSequence, null);
  const firstBounded = byteAdapter.notify({ kind: "change", path: `src/${"a".repeat(20)}.ts` });
  const aggregateOverflow = byteAdapter.notify({ kind: "change", path: `src/${"b".repeat(20)}.ts` });
  assert.equal(firstBounded.admissionSequence, 1);
  assert.equal(aggregateOverflow.admissionSequence, 2);
  assert.equal(aggregateOverflow.reason, "overflow-rescan");
  const byteFlush = byteAdapter.flush();
  byteTarget.pending[0]!.resolve();
  const byteCycle = await byteFlush;
  assert.equal(byteCycle.batch.fullWorkspace, true);
  assert.deepEqual(byteCycle.batch.hints, []);
  await byteAdapter.close();

  const rollbackScheduler = new ManualScheduler();
  const rollbackTarget = new ManualRefreshTarget(schedulerRoot);
  const rollbackAdapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, rollbackTarget, {
    debounceMs: 25,
    maximumDelayMs: 100,
    scheduler: rollbackScheduler,
  });
  rollbackScheduler.setNow(100);
  rollbackAdapter.notify({ kind: "change", path: "src/before-clock-rollback.ts" });
  rollbackScheduler.setNow(50);
  rollbackAdapter.notify({ kind: "change", path: "src/after-clock-rollback.ts" });
  rollbackScheduler.setNow(124);
  rollbackScheduler.advance(1);
  assert.equal(rollbackTarget.pending.length, 1, "clock rollback stranded an accepted refresh");
  const rollbackFlush = rollbackAdapter.flush();
  rollbackTarget.pending[0]!.resolve();
  const rollbackCycle = await rollbackFlush;
  assert.deepEqual(rollbackCycle.batch.hints, ["src/after-clock-rollback.ts", "src/before-clock-rollback.ts"]);
  await rollbackAdapter.close();

  const interruptedScheduler = new ManualScheduler();
  const interruptedTarget = new InterruptibleRefreshTarget(schedulerRoot);
  const interruptedCycles: PrivateFilesystemRefreshCycle[] = [];
  const interruptions: unknown[] = [];
  const interruptedFailures: unknown[] = [];
  const interruptedAdapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, interruptedTarget, {
    debounceMs: 25,
    maximumDelayMs: 100,
    scheduler: interruptedScheduler,
    onCycle: (cycle) => { interruptedCycles.push(cycle); },
    onInterruption: (_batch, error) => { interruptions.push(error); },
    onFailure: (_batch, error) => { interruptedFailures.push(error); },
  });
  interruptedAdapter.notify({ kind: "change", path: "src/cancelled.ts" });
  const interruptedFlush = interruptedAdapter.flush();
  interruptedTarget.pending[0]!.handle.cancel();
  await assert.rejects(interruptedFlush, /FADENO_ANALYZER_PROJECT_CANCELLED/u);
  assert.deepEqual(interruptedCycles, []);
  assert.equal(interruptions.length, 1);
  assert.ok(interruptions[0] instanceof PrivateAnalyzerOperationInterrupted);
  assert.deepEqual(interruptedFailures, []);
  await interruptedAdapter.close();

  const closingScheduler = new ManualScheduler();
  const closingTarget = new ManualRefreshTarget(schedulerRoot);
  const closingCycles: PrivateFilesystemRefreshCycle[] = [];
  const closingFailures: unknown[] = [];
  const closingAdapter = new PrivateFilesystemInvalidationAdapter(schedulerRoot, closingTarget, {
    debounceMs: 25,
    maximumDelayMs: 100,
    scheduler: closingScheduler,
    onCycle: (cycle) => { closingCycles.push(cycle); },
    onFailure: (_batch, error) => { closingFailures.push(error); },
  });
  closingAdapter.notify({ kind: "change", path: "src/queued-success.ts" });
  const queuedSuccessFlush = closingAdapter.flush();
  closingTarget.pending[0]!.resolve();
  const closing = closingAdapter.close();
  await assert.rejects(queuedSuccessFlush, /FADENO_ANALYZER_WATCH_CLOSED/u);
  await closing;
  assert.deepEqual(closingCycles, []);
  assert.deepEqual(closingFailures, []);
  assert.deepEqual(closingAdapter.ownership(), {
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
  });
} finally {
  rmSync(schedulerRoot, { recursive: true, force: true });
  rmSync(externalRoot, { recursive: true, force: true });
}

const integrationRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-watcher-integration-"));
try {
  copyApplication(integrationRoot);
  const server = join(integrationRoot, "src/watcher-owner.ts");
  const serverBytes = readFileSync(server, "utf8");
  const support = join(integrationRoot, "src/watcher-support");
  mkdirSync(support);
  writeFileSync(join(support, "first.ts"), "export { watcherValue } from './second.ts';\n");
  writeFileSync(join(support, "second.ts"), "export { watcherValue } from './third.ts';\n");
  const transitiveLeaf = join(support, "third.ts");
  writeFileSync(transitiveLeaf, "export const watcherValue: string = 'current';\n");
  writeFileSync(server, "import { watcherValue } from './watcher-support/first.ts';\nvoid watcherValue;\n" + serverBytes);
  const analyzer = new PrivateProjectAnalyzer(integrationRoot);
  const adapter = new PrivateFilesystemInvalidationAdapter(integrationRoot, analyzer, {
    debounceMs: 0,
    maximumDelayMs: 1,
  });
  await adapter.flush();
  const initial = outputBytes(integrationRoot);

  const route = join(integrationRoot, "src/routes/watched/page.tsx");
  mkdirSync(join(integrationRoot, "src/routes/watched"), { recursive: true });
  writeFileSync(route, "export default function Page(): string { return 'watched'; }\n");
  adapter.notify({ kind: "change", path: route });
  assert.equal((await adapter.flush()).refresh.application.changed, true);

  const beforeFailure = outputBytes(integrationRoot);
  writeFileSync(transitiveLeaf, "export const watcherValue: string = 1;\n");
  adapter.notify({ kind: "change", path: "src/watcher-support/third.ts" });
  await assert.rejects(adapter.flush(), /FADENO_ANALYZER_COMPILER_DIAGNOSTIC/u);
  assertOutput(integrationRoot, beforeFailure);
  writeFileSync(transitiveLeaf, "export const watcherValue: string = 'recovered';\n");
  adapter.notify({ kind: "change", path: "src/watcher-support/third.ts" });
  await adapter.flush();

  rmSync(join(integrationRoot, "src/routes/watched"), { recursive: true });
  adapter.notify({ kind: "rename", path: route });
  assert.equal((await adapter.flush()).refresh.application.changed, true);
  assert.deepEqual(Object.keys(initial), Object.keys(outputBytes(integrationRoot)));

  const config = join(integrationRoot, "fadeno.config.ts");
  const configBytes = readFileSync(config, "utf8");
  writeFileSync(config, `// watcher configuration epoch\n${configBytes}`);
  adapter.notify({ kind: "change", path: "fadeno.config.ts" });
  assert.equal((await adapter.flush()).refresh.application.changed, false);

  const closing = adapter.close();
  assert.equal(adapter.close(), closing);
  await closing;
} finally {
  rmSync(integrationRoot, { recursive: true, force: true });
}

console.log("V1 filesystem invalidation adapter passed (bounded identity/bytes/time, dirty work, refusal, recovery, close)");
