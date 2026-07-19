import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseV2PatchProtocolCorpus,
  runV2PatchProtocolFixture,
  V2_PATCH_PROTOCOL_LIMITS,
  V2_PATCH_PROTOCOL_REQUIRED_CASE_IDS,
} from "./lib/v2-patch-protocol.ts";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const corpusDocument = JSON.parse(read("fixtures/v2-patch-protocol/decision-corpus.v1.json")) as unknown;
const corpus = parseV2PatchProtocolCorpus(corpusDocument);
const observed = corpus.cases.map((fixture) => Object.freeze({
  id: fixture.id,
  category: fixture.category,
  decision: runV2PatchProtocolFixture(corpus, fixture),
}));

for (const [index, fixture] of corpus.cases.entries()) {
  assert.deepEqual(observed[index]?.decision, fixture.expected, fixture.id);
}
assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length);
assert.deepEqual(corpus.cases.map(({ id }) => id).sort(), V2_PATCH_PROTOCOL_REQUIRED_CASE_IDS);
assert.deepEqual(
  [...new Set(corpus.cases.map(({ category }) => category))].sort(),
  ["cache", "compatibility", "decoder", "error", "identity", "limit", "ordering", "origin", "recovery", "redirect", "scroll", "success"],
);
assert.deepEqual(V2_PATCH_PROTOCOL_LIMITS, {
  maximumBytes: 2_097_152,
  maximumRecords: 4_096,
  maximumDepth: 16,
  maximumDurationMilliseconds: 50,
  maximumIdentityBytes: 128,
  maximumUrlBytes: 8_192,
  maximumTitleBytes: 4_096,
  maximumHtmlBytes: 2_097_152,
});
assert.equal(JSON.stringify(observed).includes("attacker.test/steal"), false, "decision output never echoes hostile input");
assert.equal(observed.every(({ decision }) => decision.mutationResubmission === "never"), true);

const adr = read("docs/adr/0045-private-update-protocol-and-scroll-refusal.md").replace(/\s+/gu, " ");
for (const fragment of [
  "private exact-version envelope",
  "application generation",
  "document epoch",
  "operation ID",
  "monotonic sequence",
  "result ID",
  "no-store",
  "same-origin",
  "303",
  "reload current server truth",
  "never resubmits",
  "proven unaffected",
  "affected or unknown",
  "Chromium, Firefox, and WebKit",
  "not a stable public protocol",
]) assert.equal(adr.includes(fragment), true, `ADR 0045 is missing ${fragment}`);

const specification = read("docs/spec/navigation-patching-preservation.md").replace(/\s+/gu, " ");
for (const fragment of [
  "ADR 0045",
  "exact private version 1 envelope",
  "no-store",
  "current operation",
  "affected or unknown preceding layout",
  "never repeats a mutation",
]) assert.equal(specification.includes(fragment), true, `navigation specification is missing ${fragment}`);

const decisionGates = read("docs/ledgers/decision-gates.md");
assert.equal(decisionGates.includes("| DG-V2-01 |"), false, "resolved DG-V2-01 must leave the open gate ledger");
const ledger = read("ROADMAP_LEDGER.md");
for (const fragment of ["V2-01 — resolve the experimental update protocol", "DG-V2-01 is resolved by ADR 0045", "Release impact: none"]) {
  assert.equal(ledger.includes(fragment), true, `roadmap ledger is missing ${fragment}`);
}
const traceability = read("docs/traceability.md");
for (const feature of ["ENH-01", "PATCH-01", "STATE-01", "SEC-01", "TEST-01"]) {
  const row = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(row.includes("ADR 0045"), true, `${feature} traceability is missing ADR 0045`);
  assert.equal(row.includes("check:v2-patch-protocol"), true, `${feature} traceability is missing the V2-01 gate`);
}
const packageDocument = JSON.parse(read("packages/framework/package.json")) as { exports?: Record<string, unknown> };
assert.deepEqual(Object.keys(packageDocument.exports ?? {}).sort(), [".", "./jsx-runtime", "./node"], "V2-01 must not add a public entrypoint");

console.log(`V2 private patch-protocol decision passed (${corpus.cases.length} fixtures, exact v1, bounded no-store recovery, no mutation replay)`);
