import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";

import { createCspNonce } from "../packages/framework/dist/internal/rendering-security.js";
import {
  canStartBoundary,
  deriveDeadline,
  resolveBoundaryFailure,
  StreamingLifecycle,
  type BoundaryState,
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

const allIds = [...corpus.lifecycleCases, ...corpus.refusalCases, ...corpus.boundaryCases, ...corpus.boundaryRefusalCases, ...corpus.deadlineCases, ...corpus.orderingCases].map((fixture) => fixture.id);
assert.equal(new Set([...allIds, ...corpus.asyncCases]).size, allIds.length + corpus.asyncCases.length, "fixture IDs must be globally unique");

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
      if (lifecycle.phase === "uncommitted") assert.equal(decision.status, corpus.precommitOutcomes[operation.kind ?? "unexpected"], fixture.id);
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
  } else if (action === "uncorrelated-nonce") {
    lifecycle.publishHead({ status: 200, executableMarkup: true, headerNonce: createCspNonce(), markupNonce: createCspNonce() });
  } else if (action === "forged-nonce") {
    const forged = Object.freeze(Object.create(null) as object);
    lifecycle.publishHead({ status: 200, executableMarkup: true, headerNonce: forged, markupNonce: forged });
  } else if (action === "unused-nonce") {
    const nonce = createCspNonce();
    lifecycle.publishHead({ status: 200, headerNonce: nonce, markupNonce: nonce });
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
  let timerCallback: (() => void) | undefined;
  let clearCalls = 0;
  const lifecycle = new StreamingLifecycle({
    sink: { write() {}, close() {}, abort() {} }, deadlineAt: 1500, now: () => 1000,
    timer: { schedule(delay, callback) { assert.equal(delay, 500); timerCallback = callback; return () => { clearCalls += 1; }; } },
  });
  timerCallback?.();
  assert.deepEqual(lifecycle.precommitDecision, { kind: "replace", status: 504 });
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
  const nonce = createCspNonce();
  const lifecycle = new StreamingLifecycle({ sink: { write() {}, close() {}, abort() {} } });
  const mutableHeaders = { "content-type": "text/html" };
  const head = lifecycle.publishHead({ status: 200, headers: mutableHeaders, executableMarkup: true, headerNonce: nonce, markupNonce: nonce });
  mutableHeaders["content-type"] = "text/plain";
  assert.equal(head.headers["content-type"], "text/html");
  assert.match(head.nonce ?? "", /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(Object.isFrozen(head), true);
  assert.equal(Object.isFrozen(head.headers), true);
  await lifecycle.complete();
  executedAsyncCases.add("nonce-head-markup-correlation");
}

assert.deepEqual([...executedAsyncCases].sort(), [...corpus.asyncCases].sort());
console.log("V1 streaming lifecycle passed (commit, boundaries, deadlines, cancellation, backpressure, cleanup, nonce timing)");
