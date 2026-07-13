import assert from "node:assert/strict";

import { defineResource, resourceError } from "../packages/framework/src/index.ts";
import {
  assertResourceCachePolicy,
  classifyResourceFailure,
  readResourceError,
  ResourceRequestScope,
} from "../packages/framework/src/internal/resource.ts";

function request(signal?: AbortSignal, authorization = "Bearer redacted"): Request {
  return new Request("https://example.test/projects", { headers: { authorization }, ...(signal ? { signal } : {}) });
}

let projectLoads = 0;
let releaseProject: (() => void) | undefined;
const projects = defineResource({ read: async ({ input }: { input: Readonly<{ account: number; filters: Readonly<{ open: boolean; tag: string }> }> }) => {
  projectLoads += 1;
  await new Promise<void>((resolve) => { releaseProject = resolve; });
  return [{ id: input.account, title: input.filters.tag }];
} });
const success = new ResourceRequestScope(request());
const first = success.read(projects, { account: 7, filters: { tag: "active", open: true } });
const equivalent = success.read(projects, { filters: { open: true, tag: "active" }, account: 7 });
assert.equal(projectLoads, 1, "equivalent concurrent reads share the in-flight request promise");
releaseProject?.();
assert.deepEqual(await first, [{ id: 7, title: "active" }]);
assert.strictEqual(await equivalent, await first);
assert.equal(success.dependencies.length, 1);
assert.equal(success.dependencies[0]?.observation.status, "value");
assert.deepEqual(success.flows.map(({ cache, cause }) => ({ cache, cause })), [
  { cache: "miss", cause: "loader-completed" },
  { cache: "request-hit", cause: "equivalent-input" },
]);

const distinct = success.read(projects, { account: 8, filters: { tag: "active", open: true } });
assert.equal(projectLoads, 2, "distinct input creates distinct work");
releaseProject?.();
assert.deepEqual(await distinct, [{ id: 8, title: "active" }]);
assert.equal(success.dependencies.length, 2);

let authorizationLoads = 0;
const authorized = defineResource({ read: ({ request: ownedRequest }) => {
  authorizationLoads += 1;
  if (ownedRequest.headers.get("authorization") !== "Bearer tenant-a") {
    throw resourceError({ code: "RESOURCE_FORBIDDEN", status: 403 });
  }
  return "tenant-a-value";
} });
const tenantA = new ResourceRequestScope(request(undefined, "Bearer tenant-a"));
const tenantB = new ResourceRequestScope(request(undefined, "Bearer tenant-b"));
assert.equal(await tenantA.read(authorized, null), "tenant-a-value");
await assert.rejects(tenantB.read(authorized, null), (error: unknown) => {
  assert.deepEqual(readResourceError(error), { code: "RESOURCE_FORBIDDEN", status: 403 });
  assert.equal(classifyResourceFailure(error), "expected");
  return true;
});
await assert.rejects(tenantB.read(authorized, null), (error: unknown) => readResourceError(error)?.code === "RESOURCE_FORBIDDEN");
assert.equal(authorizationLoads, 2, "separate request owners cannot share authorization-bearing results");
assert.equal(tenantB.dependencies.length, 1);
assert.deepEqual(tenantB.dependencies[0]?.observation, { status: "expected-error", code: "RESOURCE_FORBIDDEN", httpStatus: 403 });

let unexpectedLoads = 0;
const broken = defineResource({ read: () => {
  unexpectedLoads += 1;
  throw new Error("storage unavailable");
} });
const failed = new ResourceRequestScope(request());
const unexpectedFirst = failed.read(broken, null);
const unexpectedSecond = failed.read(broken, null);
await assert.rejects(unexpectedFirst, /storage unavailable/u);
await assert.rejects(unexpectedSecond, /storage unavailable/u);
assert.equal(unexpectedLoads, 1, "unexpected failure remains request-local and is not rerun");
assert.equal(classifyResourceFailure(new Error("failure")), "unexpected");
assert.deepEqual(failed.dependencies[0]?.observation, { status: "unexpected-error" });

let recoveryLoads = 0;
const recovering = defineResource({ read: () => {
  recoveryLoads += 1;
  if (recoveryLoads === 1) throw resourceError({ code: "RESOURCE_TEMPORARY", status: 503 });
  return "fresh";
} });
await assert.rejects(new ResourceRequestScope(request()).read(recovering, null), (error: unknown) => readResourceError(error)?.code === "RESOURCE_TEMPORARY");
assert.equal(await new ResourceRequestScope(request()).read(recovering, null), "fresh");
assert.equal(recoveryLoads, 2, "a new request has no stale failure or result artifact");

const cancelledController = new AbortController();
let releaseCancelled: (() => void) | undefined;
const cancellable = defineResource({ read: async () => {
  await new Promise<void>((resolve) => { releaseCancelled = resolve; });
  return "obsolete";
} });
const cancelled = new ResourceRequestScope(request(cancelledController.signal));
const obsolete = cancelled.read(cancellable, null);
cancelledController.abort();
releaseCancelled?.();
await assert.rejects(obsolete, (error: unknown) => {
  assert.equal(classifyResourceFailure(error), "cancelled");
  return true;
});
assert.deepEqual(cancelled.dependencies[0]?.observation, { status: "cancelled" });

assert.doesNotThrow(() => { assertResourceCachePolicy("request"); });
for (const refused of ["shared", "global", "persistent", "none"]) {
  assert.throws(() => { assertResourceCachePolicy(refused); }, /FADENO_RESOURCE_CACHE_POLICY/u);
}

const refusal = new ResourceRequestScope(request());
let getterRan = false;
const accessor = Object.defineProperty({}, "secret", {
  enumerable: true,
  get() { getterRan = true; return "value"; },
});
for (const invalid of [
  undefined,
  1n,
  Symbol("input"),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  new Date(0),
  accessor,
  Object.assign([1], { extra: true }),
  [, 1],
]) await assert.rejects(refusal.read(projects as never, invalid as never), /FADENO_RESOURCE_INPUT/u);
assert.equal(getterRan, false, "input refusal never invokes application accessors");
const cycle: Record<string, unknown> = {};
cycle["cycle"] = cycle;
await assert.rejects(refusal.read(projects as never, cycle as never), /FADENO_RESOURCE_INPUT/u);
await assert.rejects(refusal.read(projects as never, { key: "x".repeat(70 * 1024) } as never), /FADENO_RESOURCE_INPUT_LIMIT/u);
await assert.rejects(refusal.read(projects as never, "x".repeat(70 * 1024) as never), /FADENO_RESOURCE_INPUT_LIMIT/u);
await assert.rejects(refusal.read(projects as never, { ["k".repeat(1_025)]: true } as never), /FADENO_RESOURCE_INPUT_LIMIT/u);
await assert.rejects(refusal.read(projects as never, new Array(4_097).fill(null) as never), /FADENO_RESOURCE_INPUT_LIMIT/u);
await assert.rejects(refusal.read(projects as never, Object.fromEntries(
  Array.from({ length: 4_097 }, (_, index) => [`key-${index}`, null]),
) as never), /FADENO_RESOURCE_INPUT_LIMIT/u);
assert.equal(refusal.dependencies.length, 0, "refused input records no dependency or cache entry");
await assert.rejects(refusal.read({ declaration: {}, read: () => "counterfeit" } as never, null), /FADENO_RESOURCE_DECLARATION/u);
assert.throws(() => resourceError({ code: "lowercase", status: 404 }), /FADENO_RESOURCE_EXPECTED_ERROR/u);
assert.throws(() => defineResource({ read: () => "value", extra: true } as never), /FADENO_RESOURCE_DECLARATION/u);
let declarationGetterRan = false;
const declarationAccessor = Object.defineProperty({}, "read", {
  enumerable: true,
  get() { declarationGetterRan = true; return () => "value"; },
});
assert.throws(() => defineResource(declarationAccessor as never), /FADENO_RESOURCE_DECLARATION/u);
assert.equal(declarationGetterRan, false, "declaration refusal does not invoke an accessor");
const proxy = new Proxy({}, { ownKeys() { return []; } });
await assert.rejects(refusal.read(projects as never, proxy as never), /FADENO_RESOURCE_INPUT/u);
const hiddenSymbol = Symbol("hidden");
const originalInput: Record<string | symbol, unknown> = { visible: "captured" };
Object.defineProperty(originalInput, "hidden", { value: "not-keyed", enumerable: false });
originalInput[hiddenSymbol] = "not-keyed";
let releaseSnapshot: (() => void) | undefined;
const snapshotResource = defineResource({ read: async ({ input }: { input: Readonly<{ visible: string }> }) => {
  await new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  return {
    frozen: Object.isFrozen(input),
    hidden: Object.hasOwn(input, "hidden"),
    symbols: Object.getOwnPropertySymbols(input).length,
    visible: input.visible,
  };
} });
const snapshotRead = new ResourceRequestScope(request()).read(snapshotResource, originalInput as never);
originalInput["visible"] = "mutated";
releaseSnapshot?.();
assert.deepEqual(await snapshotRead, { frozen: true, hidden: false, symbols: 0, visible: "captured" });

const boundedReads = new ResourceRequestScope(request());
const boundedResource = defineResource({ read: ({ input }: { input: number }) => input });
for (let index = 0; index < 1_024; index += 1) assert.equal(await boundedReads.read(boundedResource, index), index);
await assert.rejects(boundedReads.read(boundedResource, 1_024), /FADENO_RESOURCE_READ_LIMIT/u);
assert.equal(boundedReads.dependencies.length, 1_024);

const boundedCalls = new ResourceRequestScope(request());
for (let index = 0; index < 4_096; index += 1) assert.equal(await boundedCalls.read(boundedResource, 0), 0);
await assert.rejects(boundedCalls.read(boundedResource, 0), /FADENO_RESOURCE_CALL_LIMIT/u);
assert.equal(boundedCalls.flows.length, 4_096, "flow evidence cannot grow past the admitted call budget");

let releaseClosed: (() => void) | undefined;
const closeResource = defineResource({ read: async () => {
  await new Promise<void>((resolve) => { releaseClosed = resolve; });
  return "late";
} });
const closedScope = new ResourceRequestScope(request());
const lateRead = closedScope.read(closeResource, null);
closedScope.close();
releaseClosed?.();
await assert.rejects(lateRead, (error: unknown) => classifyResourceFailure(error) === "cancelled");
assert.equal(closedScope.closed, true);
assert.deepEqual(closedScope.dependencies, [], "close releases dependency inputs and observations");
assert.deepEqual(closedScope.flows, [], "close releases flow evidence");
await assert.rejects(closedScope.read(closeResource, null), /FADENO_RESOURCE_SCOPE_CLOSED/u);

const flowInspection = {
  operation: "resource-decision",
  ownership: "request",
  decisions: {
    equivalentInput: "deduplicated",
    distinctInput: "executed",
    authorizationPartition: "isolated-by-request",
    sharedCache: "refused",
    expectedFailure: "cached-within-request",
    unexpectedFailure: "cached-within-request",
    staleFailure: "absent-from-next-request",
  },
  success: success.flows,
  failure: tenantB.flows,
  refusal: refusal.flows,
};
assert.equal(JSON.stringify(flowInspection).includes("Bearer"), false);
assert.deepEqual(flowInspection.decisions, {
  equivalentInput: "deduplicated",
  distinctInput: "executed",
  authorizationPartition: "isolated-by-request",
  sharedCache: "refused",
  expectedFailure: "cached-within-request",
  unexpectedFailure: "cached-within-request",
  staleFailure: "absent-from-next-request",
});

console.log("V1 resource decision passed (equivalent/distinct, concurrency, isolation, failure, refusal, cancellation, flow, recovery)");
