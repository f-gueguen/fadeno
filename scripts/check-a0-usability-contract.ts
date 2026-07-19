import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyA0UsabilityAttemptRecord,
  verifyA0UsabilityContractFixture,
  verifyA0UsabilityPacket,
} from "./lib/a0-usability-contract.ts";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const packet = verifyA0UsabilityPacket(JSON.parse(read("evidence/a0/independent-usability/task-packet.json")) as unknown);
verifyA0UsabilityContractFixture(
  JSON.parse(read("fixtures/a0-independent-usability/valid-contract-fixture.json")) as unknown,
  packet.taskIds,
);
verifyA0UsabilityAttemptRecord(
  JSON.parse(read("fixtures/a0-independent-usability/valid-attempt-fixture.json")) as unknown,
  packet.taskIds,
);
const tracked = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
}).trim().split("\n"));
for (const path of [
  "docs/adr/0042-independent-usability-evidence-contract.md",
  "evidence/a0/independent-usability/COLLECTION.md",
  "evidence/a0/independent-usability/task-packet.json",
  "evidence/a0/independent-usability/task-packet.md",
  "fixtures/a0-independent-usability/valid-contract-fixture.json",
  "fixtures/a0-independent-usability/valid-attempt-fixture.json",
]) assert.equal(tracked.has(path), true, `FADENO_A0_USABILITY_TRACKING:${path}`);
const adr = read("docs/adr/0042-independent-usability-evidence-contract.md");
for (const text of [
  "- Status: Superseded", "- Superseded by: ADR 0043", "at least two independent participants", "Every started", "cannot satisfy participant",
  "supported-editor", "pnpm check:a0-usability-contract",
]) assert.equal(adr.includes(text), true, `FADENO_A0_USABILITY_ADR:${text}`);
const instructions = read("evidence/a0/independent-usability/task-packet.md");
assert.equal(createHash("sha256").update(instructions).digest("hex"), packet.instructionSha256, "FADENO_A0_USABILITY_INSTRUCTIONS_DIGEST");
const collection = read("evidence/a0/independent-usability/COLLECTION.md");
for (const text of [
  "not additional participant guidance",
  "Opening the packet starts an attempt",
  "facilitator-intervention",
  "Email addresses",
  "unreferenced files",
  "omittedAttemptIds` must be empty",
  "pnpm check:a0-usability-evidence --manifest evidence/a0/independent-usability/evidence-manifest.json",
  "not permission to delete an attempt",
]) assert.equal(collection.includes(text), true, `FADENO_A0_USABILITY_COLLECTION:${text}`);
assert.equal(read("docs/adr/README.md").includes("0042-independent-usability-evidence-contract.md"), true);
assert.equal(read("ROADMAP_LEDGER.md").includes("A0-07A"), true);
assert.equal(read("docs/roadmap/a0.md").includes("pnpm check:a0-usability-contract"), true);
assert.equal(read("docs/spec/build-adapters-testing.md").includes("ADR 0042"), true);

console.log(`A0 usability contract passed (${packet.taskIds.length} frozen tasks, attempt schema verified, 2 participants required, synthetic evidence excluded)`);
