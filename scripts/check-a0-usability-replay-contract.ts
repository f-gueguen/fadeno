import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyA0UsabilityPacket } from "./lib/a0-usability-contract.ts";
import { verifyA0UsabilityEvidence } from "./lib/a0-usability-evidence.ts";
import { writeSyntheticA0UsabilityEvidenceFixture } from "./lib/a0-usability-evidence-fixture.ts";

const packet = verifyA0UsabilityPacket(
  JSON.parse(readFileSync("evidence/a0/independent-usability/task-packet.json", "utf8")) as unknown,
);
const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-usability-replay-"));
try {
  const fixture = writeSyntheticA0UsabilityEvidenceFixture(temporary, packet);
  const summary = verifyA0UsabilityEvidence({
    repositoryRoot: temporary,
    manifestPath: fixture.manifestPath,
    packet,
    mode: "synthetic-contract",
  });
  const expected = JSON.parse(
    readFileSync("fixtures/a0-independent-usability/replay-summary.normalized.json", "utf8"),
  ) as unknown;
  assert.deepEqual(summary, expected);
  assert.equal(summary.accepted, false);
  console.log("A0 usability replay contract passed (3 retained attempts, 2 complete shapes, synthetic acceptance refused)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
