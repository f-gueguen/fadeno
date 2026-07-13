import assert from "node:assert/strict";

import {
  Boundary,
  defineResource,
  notFound,
  redirect,
  renderRoute,
  resourceError,
  unsafeHtml,
  type Page,
  type RenderChild,
} from "../packages/framework/src/index.ts";
import { bindRequestFailureObserver, type FrameworkFailureReport } from "../packages/framework/src/internal/failure-observer.ts";
import { createFrameworkExecutableNode } from "../packages/framework/src/internal/render-node.ts";
import { renderDocument } from "../packages/framework/src/internal/renderer.ts";
import { jsx, jsxs } from "../packages/framework/src/jsx-runtime.ts";

function document(child: RenderChild): RenderChild {
  return jsxs("html", {
    lang: "en",
    children: [
      jsx("head", { children: jsx("title", { children: "Renderer proof" }) }),
      jsx("body", { children: jsx("main", { children: child }) }),
    ],
  });
}

async function body(response: Response): Promise<string> {
  return response.text();
}

const request = new Request("https://example.test/hello/Fadeno");
let resourceLoads = 0;
let completedResourceSignal: AbortSignal | undefined;
const greetingResource = defineResource({ read: async ({ input, signal }: { input: Readonly<{ name: string }>; signal: AbortSignal }) => {
  resourceLoads += 1;
  completedResourceSignal = signal;
  return `Hello ${input.name}`;
} });
const resourceResponse = await renderRoute({
  request: new Request("https://example.test/resources"),
  parameters: Object.freeze({}),
  layouts: [],
  page: async ({ read }) => {
    const [firstGreeting, equivalentGreeting] = await Promise.all([
      read(greetingResource, { name: "Fadeno" }),
      read(greetingResource, { name: "Fadeno" }),
    ]);
    assert.equal(firstGreeting, equivalentGreeting);
    return document(jsx("h1", { children: firstGreeting }));
  },
});
assert.equal(resourceLoads, 1);
assert.match(await body(resourceResponse), /Hello Fadeno/u);
assert.equal(completedResourceSignal?.aborted, true, "response completion closes request resource ownership");

let streamedResourceLoads = 0;
const streamedResource = defineResource({ read: async () => {
  streamedResourceLoads += 1;
  return "streamed resource";
} });
const streamedResourceResponse = await renderRoute({
  request: new Request("https://example.test/streamed-resource"),
  parameters: Object.freeze({}),
  layouts: [],
  page: ({ read }) => document(Boundary({
    children: async () => jsx("p", { children: await read(streamedResource, null) }),
    fallback: jsx("p", { children: "resource fallback" }),
  })),
});
assert.match(await body(streamedResourceResponse), /streamed resource/u);
assert.equal(streamedResourceLoads, 1, "the request resource scope remains open through streamed boundary work");

const expectedReports: FrameworkFailureReport[] = [];
const expectedRequest = new Request("https://example.test/resource-missing");
const releaseExpectedObserver = bindRequestFailureObserver(expectedRequest, (report) => { expectedReports.push(report); });
const missingResource = defineResource({ read: () => {
  throw resourceError({ code: "PROJECT_NOT_FOUND", status: 404 });
} });
const expectedResourceFailure = await renderRoute({
  request: expectedRequest,
  parameters: Object.freeze({}),
  layouts: [],
  page: async ({ read }) => document(jsx("p", { children: await read(missingResource, { id: 7 }) })),
  error: ({ resourceError: failure }) => document(jsxs("section", {
    children: [jsx("h1", { children: "Project unavailable" }), jsx("p", { children: `${failure?.code}:${failure?.status}` })],
  })),
});
assert.equal(expectedResourceFailure.status, 404);
assert.match(await body(expectedResourceFailure), /PROJECT_NOT_FOUND:404/u);
assert.deepEqual(expectedReports, [], "expected resource failures do not become internal framework incidents");
releaseExpectedObserver();

const lateExpectedReports: FrameworkFailureReport[] = [];
const lateExpectedRequest = new Request("https://example.test/resource-late");
const releaseLateExpectedObserver = bindRequestFailureObserver(lateExpectedRequest, (report) => { lateExpectedReports.push(report); });
const lateExpected = await renderRoute({
  request: lateExpectedRequest,
  parameters: Object.freeze({}),
  layouts: [],
  page: ({ read }) => document(jsx(async () => {
    await read(missingResource, { id: 8 });
    return jsx("p", { children: "unreachable" });
  }, {})),
});
assert.equal(lateExpected.status, 200, "an already-published head cannot change status");
await assert.rejects(body(lateExpected), /FADENO_RENDER_STREAM_LATE_EXPECTED/u);
assert.deepEqual(lateExpectedReports, [], "late expected resource failure terminates without an internal incident");
releaseLateExpectedObserver();

const success = await renderRoute({
  request,
  parameters: Object.freeze({ name: "Fadeno" }),
  layouts: [],
  page: () => document(jsxs("section", {
    children: [
      jsx("h1", { children: "Hello <world>" }),
      jsx("a", { href: "/next?value=<unsafe>", children: "Continue" }),
      unsafeHtml("<strong data-reviewed=\"true\">reviewed</strong>", { reason: "Static reviewed renderer fixture" }),
    ],
  })),
});
assert.equal(success.status, 200);
assert.equal(success.headers.get("content-type"), "text/html; charset=utf-8");
assert.match(success.headers.get("content-security-policy") ?? "", /script-src 'none'/u);
assert.doesNotMatch(success.headers.get("content-security-policy") ?? "", /nonce-/u);
assert.equal(
  await body(success),
  '<!doctype html><html lang="en"><head><title>Renderer proof</title></head><body><main><section><h1>Hello &lt;world&gt;</h1><a href="/next?value=&lt;unsafe&gt;">Continue</a><strong data-reviewed="true">reviewed</strong></section></main></body></html>',
);

const missing = await renderRoute({
  request,
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  layouts: [],
  page: () => notFound(),
  notFound: () => document(jsx("h1", { children: "Deliberate missing page" })),
});
assert.equal(missing.status, 404);
assert.match(await body(missing), /Deliberate missing page/u);

const moved = await renderRoute({
  request,
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  layouts: [],
  page: () => redirect("/moved?from=renderer"),
});
assert.equal(moved.status, 303);
assert.equal(moved.headers.get("location"), "/moved?from=renderer");

const failed = await renderRoute({
  request,
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  layouts: [],
  page: () => { throw new Error("secret=must-not-render"); },
  error: ({ incidentId }) => document(jsxs("section", {
    children: [jsx("h1", { children: "Safe failure" }), jsx("p", { children: `Incident ${incidentId}` })],
  })),
});
assert.equal(failed.status, 500);
const failedBody = await body(failed);
assert.match(failedBody, /Safe failure/u);
assert.doesNotMatch(failedBody, /must-not-render/u);

const boundary = await renderRoute({
  request,
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  layouts: [],
  page: () => document(jsxs("section", {
    children: [
      jsx("p", { children: "before" }),
      Boundary({
        children: async () => { throw new Error("boundary failure"); },
        fallback: jsx("p", { children: "local fallback" }),
        timeoutMilliseconds: 100,
      }),
      jsx("p", { children: "after" }),
    ],
  })),
});
assert.match(await body(boundary), /before<\/p><p>local fallback<\/p><p>after/u);

const asyncPage: Page = () => document(jsxs("section", {
  children: [
    jsx("p", { children: "first" }),
    jsx(async () => jsx("p", { children: "second" }), {}),
    jsx("p", { children: "third" }),
  ],
}));
const ordered = await renderRoute({ request, parameters: Object.freeze({}), layouts: [], page: asyncPage });
assert.match(await body(ordered), /first<\/p><p>second<\/p><p>third/u);

assert.throws(() => jsx("div", { onclick: "bad" }), /FADENO_RENDER_EVENT_ATTRIBUTE/u);
assert.throws(() => jsx("svg", {}), /FADENO_RENDER_FOREIGN_CONTENT/u);
assert.throws(() => jsx("img", { children: "bad" }), /FADENO_RENDER_VOID_CHILDREN/u);
const unsafeUrl = await renderRoute({
  request,
  parameters: Object.freeze({}),
  layouts: [],
  page: () => document(jsx("a", { href: "javascript:bad()", children: "bad" })),
});
await assert.rejects(body(unsafeUrl), /FADENO_RENDER_STREAM_LATE_UNEXPECTED/u);

const executable = renderDocument(
  document(createFrameworkExecutableNode("globalThis.__fadenoRendererProof = true;")),
  { request, frameworkExecutable: true },
);
const policy = executable.headers.get("content-security-policy") ?? "";
const nonce = /script-src 'nonce-([^']+)'/u.exec(policy)?.[1];
assert.ok(nonce);
assert.match(await body(executable), new RegExp(`<script nonce="${nonce}">`, "u"));

console.log("V1 renderer passed (document, sinks, outcomes, boundaries, streaming, CSP correlation)");
