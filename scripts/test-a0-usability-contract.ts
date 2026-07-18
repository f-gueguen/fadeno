import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { verifyA0UsabilityContractFixture, verifyA0UsabilityPacket } from "./lib/a0-usability-contract.ts";

const packetSource = JSON.parse(readFileSync("evidence/a0/independent-usability/task-packet.json", "utf8")) as any;
const fixtureSource = JSON.parse(readFileSync("fixtures/a0-independent-usability/valid-contract-fixture.json", "utf8")) as any;
const packet = verifyA0UsabilityPacket(packetSource);
verifyA0UsabilityContractFixture(fixtureSource, packet.taskIds);
const packetRefuses = (mutate: (copy: any) => void): void => {
  const copy = structuredClone(packetSource);
  mutate(copy);
  assert.throws(() => verifyA0UsabilityPacket(copy), /FADENO_A0_USABILITY_PACKET/u);
};
packetRefuses((copy) => { copy.minimumIndependentParticipants = 1; });
packetRefuses((copy) => { copy.tasks.splice(3, 1); });
packetRefuses((copy) => { copy.tasks[1].requiresRecovery = false; });
packetRefuses((copy) => { copy.assistance.push("private-guidance"); });
packetRefuses((copy) => { copy.retention = "successful-attempts"; });
packetRefuses((copy) => { copy.syntheticFixturesCountAsEvidence = true; });
const fixture = structuredClone(fixtureSource);
fixture.disposition = "accepted-user-evidence";
assert.throws(() => verifyA0UsabilityContractFixture(fixture, packet.taskIds), /FADENO_A0_USABILITY_FIXTURE/u);

console.log("A0 usability contract mutation tests passed (participants, tasks, recovery, assistance, retention, synthetic refusal)");
