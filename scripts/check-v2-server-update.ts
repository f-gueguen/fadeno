import assert from "node:assert/strict";

import {
  actionError,
  defineAction,
  defineResource,
  renderRoute,
  textField,
} from "../packages/framework/dist/index.js";
import { ActionServerRuntime } from "../packages/framework/dist/internal/action-server.js";
import {
  evaluatePrivateUpdateBytes,
  V2_PATCH_PROTOCOL_LIMITS,
} from "../packages/framework/dist/internal/browser-update.js";
import {
  attachPrivateServerUpdateActionEvidence,
  attachPrivateServerUpdateRouteEvidence,
  bindPrivateServerUpdateOperation,
  createPrivateServerUpdateOperation,
  deserializePrivateServerUpdateRecord,
  projectPrivateServerUpdate,
  serializePrivateServerUpdateRecord,
  type PrivateServerUpdateOperation,
} from "../packages/framework/dist/internal/server-update.js";
import { jsx, jsxs } from "../packages/framework/dist/jsx-runtime.js";

const html = "<!doctype html><html><head><title>Active &amp; safe</title></head><body><main><h1>Active projects</h1></main></body></html>";
const authorizationOwner = Object.freeze({});

function operation(overrides: Partial<PrivateServerUpdateOperation> = {}): PrivateServerUpdateOperation {
  return createPrivateServerUpdateOperation({
    origin: "https://example.test",
    currentTruthUrl: "/projects?view=active",
    applicationGeneration: "generation-7",
    documentEpoch: "document-3",
    operation: Object.freeze({ id: "operation-9", sequence: 9, kind: "navigation", url: "/projects?view=active" }),
    resultId: "result-10",
    scrollBoundary: Object.freeze({ documentPrecedingLayout: "unaffected", elementPrecedingLayout: "unaffected" }),
    authorizationOwner,
    ...overrides,
  });
}

function responseFor(
  authority: PrivateServerUpdateOperation,
  input: Readonly<{
    body?: string | null;
    status?: number;
    headers?: HeadersInit;
    outcome?: "document" | "not-found" | "expected-error" | "redirect" | "unexpected-error";
    expectedCode?: string;
  }> = {},
): Readonly<{ request: Request; response: Response }> {
  const request = new Request(`${authority.origin}${authority.operation.url}`);
  const release = bindPrivateServerUpdateOperation(request, authority);
  const response = new Response(input.body === null ? null : input.body ?? html, {
    status: input.status ?? 200,
    headers: input.headers ?? { "content-type": "text/html; charset=utf-8" },
  });
  attachPrivateServerUpdateRouteEvidence(response, request, {
    routeId: "route:projects:index",
    generation: authority.applicationGeneration,
    outcome: input.outcome ?? "document",
    ...(input.expectedCode ? { expectedCode: input.expectedCode } : {}),
    resources: () => Object.freeze([Object.freeze({
      operation: "resource-read" as const,
      outcome: "value" as const,
      cache: "miss" as const,
      ownership: "request" as const,
      dependencyRecorded: true,
      cause: "loader-complete",
    })]),
  });
  release();
  return Object.freeze({ request, response });
}

const successfulOperation = operation();
const successful = await projectPrivateServerUpdate(responseFor(successfulOperation).response, successfulOperation);
assert.equal(successful.status, "projected", JSON.stringify(successful.record));
if (successful.status !== "projected") throw new Error("successful projection refused");
const envelope = JSON.parse(new TextDecoder().decode(successful.bytes)) as Record<string, unknown>;
assert.deepEqual(envelope["operation"], {
  id: successfulOperation.operation.id,
  sequence: successfulOperation.operation.sequence,
  kind: successfulOperation.operation.kind,
});
assert.equal((envelope["outcome"] as Record<string, unknown>)["title"], "Active & safe");
assert.equal(((envelope["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>)["html"], html);
assert.equal(JSON.stringify(successful.record).includes("<main>"), false);
assert.equal(JSON.stringify(successful.record).includes("authorizationOwner"), false);
assert.deepEqual(
  deserializePrivateServerUpdateRecord(serializePrivateServerUpdateRecord(successful.record)),
  successful.record,
);
const admitted = evaluatePrivateUpdateBytes(successful.bytes, {
  origin: successfulOperation.origin,
  currentTruthUrl: successfulOperation.currentTruthUrl,
  transport: Object.freeze({ requestCache: "no-store", responseCacheControl: "private, no-store" }),
  generation: successfulOperation.applicationGeneration,
  documentEpoch: successfulOperation.documentEpoch,
  currentOperation: successfulOperation.operation,
  consumedResultIds: Object.freeze([]),
  requestCommitted: false,
});
assert.deepEqual(admitted.decision, {
  status: "accepted",
  code: "FADENO_UPDATE_DOCUMENT",
  outcome: "document",
  recovery: "none",
  mutationResubmission: "never",
});

let pageRuns = 0;
let resourceRuns = 0;
const projects = defineResource({
  read: () => {
    resourceRuns += 1;
    return Object.freeze(["Alpha", "Beta"]);
  },
});
const routeOperation = operation({ resultId: "result-real-route" });
const routeRequest = new Request(`${routeOperation.origin}${routeOperation.operation.url}`);
const routeRelease = bindPrivateServerUpdateOperation(routeRequest, routeOperation);
const routeResponse = await renderRoute({
  request: routeRequest,
  routeId: "route:projects:index",
  generation: routeOperation.applicationGeneration,
  parameters: Object.freeze({}),
  layouts: [],
  page: async (context) => {
    pageRuns += 1;
    const values = await context.read(projects, Object.freeze({ view: "active" }));
    return jsxs("html", { children: [
      jsx("head", { children: jsx("title", { children: "Active projects" }) }),
      jsx("body", { children: jsx("main", { children: values.join(", ") }) }),
    ] });
  },
});
routeRelease();
const routeProjection = await projectPrivateServerUpdate(routeResponse, routeOperation);
assert.equal(routeProjection.status, "projected");
assert.equal(pageRuns, 1, "projection must not execute the page again");
assert.equal(resourceRuns, 1, "projection must not execute a resource again");
assert.deepEqual(routeProjection.record.provenance.resources, [
  {
    operation: "resource-read",
    outcome: "value",
    cache: "miss",
    ownership: "request",
    dependencyRecorded: true,
    cause: "loader-completed",
  },
]);

let actionRuns = 0;
let actionPageRuns = 0;
const renameProject = defineAction({
  fields: { title: textField({ maximumBytes: 64 }) },
  authorize: () => true,
  run: ({ input }) => {
    actionRuns += 1;
    if (input.title === null || input.title.trim() === "") {
      throw actionError({
        code: "PROJECT_TITLE_REQUIRED",
        fieldErrors: { title: "Enter a project title." },
        formErrors: ["The project was not renamed."],
      });
    }
  },
});
const actionRuntime = new ActionServerRuntime({
  canonicalOrigin: "https://example.test",
  generation: "generation-7",
  sessionKeys: `active:${Buffer.alloc(32, 11).toString("base64url")}`,
});
const invokeActionPage = (request: Request) => renderRoute({
  request,
  routeId: "route:projects:index",
  generation: "generation-7",
  parameters: Object.freeze({}),
  layouts: [],
  page: () => {
    actionPageRuns += 1;
    return jsxs("html", { children: [
      jsx("head", { children: jsx("title", { children: "Rename project" }) }),
      jsx("body", { children: jsx("form", {
        action: renameProject,
        children: [
          jsx("input", { id: "rename-title", name: renameProject.fields.title }),
          jsx("button", { type: "submit", children: "Rename" }),
        ],
      }) }),
    ] });
  },
});
const actionPage = await actionRuntime.serve(
  new Request("https://example.test/projects"),
  invokeActionPage,
);
const actionCookie = actionPage.headers.getSetCookie()[0]?.split(";", 1)[0];
assert.ok(actionCookie);
const actionHtml = await actionPage.text();
const actionLocation = /<form[^>]* action="([^"]+)"/u.exec(actionHtml)?.[1]?.replaceAll("&amp;", "&");
const actionProof = /<input type="hidden" name="__fadeno_proof" value="([^"]+)">/u.exec(actionHtml)?.[1];
const actionTitle = /<input[^>]*id="rename-title"[^>]*>/u.exec(actionHtml)?.[0];
const actionTitleName = actionTitle ? / name="([^"]+)"/u.exec(actionTitle)?.[1] : undefined;
assert.ok(actionLocation);
assert.ok(actionProof);
assert.ok(actionTitleName);
const mutationOperation = operation({
  currentTruthUrl: "/projects",
  operation: Object.freeze({ id: "operation-action", sequence: 10, kind: "mutation", url: "/projects" }),
  resultId: "result-real-action",
});
const actionRequest = new Request(new URL(actionLocation, mutationOperation.origin), {
  method: "POST",
  headers: {
    cookie: actionCookie,
    "content-type": "application/x-www-form-urlencoded",
    origin: mutationOperation.origin,
  },
  body: new URLSearchParams({
    __fadeno_proof: actionProof,
    [actionTitleName]: "",
  }),
});
const actionRelease = bindPrivateServerUpdateOperation(actionRequest, mutationOperation);
const actionResponse = await actionRuntime.serve(actionRequest, invokeActionPage);
actionRelease();
const actionProjection = await projectPrivateServerUpdate(actionResponse, mutationOperation);
assert.equal(actionProjection.status, "projected");
assert.equal(actionRuns, 1, "projection must not execute the action again");
assert.equal(actionPageRuns, 2, "projection must not render the recovery page again");
assert.deepEqual(actionProjection.record.provenance.action, {
  code: "PROJECT_TITLE_REQUIRED",
  status: "expected-failure",
  revalidation: "none",
  outcome: "expected-failure",
});
assert.equal(actionProjection.record.provenance.route?.id, "route:projects:index");
assert.equal(JSON.stringify(actionProjection.record).includes(actionProof), false);
assert.equal(JSON.stringify(actionProjection.record).includes(actionCookie), false);

const expectedOperation = operation({ resultId: "result-expected" });
const expectedPair = responseFor(expectedOperation, { status: 409 });
const expectedRequestRelease = bindPrivateServerUpdateOperation(expectedPair.request, expectedOperation);
attachPrivateServerUpdateActionEvidence(expectedPair.response, expectedPair.request, {
  code: "PROJECT_CONFLICT",
  status: "expected-failure",
  revalidation: "complete",
  outcome: "validation-returned",
});
expectedRequestRelease();
const expected = await projectPrivateServerUpdate(expectedPair.response, expectedOperation);
assert.equal(expected.status, "projected");
if (expected.status !== "projected") throw new Error("expected failure projection refused");
assert.equal((JSON.parse(new TextDecoder().decode(expected.bytes)) as { outcome: { kind: string; code: string } }).outcome.kind, "expected-error");
assert.equal((JSON.parse(new TextDecoder().decode(expected.bytes)) as { outcome: { kind: string; code: string } }).outcome.code, "PROJECT_CONFLICT");

const redirectOperation = operation({ resultId: "result-redirect" });
const redirect = await projectPrivateServerUpdate(responseFor(redirectOperation, {
  body: null,
  status: 307,
  headers: { location: "/projects/7" },
  outcome: "redirect",
}).response, redirectOperation);
assert.equal(redirect.status, "projected");
if (redirect.status !== "projected") throw new Error("redirect projection refused");
assert.equal((JSON.parse(new TextDecoder().decode(redirect.bytes)) as { outcome: { kind: string; location: string } }).outcome.location, "/projects/7");

const recoveryOperation = operation({ resultId: "result-recovery" });
const recovery = await projectPrivateServerUpdate(responseFor(recoveryOperation, {
  status: 500,
  outcome: "unexpected-error",
}).response, recoveryOperation);
assert.equal(recovery.status, "projected");
if (recovery.status !== "projected") throw new Error("recovery projection refused");
assert.equal((JSON.parse(new TextDecoder().decode(recovery.bytes)) as { outcome: { kind: string } }).outcome.kind, "recover");

const ownedOperation = operation({ resultId: "result-owned" });
const otherOperation = operation({
  resultId: "result-other",
  authorizationOwner: Object.freeze({}),
});
const crossUser = await projectPrivateServerUpdate(responseFor(ownedOperation).response, otherOperation);
assert.equal(crossUser.status, "refused");
if (crossUser.status !== "refused") throw new Error("cross-user projection was accepted");
assert.equal(crossUser.code, "FADENO_UPDATE_PROJECTION_OWNERSHIP");
assert.equal(JSON.stringify(crossUser.record).includes("result-owned"), false);

const forgedSecret = "private-forged-operation";
const forged = await projectPrivateServerUpdate(
  new Response(html, { headers: { "content-type": "text/html" } }),
  { ...ownedOperation, operation: { ...ownedOperation.operation, id: forgedSecret } } as PrivateServerUpdateOperation,
);
assert.equal(forged.status, "refused");
assert.equal(forged.code, "FADENO_UPDATE_PROJECTION_AUTHORITY");
assert.equal(JSON.stringify(forged.record).includes(forgedSecret), false);

const refusedOperation = operation({ resultId: "result-refused" });
const refusedPair = responseFor(refusedOperation, { status: 403 });
const refusedRelease = bindPrivateServerUpdateOperation(refusedPair.request, refusedOperation);
attachPrivateServerUpdateActionEvidence(refusedPair.response, refusedPair.request, {
  code: "FADENO_ACTION_AUTHORIZATION",
  status: "refused",
  revalidation: "none",
  outcome: "authorization-refused",
});
refusedRelease();
const authorizationRefusal = await projectPrivateServerUpdate(refusedPair.response, refusedOperation);
assert.equal(authorizationRefusal.status, "refused");
if (authorizationRefusal.status !== "refused") throw new Error("authorization refusal projected");
assert.equal(authorizationRefusal.code, "FADENO_UPDATE_PROJECTION_AUTHORIZATION");

const cancelledOperation = operation({ resultId: "result-cancelled" });
const cancellation = new AbortController();
cancellation.abort();
const cancelled = await projectPrivateServerUpdate(responseFor(cancelledOperation).response, cancelledOperation, { signal: cancellation.signal });
assert.equal(cancelled.status, "refused");
if (cancelled.status !== "refused") throw new Error("cancelled projection completed");
assert.equal(cancelled.code, "FADENO_UPDATE_PROJECTION_CANCELLED");

const oversizedOperation = operation({ resultId: "result-oversized" });
const oversized = await projectPrivateServerUpdate(responseFor(oversizedOperation, {
  body: "x".repeat(V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes + 1),
}).response, oversizedOperation);
assert.equal(oversized.status, "refused");
if (oversized.status !== "refused") throw new Error("oversized projection completed");
assert.equal(oversized.code, "FADENO_UPDATE_PROJECTION_BODY");

const invalidRecord = JSON.parse(new TextDecoder().decode(serializePrivateServerUpdateRecord(successful.record))) as Record<string, unknown>;
invalidRecord["markup"] = "<secret>";
assert.throws(
  () => deserializePrivateServerUpdateRecord(new TextEncoder().encode(JSON.stringify(invalidRecord))),
  /FADENO_UPDATE_PROJECTION_RECORD/u,
);

console.log("V2 server update projection passed (document, error, redirect, recovery, isolation, bounds, redaction, round trip)");
