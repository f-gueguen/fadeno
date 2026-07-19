import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decidePrivateScrollBoundary,
  evaluatePrivateUpdate,
  parseV2PatchProtocolCorpus,
  runV2PatchProtocolFixture,
  V2_PATCH_PROTOCOL_LIMITS,
  withinPrivateUpdateFieldLimit,
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
rejects((value) => {
  value["cases"] = (value["cases"] as Record<string, unknown>[]).filter((fixture) => fixture["id"] !== "credential-redirect-refused");
}, /required case IDs/u);

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
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidContext = { ...context, boundary: { ...context.boundary, [key]: invalid } };
    assert.equal(evaluatePrivateUpdate(envelope, invalidContext).code, "FADENO_UPDATE_LIMIT", `${key} invalid ${String(invalid)}`);
  }
}

const encodedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const withMeasuredBytes = (base: PrivateUpdateDecisionContext, value: unknown): PrivateUpdateDecisionContext => ({
  ...base,
  boundary: { ...base.boundary, bytes: encodedBytes(value) },
});

const fieldCases = [
  {
    field: "identity",
    label: "identity",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumIdentityBytes,
    sample: (size: number) => "a".repeat(size),
    set: (value: Record<string, unknown>, sample: string) => { value["resultId"] = sample; },
  },
  {
    field: "url",
    label: "URL",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumUrlBytes,
    sample: (size: number) => `/${"a".repeat(size - 1)}`,
    set: (value: Record<string, unknown>, sample: string) => {
      (value["outcome"] as Record<string, unknown>)["url"] = sample;
    },
  },
  {
    field: "title",
    label: "title",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumTitleBytes,
    sample: (size: number) => "a".repeat(size),
    set: (value: Record<string, unknown>, sample: string) => {
      (value["outcome"] as Record<string, unknown>)["title"] = sample;
    },
  },
  {
    field: "html",
    label: "HTML",
    maximum: V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes,
    sample: (size: number) => "a".repeat(size),
    set: (value: Record<string, unknown>, sample: string) => {
      ((value["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>)["html"] = sample;
    },
  },
] as const;
for (const fieldCase of fieldCases) {
  const inclusiveSample = fieldCase.sample(fieldCase.maximum);
  const exceededSample = fieldCase.sample(fieldCase.maximum + 1);
  assert.equal(withinPrivateUpdateFieldLimit(fieldCase.field, inclusiveSample), true, `${fieldCase.label} field inclusive limit`);
  assert.equal(withinPrivateUpdateFieldLimit(fieldCase.field, exceededSample), false, `${fieldCase.label} field over limit`);
  if (fieldCase.field === "html") continue;

  const inclusive = structuredClone(envelope);
  fieldCase.set(inclusive, inclusiveSample);
  const inclusiveBase = fieldCase.field === "url"
    ? { ...context, currentOperation: { ...context.currentOperation, url: inclusiveSample } }
    : context;
  assert.equal(evaluatePrivateUpdate(inclusive, withMeasuredBytes(inclusiveBase, inclusive)).status, "accepted", `${fieldCase.label} inclusive limit`);
  const exceeded = structuredClone(envelope);
  fieldCase.set(exceeded, exceededSample);
  const exceededBase = fieldCase.field === "url"
    ? { ...context, currentOperation: { ...context.currentOperation, url: exceededSample } }
    : context;
  assert.equal(evaluatePrivateUpdate(exceeded, withMeasuredBytes(exceededBase, exceeded)).status, "refused", `${fieldCase.label} over limit`);
}

const htmlFieldMaximum = structuredClone(envelope);
const htmlRoot = (htmlFieldMaximum["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>;
htmlRoot["html"] = "a".repeat(V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes);
const htmlFieldMaximumContext = withMeasuredBytes(context, htmlFieldMaximum);
assert.equal(htmlFieldMaximumContext.boundary.bytes > V2_PATCH_PROTOCOL_LIMITS.maximumBytes, true, "HTML field cap includes envelope overhead");
assert.equal(evaluatePrivateUpdate(htmlFieldMaximum, htmlFieldMaximumContext).code, "FADENO_UPDATE_LIMIT", "aggregate cap precedes an individually valid HTML field");

const aggregateEnvelope = structuredClone(envelope);
const aggregateRoot = (aggregateEnvelope["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>;
aggregateRoot["html"] = "";
const aggregateHtmlBytes = V2_PATCH_PROTOCOL_LIMITS.maximumBytes - encodedBytes(aggregateEnvelope);
aggregateRoot["html"] = "a".repeat(aggregateHtmlBytes);
assert.equal(encodedBytes(aggregateEnvelope), V2_PATCH_PROTOCOL_LIMITS.maximumBytes, "HTML aggregate fixture reaches the exact measured maximum");
assert.equal(evaluatePrivateUpdate(aggregateEnvelope, withMeasuredBytes(context, aggregateEnvelope)).status, "accepted", "HTML aggregate inclusive limit");
aggregateRoot["html"] = "a".repeat(aggregateHtmlBytes + 1);
assert.equal(evaluatePrivateUpdate(aggregateEnvelope, withMeasuredBytes(context, aggregateEnvelope)).code, "FADENO_UPDATE_LIMIT", "HTML aggregate over limit");

for (const origin of ["http://127.0.0.1:4173", "http://localhost:4173", "http://[::1]:4173"]) {
  assert.equal(evaluatePrivateUpdate(envelope, { ...context, origin }).status, "accepted", `${origin} loopback development origin`);
}
assert.equal(evaluatePrivateUpdate(envelope, { ...context, origin: "http://example.test" }).code, "FADENO_UPDATE_URL");
const differentDocument = structuredClone(envelope);
(differentDocument["outcome"] as Record<string, unknown>)["url"] = "/other-route";
assert.equal(evaluatePrivateUpdate(differentDocument, context).code, "FADENO_UPDATE_URL");
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
