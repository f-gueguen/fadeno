import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decidePrivateScrollBoundary,
  evaluatePrivateUpdate,
  parseV2PatchProtocolCorpus,
  runV2PatchProtocolFixture,
  V2_PATCH_PROTOCOL_LIMITS,
} from "./lib/v2-patch-protocol.ts";
import type { PrivateUpdateDecisionContext } from "./lib/v2-patch-protocol.ts";

const source = JSON.parse(readFileSync(join(process.cwd(), "fixtures/v2-patch-protocol/decision-corpus.v1.json"), "utf8")) as Record<string, unknown>;
const corpus = parseV2PatchProtocolCorpus(source);

function rejects(mutate: (value: Record<string, unknown>) => void, pattern: RegExp): void {
  const value = structuredClone(source);
  mutate(value);
  assert.throws(() => parseV2PatchProtocolCorpus(value), pattern);
}

rejects((value) => { value["schemaVersion"] = 2; }, /FADENO_V2_FIXTURE_VERSION/u);
rejects((value) => { value["extra"] = true; }, /corpus keys/u);
rejects((value) => { delete value["baseEnvelope"]; }, /corpus keys/u);
rejects((value) => {
  const cases = value["cases"] as Record<string, unknown>[];
  if (cases[1]) cases[1]["id"] = cases[0]?.["id"];
}, /case 1 id/u);
rejects((value) => {
  const cases = value["cases"] as Record<string, unknown>[];
  const first = cases[0];
  if (first) first["extra"] = true;
}, /case 0 keys/u);
rejects((value) => {
  const cases = value["cases"] as Record<string, unknown>[];
  const first = cases[0];
  if (first) (first["expected"] as Record<string, unknown>)["mutationResubmission"] = "retry";
}, /mutation resubmission/u);
rejects((value) => {
  const cases = value["cases"] as Record<string, unknown>[];
  const first = cases[0];
  if (first) first["changes"] = [{ target: "envelope", operation: "delete", path: [] }];
}, /case document-accepted path/u);

for (const fixture of corpus.cases) assert.deepEqual(runV2PatchProtocolFixture(corpus, fixture), fixture.expected);
assert.deepEqual(decidePrivateScrollBoundary({ documentPrecedingLayout: "unaffected", elementPrecedingLayout: "unaffected" }), {
  decision: "apply", code: "FADENO_UPDATE_SCROLL_SAFE", cause: "proven-unaffected",
});
for (const input of [
  { documentPrecedingLayout: "affected", elementPrecedingLayout: "unaffected" },
  { documentPrecedingLayout: "unaffected", elementPrecedingLayout: "affected" },
  { documentPrecedingLayout: "unknown", elementPrecedingLayout: "unaffected" },
] as const) assert.equal(decidePrivateScrollBoundary(input).decision, "refuse");

const context = structuredClone(corpus.baseContext);
const envelope = structuredClone(corpus.baseEnvelope);
for (const [key, maximum] of [
  ["bytes", V2_PATCH_PROTOCOL_LIMITS.maximumBytes],
  ["records", V2_PATCH_PROTOCOL_LIMITS.maximumRecords],
  ["depth", V2_PATCH_PROTOCOL_LIMITS.maximumDepth],
  ["durationMilliseconds", V2_PATCH_PROTOCOL_LIMITS.maximumDurationMilliseconds],
] as const) {
  const acceptedContext: PrivateUpdateDecisionContext = { ...context, boundary: { ...context.boundary, [key]: maximum } };
  assert.equal(evaluatePrivateUpdate(envelope, acceptedContext).status, "accepted", `${key} inclusive limit`);
  const refusedContext: PrivateUpdateDecisionContext = { ...context, boundary: { ...context.boundary, [key]: maximum + 1 } };
  assert.equal(evaluatePrivateUpdate(envelope, refusedContext).status, "refused", `${key} over limit`);
}

const boundaryCases = [
  {
    label: "identity",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumIdentityBytes,
    set: (value: Record<string, unknown>, size: number) => { value["resultId"] = "a".repeat(size); },
  },
  {
    label: "URL",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumUrlBytes,
    set: (value: Record<string, unknown>, size: number) => {
      (value["outcome"] as Record<string, unknown>)["url"] = `/${"a".repeat(size - 1)}`;
    },
  },
  {
    label: "title",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumTitleBytes,
    set: (value: Record<string, unknown>, size: number) => {
      (value["outcome"] as Record<string, unknown>)["title"] = "a".repeat(size);
    },
  },
  {
    label: "HTML",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes,
    set: (value: Record<string, unknown>, size: number) => {
      ((value["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>)["html"] = "a".repeat(size);
    },
  },
] as const;
for (const boundaryCase of boundaryCases) {
  const inclusive = structuredClone(envelope);
  boundaryCase.set(inclusive, boundaryCase.maximum);
  assert.equal(evaluatePrivateUpdate(inclusive, context).status, "accepted", `${boundaryCase.label} inclusive limit`);
  const exceeded = structuredClone(envelope);
  boundaryCase.set(exceeded, boundaryCase.maximum + 1);
  assert.equal(evaluatePrivateUpdate(exceeded, context).status, "refused", `${boundaryCase.label} over limit`);
}

for (const origin of ["http://127.0.0.1:4173", "http://localhost:4173", "http://[::1]:4173"]) {
  assert.equal(evaluatePrivateUpdate(envelope, { ...context, origin }).status, "accepted", `${origin} loopback development origin`);
}
assert.equal(evaluatePrivateUpdate(envelope, { ...context, origin: "http://example.test" }).code, "FADENO_UPDATE_URL");
assert.equal(evaluatePrivateUpdate(envelope, { ...context, transport: { ...context.transport, requestCache: "default" } }).code, "FADENO_UPDATE_CACHE");
assert.equal(evaluatePrivateUpdate(envelope, { ...context, transport: { ...context.transport, responseCacheControl: null } }).code, "FADENO_UPDATE_CACHE");
assert.equal(evaluatePrivateUpdate(envelope, { ...context, transport: { ...context.transport, responseCacheControl: 'private="foo,no-store,bar", max-age=3600' } }).code, "FADENO_UPDATE_CACHE");
assert.equal(evaluatePrivateUpdate(envelope, { ...context, transport: { ...context.transport, responseCacheControl: 'private="foo,bar", no-store' } }).status, "accepted");

let getterRan = false;
const accessor = Object.defineProperty({}, "protocol", { enumerable: true, get() { getterRan = true; return "fadeno.private.update"; } });
assert.equal(evaluatePrivateUpdate(accessor, context).code, "FADENO_UPDATE_SCHEMA");
assert.equal(getterRan, false, "untrusted accessors are not invoked");
assert.equal(evaluatePrivateUpdate(new Date(), context).code, "FADENO_UPDATE_SCHEMA");
assert.equal(evaluatePrivateUpdate(Object.assign([], { protocol: "fadeno.private.update" }), context).code, "FADENO_UPDATE_SCHEMA");

const sensitive = structuredClone(envelope);
(sensitive["outcome"] as Record<string, unknown>)["root"] = { identity: "route:projects:index", html: "<main>Bearer secret-cookie private-field</main>" };
assert.equal(JSON.stringify(evaluatePrivateUpdate(sensitive, context)).includes("secret-cookie"), false);
assert.deepEqual(parseV2PatchProtocolCorpus(JSON.parse(JSON.stringify(source))), corpus, "decision fixtures round trip without losing evidence");

console.log("V2 patch-protocol mutation tests passed (fixture schema, boundaries, scroll refusal, redaction, and round trip)");
