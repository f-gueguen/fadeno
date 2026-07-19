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
