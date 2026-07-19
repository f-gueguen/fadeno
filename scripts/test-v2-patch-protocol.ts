import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decidePrivateScrollBoundary,
  encodePrivateUpdateEnvelope,
  evaluatePrivateUpdate,
  evaluatePrivateUpdateBytes,
  parseV2PatchProtocolCorpus,
  runV2PatchProtocolFixture,
  V2_PATCH_PROTOCOL_LIMITS,
  withinPrivateUpdateFieldLimit,
} from "./lib/v2-patch-protocol.ts";
import { assertV2PatchProtocolCaseSemantics } from "./lib/v2-patch-protocol-evidence.ts";
import type { PrivateUpdateDecisionContext } from "./lib/v2-patch-protocol.ts";

const source = JSON.parse(readFileSync(join(process.cwd(), "fixtures/v2-patch-protocol/decision-corpus.v1.json"), "utf8")) as Record<string, unknown>;
const corpus = parseV2PatchProtocolCorpus(source);
assert.doesNotThrow(() => assertV2PatchProtocolCaseSemantics(corpus.cases));

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

const weakened = structuredClone(source);
const weakenedCredential = (weakened["cases"] as Record<string, unknown>[])
  .find((fixture) => fixture["id"] === "credential-redirect-refused");
assert.ok(weakenedCredential);
weakenedCredential["changes"] = [
  { target: "envelope", operation: "set", path: ["outcome"], value: { kind: "redirect", status: 307, location: "/projects/7" } },
];
weakenedCredential["expected"] = { status: "accepted", code: "FADENO_UPDATE_REDIRECT", outcome: "redirect", recovery: "none", mutationResubmission: "never" };
const weakenedCorpus = parseV2PatchProtocolCorpus(weakened);
assert.throws(() => assertV2PatchProtocolCaseSemantics(weakenedCorpus.cases), /FADENO_V2_FIXTURE_SEMANTICS/u);

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

const { boundary: _fixtureBoundary, ...byteContext } = structuredClone(corpus.baseContext);
const encodedEnvelope = encodePrivateUpdateEnvelope(corpus.baseEnvelope);
const decodedEnvelope = evaluatePrivateUpdateBytes(encodedEnvelope, byteContext, { now: () => 10 });
assert.equal(decodedEnvelope.decision.status, "accepted");
assert.equal(decodedEnvelope.boundary.bytes, encodedEnvelope.byteLength);
assert.equal(decodedEnvelope.boundary.records > 0, true);
assert.equal(decodedEnvelope.boundary.depth > 0, true);
assert.equal(decodedEnvelope.boundary.durationMilliseconds, 0);

assert.equal(
  evaluatePrivateUpdateBytes(new Uint8Array([0xc3, 0x28]), byteContext, { now: () => 10 }).decision.code,
  "FADENO_UPDATE_SCHEMA",
  "invalid UTF-8 is refused before schema use",
);
assert.equal(
  evaluatePrivateUpdateBytes(new TextEncoder().encode("{not-json}"), byteContext, { now: () => 10 }).decision.code,
  "FADENO_UPDATE_SCHEMA",
  "malformed JSON is refused",
);
assert.equal(
  evaluatePrivateUpdateBytes(new Uint8Array(V2_PATCH_PROTOCOL_LIMITS.maximumBytes + 1), byteContext, { now: () => 10 }).decision.code,
  "FADENO_UPDATE_LIMIT",
  "raw bytes are measured before decoding",
);

let deepValue: unknown = null;
for (let index = 0; index < V2_PATCH_PROTOCOL_LIMITS.maximumDepth; index += 1) deepValue = { child: deepValue };
assert.equal(
  evaluatePrivateUpdateBytes(new TextEncoder().encode(JSON.stringify(deepValue)), byteContext, { now: () => 10 }).decision.code,
  "FADENO_UPDATE_LIMIT",
  "parsed depth is measured independently",
);
const manyRecords = Array.from({ length: V2_PATCH_PROTOCOL_LIMITS.maximumRecords }, () => null);
assert.equal(
  evaluatePrivateUpdateBytes(new TextEncoder().encode(JSON.stringify(manyRecords)), byteContext, { now: () => 10 }).decision.code,
  "FADENO_UPDATE_LIMIT",
  "parsed record count is measured independently",
);

const clock = [0, V2_PATCH_PROTOCOL_LIMITS.maximumDurationMilliseconds + 1];
assert.equal(
  evaluatePrivateUpdateBytes(encodedEnvelope, byteContext, { now: () => clock.shift() ?? 0 }).decision.code,
  "FADENO_UPDATE_TIMEOUT",
  "elapsed decoder work is measured independently",
);
const cancellation = new AbortController();
cancellation.abort("superseded");
assert.equal(
  evaluatePrivateUpdateBytes(encodedEnvelope, byteContext, { signal: cancellation.signal, now: () => 10 }).decision.code,
  "FADENO_UPDATE_CANCELLED",
  "superseded work is refused without publication",
);

const otherGeneration = structuredClone(corpus.baseEnvelope);
otherGeneration["applicationGeneration"] = "generation:other-user";
const isolated = evaluatePrivateUpdateBytes(encodePrivateUpdateEnvelope(otherGeneration), byteContext, { now: () => 10 });
assert.equal(isolated.decision.code, "FADENO_UPDATE_GENERATION");
assert.equal(JSON.stringify(isolated).includes("other-user"), false, "cross-user identity is absent from the decision and metrics");
const authorizationClaim = structuredClone(corpus.baseEnvelope);
authorizationClaim["authorization"] = "granted-by-untrusted-response";
const authorizationRefusal = evaluatePrivateUpdateBytes(
  new TextEncoder().encode(JSON.stringify(authorizationClaim)),
  byteContext,
  { now: () => 10 },
);
assert.equal(authorizationRefusal.decision.code, "FADENO_UPDATE_SCHEMA", "transport cannot claim application authorization");
assert.equal(JSON.stringify(authorizationRefusal).includes("granted-by-untrusted-response"), false, "authorization claim is absent from refusal output");
const hostileMarkup = structuredClone(corpus.baseEnvelope);
((hostileMarkup["outcome"] as Record<string, unknown>)["root"] as Record<string, unknown>)["html"] = "<script>secret-cookie</script>";
const hostileDecision = evaluatePrivateUpdateBytes(encodePrivateUpdateEnvelope(hostileMarkup), byteContext, { now: () => 10 });
assert.equal(JSON.stringify(hostileDecision).includes("script"), false, "transported strings are never executable decision output");
assert.equal(JSON.stringify(hostileDecision).includes("secret-cookie"), false, "transported strings are never logged by the decoder result");

let encoderGetterRan = false;
const accessorEnvelope = Object.defineProperty({}, "protocol", { enumerable: true, get() { encoderGetterRan = true; return "fadeno.private.update"; } });
assert.throws(() => encodePrivateUpdateEnvelope(accessorEnvelope), /FADENO_UPDATE_ENCODE_SCHEMA/u);
assert.equal(encoderGetterRan, false, "encoder validation never invokes accessors");
const unknownEnvelope = structuredClone(corpus.baseEnvelope);
unknownEnvelope["command"] = "execute";
assert.throws(() => encodePrivateUpdateEnvelope(unknownEnvelope), /FADENO_UPDATE_ENCODE_SCHEMA/u, "encoder refuses command-shaped extensions");

console.log("V2 patch-protocol mutation tests passed (fixture schema, byte transport, boundaries, cancellation, isolation, redaction, and round trip)");
