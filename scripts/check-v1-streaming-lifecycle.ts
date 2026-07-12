import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";

import { createCspNonce } from "../packages/framework/dist/internal/rendering-security.js";
import {
  BoundaryCancellationTree,
  canStartBoundary,
  deriveDeadline,
  InOrderBoundaryCursor,
  resolveBoundaryFailure,
  StreamingLifecycle,
  type BoundaryState,
  type BoundaryCancellationReason,
  type CancellationReason,
  type RootFailureKind,
  type StreamPhase,
} from "../packages/framework/dist/internal/streaming-lifecycle.js";

interface Operation { readonly op: string; readonly status?: number; readonly chunk?: string; readonly kind?: RootFailureKind; readonly reason?: CancellationReason }
interface ExpectedLifecycle { readonly phase: StreamPhase; readonly status: number | null; readonly writes: readonly string[]; readonly closeCalls: number; readonly abortCalls: readonly string[]; readonly reports: readonly string[]; readonly cleanupCalls: number }
interface LifecycleCase { readonly id: string; readonly operations: readonly Operation[]; readonly expected: ExpectedLifecycle }
interface RefusalCase { readonly id: string; readonly action: string; readonly error: string }
interface BoundaryCase { readonly id: string; readonly failed: string; readonly fallbackFailures: readonly string[]; readonly boundaries: readonly BoundaryState[]; readonly expected: unknown }
interface BoundaryRefusalCase { readonly id: string; readonly failed: string; readonly boundaries: readonly BoundaryState[]; readonly error: string }
interface CancellationCase { readonly id: string; readonly cancels: readonly { readonly id: string; readonly reason: BoundaryCancellationReason }[]; readonly expected: Readonly<Record<string, BoundaryCancellationReason | null>> }
interface Corpus {
  readonly schemaVersion: number;
  readonly futureConsumer: string;
  readonly phaseOrder: readonly string[];
  readonly precommitOutcomes: Readonly<Record<RootFailureKind, number>>;
  readonly lifecycleCases: readonly LifecycleCase[];
  readonly refusalCases: readonly RefusalCase[];
  readonly boundaryCases: readonly BoundaryCase[];
  readonly boundaryRefusalCases: readonly BoundaryRefusalCase[];
  readonly deadlineCases: readonly { readonly id: string; readonly parent: number | null; readonly startedAt: number; readonly budget: number; readonly expected: number }[];
  readonly orderingCases: readonly { readonly id: string; readonly position: number; readonly nextPosition: number; readonly expected: boolean }[];
  readonly orderingRefusalCases: readonly { readonly id: string; readonly action: string; readonly error: string }[];
  readonly cancellationCases: readonly CancellationCase[];
  readonly asyncCases: readonly string[];
}

interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const contractRoot = new URL("../packages/framework/contracts/", import.meta.url);
const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("streaming-lifecycle-v1.corpus.json", contractRoot)), "utf8")) as Corpus;
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("streaming-lifecycle-v1.schema.json", contractRoot)), "utf8"));
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(corpus)) throw new Error(`FADENO_STREAM_CORPUS_SCHEMA:${JSON.stringify(validate.errors)}`);
assert.equal(corpus.schemaVersion, 1);
assert.equal(corpus.futureConsumer, "V1-09 renderer and adapter integration");
assert.deepEqual(corpus.phaseOrder, ["uncommitted", "head-published", "body-started", "completed|terminated|cancelled"]);

const allIds = [...corpus.lifecycleCases, ...corpus.refusalCases, ...corpus.boundaryCases, ...corpus.boundaryRefusalCases, ...corpus.deadlineCases, ...corpus.orderingCases, ...corpus.orderingRefusalCases, ...corpus.cancellationCases].map((fixture) => fixture.id);
assert.equal(new Set([...allIds, ...corpus.asyncCases]).size, allIds.length + corpus.asyncCases.length, "fixture IDs must be globally unique");
assert.deepEqual(corpus.lifecycleCases.map((fixture) => fixture.id), ["empty-body-success", "two-chunk-success", "precommit-not-found", "precommit-redirect", "precommit-unexpected", "precommit-timeout", "precommit-disconnect", "precommit-explicit", "precommit-superseded", "post-head-unexpected", "post-body-not-found", "post-body-redirect", "post-body-timeout", "post-head-disconnect", "post-body-explicit", "post-body-superseded"]);
assert.deepEqual(corpus.refusalCases.map((fixture) => fixture.id), ["write-before-head", "double-head", "wrong-precommit-status", "complete-before-head", "concurrent-write", "invalid-status", "invalid-header", "null-body-write", "bodyless-nonce", "redirect-nonce", "forged-nonce", "reused-nonce"]);
assert.deepEqual(corpus.boundaryCases.map((fixture) => fixture.id), ["nearest-child-fallback", "child-fallback-escalates", "parent-fallback-also-fails", "partial-child-terminates", "inactive-child-uses-parent"]);
assert.deepEqual(corpus.boundaryRefusalCases.map((fixture) => fixture.id), ["duplicate-boundary", "unknown-boundary", "missing-parent", "boundary-cycle"]);
assert.deepEqual(corpus.deadlineCases.map((fixture) => fixture.id), ["root-deadline", "child-narrows", "child-cannot-extend"]);
assert.deepEqual(corpus.orderingCases.map((fixture) => fixture.id), ["current-slot-starts", "later-slot-waits"]);
assert.deepEqual(corpus.orderingRefusalCases.map((fixture) => fixture.id), ["second-active-slot-refused", "out-of-order-slot-refused", "wrong-slot-completion-refused"]);
assert.deepEqual(corpus.cancellationCases.map((fixture) => fixture.id), ["parent-cascades", "child-timeout-isolated", "first-reason-wins"]);
assert.deepEqual(corpus.asyncCases, ["slow-sink-one-pending-chunk", "write-rejection-terminates", "middle-chunk-rejection-terminates", "last-chunk-rejection-terminates", "close-rejection-terminates", "cancel-while-write-pending-ignores-late-acceptance", "cancel-while-close-pending-ignores-late-close", "throwing-reporter-still-cleans", "throwing-cleanup-contained", "never-settling-terminal-effects-do-not-block-cleanup", "child-deadline-fires-and-clears", "parent-cancel-clears-child-deadline", "boundary-completion-clears-deadline", "deadline-timer-cleared-once", "abort-listener-removed-once", "nonce-head-markup-correlation"]);

for (const fixture of corpus.lifecycleCases) {
  const writes: string[] = [];
  const abortCalls: string[] = [];
  const reports: string[] = [];
  let closeCalls = 0;
  let cleanupCalls = 0;
  const lifecycle = new StreamingLifecycle({
    sink: {
      write(chunk) { writes.push(decoder.decode(chunk)); },
      close() { closeCalls += 1; },
      abort(reason) { abortCalls.push(reason); },
    },
    reporter: { report(code) { reports.push(code); } },
    cleanup() { cleanupCalls += 1; },
  });
  for (const operation of fixture.operations) {
    if (operation.op === "publish") lifecycle.publishHead({ status: operation.status ?? 0 });
    else if (operation.op === "write") await lifecycle.write(encoder.encode(operation.chunk));
    else if (operation.op === "empty") {
      const before = lifecycle.phase;
      await lifecycle.write(new Uint8Array());
      assert.equal(lifecycle.phase, before, `${fixture.id}:empty`);
    } else if (operation.op === "complete") await lifecycle.complete();
    else if (operation.op === "fail") {
      const decision = await lifecycle.fail(operation.kind ?? "unexpected");
      if (lifecycle.phase === "uncommitted") {
        assert.equal(decision.status, corpus.precommitOutcomes[operation.kind ?? "unexpected"], fixture.id);
        assert.equal(lifecycle.signal.aborted, true, `${fixture.id}:work-aborted`);
      }
    } else if (operation.op === "cancel") await lifecycle.cancel(operation.reason ?? "explicit");
  }
  assert.deepEqual({
    phase: lifecycle.phase,
    status: lifecycle.head?.status ?? null,
    writes,
    closeCalls,
    abortCalls,
    reports,
    cleanupCalls,
  }, fixture.expected, fixture.id);
  assert.equal(lifecycle.cleanupCalls, fixture.expected.cleanupCalls, `${fixture.id}:internal-cleanup`);
  assert.equal(lifecycle.bodyStarted, fixture.expected.writes.length > 0, `${fixture.id}:body-started-history`);
  const shouldAbortWork = fixture.expected.phase !== "completed" || fixture.operations.some((operation) => operation.op === "fail" || operation.op === "cancel");
  assert.equal(lifecycle.signal.aborted, shouldAbortWork, `${fixture.id}:terminal-signal`);
}

async function refusal(action: string): Promise<void> {
  const sink = { write() {}, close() {}, abort() {} };
  const lifecycle = new StreamingLifecycle({ sink });
  if (action === "write-before-head") await lifecycle.write(encoder.encode("x"));
  else if (action === "double-head") { lifecycle.publishHead({ status: 200 }); lifecycle.publishHead({ status: 200 }); }
  else if (action === "wrong-precommit-status") { await lifecycle.fail("not-found"); lifecycle.publishHead({ status: 200 }); }
  else if (action === "complete-before-head") await lifecycle.complete();
  else if (action === "concurrent-write") {
    const gate = deferred<void>();
    const blocked = new StreamingLifecycle({ sink: { write: () => gate.promise, close() {}, abort() {} } });
    blocked.publishHead({ status: 200 });
    const first = blocked.write(encoder.encode("first"));
    try { await blocked.write(encoder.encode("second")); } finally { gate.resolve(); await first; }
  } else if (action === "invalid-status") {
    lifecycle.publishHead({ status: 101 });
  } else if (action === "invalid-header") {
    lifecycle.publishHead({ status: 200, headers: { "x-invalid": "line\r\nbreak" } });
  } else if (action === "null-body-write") {
    lifecycle.publishHead({ status: 204 });
    await lifecycle.write(encoder.encode("forbidden"));
  } else if (action === "bodyless-nonce") {
    let allocations = 0;
    const bodyless = new StreamingLifecycle({ sink, nonceFactory() { allocations += 1; return createCspNonce(); } });
    try { bodyless.publishHead({ status: 204, executableMarkup: true }); } finally { assert.equal(allocations, 0); }
  } else if (action === "redirect-nonce") {
    let allocations = 0;
    const redirect = new StreamingLifecycle({ sink, nonceFactory() { allocations += 1; return createCspNonce(); } });
    try { redirect.publishHead({ status: 303, executableMarkup: true }); } finally { assert.equal(allocations, 0); }
  } else if (action === "forged-nonce") {
    const forged = Object.freeze(Object.create(null) as object);
    const forgedLifecycle = new StreamingLifecycle({ sink, nonceFactory: () => forged });
    forgedLifecycle.publishHead({ status: 200, executableMarkup: true });
  } else if (action === "reused-nonce") {
    const nonce = createCspNonce();
    const first = new StreamingLifecycle({ sink, nonceFactory: () => nonce });
    first.publishHead({ status: 200, executableMarkup: true });
    const second = new StreamingLifecycle({ sink, nonceFactory: () => nonce });
    second.publishHead({ status: 200, executableMarkup: true });
  } else throw new Error(`unknown refusal ${action}`);
}

for (const fixture of corpus.refusalCases) {
  await assert.rejects(() => refusal(fixture.action), { message: fixture.error }, fixture.id);
}

for (const fixture of corpus.boundaryCases) {
  assert.deepEqual(resolveBoundaryFailure(fixture.boundaries, fixture.failed, fixture.fallbackFailures), fixture.expected, fixture.id);
}
for (const fixture of corpus.boundaryRefusalCases) {
  assert.throws(() => resolveBoundaryFailure(fixture.boundaries, fixture.failed), { message: fixture.error }, fixture.id);
}
for (const fixture of corpus.deadlineCases) {
  assert.equal(deriveDeadline(fixture.parent ?? undefined, fixture.startedAt, fixture.budget), fixture.expected, fixture.id);
}
for (const fixture of corpus.orderingCases) {
  assert.equal(canStartBoundary(fixture.position, fixture.nextPosition), fixture.expected, fixture.id);
}
for (const fixture of corpus.orderingRefusalCases) {
  const cursor = new InOrderBoundaryCursor();
  assert.throws(() => {
    if (fixture.action === "active") { cursor.start(0); cursor.start(1); }
    else if (fixture.action === "order") cursor.start(1);
    else cursor.complete(0);
  }, { message: fixture.error }, fixture.id);
}
{
  const cursor = new InOrderBoundaryCursor();
  cursor.start(0);
  cursor.complete(0);
  cursor.start(1);
  assert.throws(() => cursor.start(2), { message: "FADENO_STREAM_BOUNDARY_ACTIVE" });
  cursor.complete(1);
  assert.equal(cursor.nextPosition, 2);
}

const cancellationBoundaries: readonly BoundaryState[] = [
  { id: "root", active: true, emitted: false },
  { id: "child", parentId: "root", active: true, emitted: false },
  { id: "grandchild", parentId: "child", active: true, emitted: false },
  { id: "sibling", parentId: "root", active: true, emitted: false },
];
for (const fixture of corpus.cancellationCases) {
  const tree = new BoundaryCancellationTree(cancellationBoundaries);
  for (const cancellation of fixture.cancels) tree.cancel(cancellation.id, cancellation.reason);
  for (const [id, expected] of Object.entries(fixture.expected)) {
    assert.equal(tree.reason(id) ?? null, expected, `${fixture.id}:${id}:reason`);
    assert.equal(tree.signal(id).aborted, expected !== null, `${fixture.id}:${id}:signal`);
  }
  if (fixture.id === "child-timeout-isolated") assert.deepEqual(tree.resolveFailure("child"), { kind: "fallback", ownerId: "child" });
  if (fixture.id === "first-reason-wins") {
    tree.markEmitted("root");
    assert.deepEqual(tree.resolveFailure("child", ["child"]), { kind: "terminate" });
  }
  tree.releaseAll();
  tree.releaseAll();
  assert.equal(tree.cleanupCalls, 1);
  assert.throws(() => tree.signal("root"), { message: "FADENO_STREAM_BOUNDARY_UNKNOWN" });
}
{
  const tree = new BoundaryCancellationTree(cancellationBoundaries);
  tree.markEmitted("child");
  assert.deepEqual(tree.resolveFailure("child"), { kind: "terminate" });
  tree.releaseAll();
}

const executedAsyncCases = new Set<string>();

{
  const gate = deferred<void>();
  let writes = 0;
  const lifecycle = new StreamingLifecycle({ sink: { write() { writes += 1; return gate.promise; }, close() {}, abort() {} } });
  lifecycle.publishHead({ status: 200 });
  const first = lifecycle.write(encoder.encode("first"));
  assert.equal(lifecycle.writePending, true);
  assert.equal(lifecycle.phase, "head-published");
  await assert.rejects(() => lifecycle.write(encoder.encode("second")), { message: "FADENO_STREAM_BACKPRESSURE" });
  assert.equal(writes, 1);
  gate.resolve();
  await first;
  assert.equal(lifecycle.phase, "body-started");
  await lifecycle.complete();
  executedAsyncCases.add("slow-sink-one-pending-chunk");
}

{
  const aborts: string[] = [];
  let cleanup = 0;
  const lifecycle = new StreamingLifecycle({ sink: { write() { throw new Error("sink"); }, close() {}, abort(reason) { aborts.push(reason); } }, cleanup() { cleanup += 1; } });
  lifecycle.publishHead({ status: 200 });
  await assert.rejects(() => lifecycle.write(encoder.encode("first")), { message: "FADENO_STREAM_WRITE_FAILURE" });
  assert.equal(lifecycle.phase, "terminated");
  assert.deepEqual(aborts, ["write-failure"]);
  assert.equal(cleanup, 1);
  executedAsyncCases.add("write-rejection-terminates");
}

async function verifyLaterChunkRejection(id: string, rejectAt: number): Promise<void> {
  let calls = 0;
  const lifecycle = new StreamingLifecycle({
    sink: { write() { calls += 1; if (calls === rejectAt) throw new Error("sink"); }, close() {}, abort() {} },
  });
  lifecycle.publishHead({ status: 200 });
  for (let position = 1; position < rejectAt; position += 1) await lifecycle.write(encoder.encode(`chunk-${position}`));
  await assert.rejects(() => lifecycle.write(encoder.encode(`chunk-${rejectAt}`)), { message: "FADENO_STREAM_WRITE_FAILURE" });
  assert.equal(lifecycle.phase, "terminated");
  assert.equal(lifecycle.bodyStarted, true);
  assert.equal(lifecycle.cleanupCalls, 1);
  executedAsyncCases.add(id);
}

await verifyLaterChunkRejection("middle-chunk-rejection-terminates", 2);
await verifyLaterChunkRejection("last-chunk-rejection-terminates", 3);

{
  const aborts: string[] = [];
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close() { throw new Error("close"); }, abort(reason) { aborts.push(reason); } } });
  lifecycle.publishHead({ status: 200 });
  await assert.rejects(() => lifecycle.complete(), { message: "FADENO_STREAM_CLOSE_FAILURE" });
  assert.equal(lifecycle.phase, "terminated");
  assert.deepEqual(aborts, ["close-failure"]);
  executedAsyncCases.add("close-rejection-terminates");
}

{
  const gate = deferred<void>();
  let cleanup = 0;
  const lifecycle = new StreamingLifecycle({ sink: { write: () => gate.promise, close() {}, abort() {} }, cleanup() { cleanup += 1; } });
  lifecycle.publishHead({ status: 200 });
  const pending = lifecycle.write(encoder.encode("first"));
  await lifecycle.cancel("explicit");
  gate.resolve();
  await pending;
  assert.equal(lifecycle.phase, "cancelled");
  assert.equal(cleanup, 1);
  executedAsyncCases.add("cancel-while-write-pending-ignores-late-acceptance");
}

{
  const gate = deferred<void>();
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close: () => gate.promise, abort() {} } });
  lifecycle.publishHead({ status: 200 });
  const completing = lifecycle.complete();
  await lifecycle.cancel("explicit");
  gate.resolve();
  await completing;
  assert.equal(lifecycle.phase, "cancelled");
  assert.equal(lifecycle.cleanupCalls, 1);
  executedAsyncCases.add("cancel-while-close-pending-ignores-late-close");
}

{
  let cleanup = 0;
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close() {}, abort() {} }, reporter: { report() { throw new Error("reporter"); } }, cleanup() { cleanup += 1; } });
  lifecycle.publishHead({ status: 200 });
  await lifecycle.fail("unexpected");
  assert.equal(lifecycle.phase, "terminated");
  assert.equal(cleanup, 1);
  executedAsyncCases.add("throwing-reporter-still-cleans");
}

{
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close() {}, abort() {} }, cleanup() { throw new Error("cleanup"); } });
  lifecycle.publishHead({ status: 200 });
  await lifecycle.fail("unexpected");
  assert.equal(lifecycle.phase, "terminated");
  assert.equal(lifecycle.cleanupCalls, 1);
  executedAsyncCases.add("throwing-cleanup-contained");
}

{
  const never = new Promise<void>(() => undefined);
  let cleanup = 0;
  const lifecycle = new StreamingLifecycle({
    sink: { write() {}, close() {}, abort: () => never },
    reporter: { report: () => never },
    cleanup() { cleanup += 1; },
  });
  lifecycle.publishHead({ status: 200 });
  await lifecycle.fail("unexpected");
  assert.equal(lifecycle.phase, "terminated");
  assert.equal(cleanup, 1);
  executedAsyncCases.add("never-settling-terminal-effects-do-not-block-cleanup");
}

interface TimerRecord { readonly delay: number; readonly callback: () => void; cancelCalls: number }
function recordedTimer(records: TimerRecord[]) {
  return {
    schedule(delay: number, callback: () => void) {
      const record: TimerRecord = { delay, callback, cancelCalls: 0 };
      records.push(record);
      return () => { record.cancelCalls += 1; };
    },
  };
}

{
  const records: TimerRecord[] = [];
  const tree = new BoundaryCancellationTree(cancellationBoundaries);
  assert.equal(tree.scheduleDeadline("root", 0, 1000, () => 0, recordedTimer(records)), 1000);
  assert.equal(tree.scheduleDeadline("child", 0, 500, () => 0, recordedTimer(records)), 500);
  assert.deepEqual(records.map((record) => record.delay), [1000, 500]);
  records[1]?.callback();
  assert.equal(tree.reason("child"), "timeout");
  assert.equal(tree.reason("grandchild"), "timeout");
  assert.equal(tree.reason("root"), undefined);
  assert.equal(records[1]?.cancelCalls, 1);
  tree.releaseAll();
  assert.deepEqual(records.map((record) => record.cancelCalls), [1, 1]);
  executedAsyncCases.add("child-deadline-fires-and-clears");
}

{
  const records: TimerRecord[] = [];
  const tree = new BoundaryCancellationTree(cancellationBoundaries);
  tree.scheduleDeadline("root", 0, 1000, () => 0, recordedTimer(records));
  tree.scheduleDeadline("child", 0, 500, () => 0, recordedTimer(records));
  tree.cancel("root", "disconnect");
  assert.deepEqual(records.map((record) => record.cancelCalls), [1, 1]);
  assert.equal(tree.reason("child"), "disconnect");
  tree.releaseAll();
  assert.deepEqual(records.map((record) => record.cancelCalls), [1, 1]);
  executedAsyncCases.add("parent-cancel-clears-child-deadline");
}

{
  const records: TimerRecord[] = [];
  const tree = new BoundaryCancellationTree(cancellationBoundaries);
  tree.scheduleDeadline("child", 0, 500, () => 0, recordedTimer(records));
  tree.complete("child");
  assert.equal(records[0]?.cancelCalls, 1);
  assert.equal(tree.signal("child").aborted, false);
  assert.deepEqual(tree.resolveFailure("child"), { kind: "fallback", ownerId: "root" });
  tree.releaseAll();
  assert.equal(records[0]?.cancelCalls, 1);
  executedAsyncCases.add("boundary-completion-clears-deadline");
}

{
  let timerCallback: (() => void) | undefined;
  let clearCalls = 0;
  let applicationAbortCalls = 0;
  const lifecycle = new StreamingLifecycle({
    sink: { write() {}, close() {}, abort() {} }, deadlineAt: 1500, now: () => 1000,
    timer: { schedule(delay, callback) { assert.equal(delay, 500); timerCallback = callback; return () => { clearCalls += 1; }; } },
  });
  lifecycle.signal.addEventListener("abort", () => { applicationAbortCalls += 1; }, { once: true });
  timerCallback?.();
  assert.deepEqual(lifecycle.precommitDecision, { kind: "replace", status: 504 });
  assert.equal(lifecycle.signal.aborted, true);
  assert.equal(applicationAbortCalls, 1);
  assert.throws(() => lifecycle.publishHead({ status: 200 }), { message: "FADENO_STREAM_PRECOMMIT_OUTCOME" });
  lifecycle.publishHead({ status: 504 });
  await lifecycle.complete();
  assert.equal(clearCalls, 1);
  executedAsyncCases.add("deadline-timer-cleared-once");
}

{
  let addCalls = 0;
  let removeCalls = 0;
  let abortListener: (() => void) | undefined;
  const signal = {
    aborted: false,
    addEventListener(_type: string, listener: () => void) { addCalls += 1; abortListener = listener; },
    removeEventListener(_type: string, listener: () => void) { if (listener === abortListener) removeCalls += 1; },
  } as unknown as AbortSignal;
  let cleanup = 0;
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close() {}, abort() {} }, signal, cleanup() { cleanup += 1; } });
  abortListener?.();
  await Promise.resolve();
  assert.equal(lifecycle.phase, "cancelled");
  abortListener?.();
  assert.equal(cleanup, 1);
  assert.equal(addCalls, 1);
  assert.equal(removeCalls, 1);
  executedAsyncCases.add("abort-listener-removed-once");
}

{
  let allocations = 0;
  const lifecycle = new StreamingLifecycle({
    sink: { write() {}, close() {}, abort() {} },
    nonceFactory() { allocations += 1; return createCspNonce(); },
  });
  const mutableHeaders = { "content-type": "text/html" };
  assert.equal(allocations, 0);
  const head = lifecycle.publishHead({ status: 200, headers: mutableHeaders, executableMarkup: true });
  assert.equal(allocations, 1);
  mutableHeaders["content-type"] = "text/plain";
  assert.equal(head.headers["content-type"], "text/html");
  assert.match(head.nonce ?? "", /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(Object.isFrozen(head), true);
  assert.equal(Object.isFrozen(head.headers), true);
  assert.equal(head.bodyAllowed, true);
  await lifecycle.complete();
  let abandonedAllocations = 0;
  const abandoned = new StreamingLifecycle({
    sink: { write() {}, close() {}, abort() {} },
    nonceFactory() { abandonedAllocations += 1; return createCspNonce(); },
  });
  await abandoned.cancel("superseded");
  assert.equal(abandonedAllocations, 0);
  executedAsyncCases.add("nonce-head-markup-correlation");
}

assert.deepEqual([...executedAsyncCases].sort(), [...corpus.asyncCases].sort());
console.log("V1 streaming lifecycle passed (commit, boundaries, deadlines, cancellation, backpressure, cleanup, nonce timing)");
