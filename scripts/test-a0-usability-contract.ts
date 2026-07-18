import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  verifyA0UsabilityAttemptRecord,
  verifyA0UsabilityContractFixture,
  verifyA0UsabilityPacket,
} from "./lib/a0-usability-contract.ts";

const packetSource = JSON.parse(readFileSync("evidence/a0/independent-usability/task-packet.json", "utf8")) as any;
const fixtureSource = JSON.parse(readFileSync("fixtures/a0-independent-usability/valid-contract-fixture.json", "utf8")) as any;
const attemptSource = JSON.parse(readFileSync("fixtures/a0-independent-usability/valid-attempt-fixture.json", "utf8")) as any;
const packet = verifyA0UsabilityPacket(packetSource);
verifyA0UsabilityContractFixture(fixtureSource, packet.taskIds);
verifyA0UsabilityAttemptRecord(attemptSource, packet.taskIds);
const packetRefuses = (mutate: (copy: any) => void): void => {
  const copy = structuredClone(packetSource);
  mutate(copy);
  assert.throws(() => verifyA0UsabilityPacket(copy), /FADENO_A0_USABILITY_PACKET/u);
};
packetRefuses((copy) => { copy.minimumIndependentParticipants = 1; });
packetRefuses((copy) => { copy.instructionSha256 = "0".repeat(63); });
packetRefuses((copy) => { copy.tasks.splice(3, 1); });
packetRefuses((copy) => { copy.tasks[1].requiresRecovery = false; });
packetRefuses((copy) => { copy.assistance.push("private-guidance"); });
packetRefuses((copy) => { copy.retention = "successful-attempts"; });
packetRefuses((copy) => { copy.syntheticFixturesCountAsEvidence = true; });
packetRefuses((copy) => { copy.attemptRecord.recordKeys.pop(); });
packetRefuses((copy) => { copy.attemptRecord.artifactFields.pop(); });
const fixture = structuredClone(fixtureSource);
fixture.disposition = "accepted-user-evidence";
assert.throws(() => verifyA0UsabilityContractFixture(fixture, packet.taskIds), /FADENO_A0_USABILITY_FIXTURE/u);

const attemptRefuses = (mutate: (copy: any) => void): void => {
  const copy = structuredClone(attemptSource);
  mutate(copy);
  assert.throws(() => verifyA0UsabilityAttemptRecord(copy, packet.taskIds), /FADENO_A0_USABILITY_ATTEMPT/u);
};
attemptRefuses((copy) => { copy.participant.name = "not retained"; });
attemptRefuses((copy) => { copy.participant.priorExperience = "expert"; });
attemptRefuses((copy) => { copy.artifact.packageSha256 = "0".repeat(63); });
attemptRefuses((copy) => { copy.tasks[0].taskId = "production-build"; });
attemptRefuses((copy) => { copy.tasks[0].assistance = "private-guidance"; });
attemptRefuses((copy) => { copy.tasks[0].observation = "x".repeat(2049); });
attemptRefuses((copy) => { copy.tasks[0].artifacts.humanOutput.path = "/private/attempt.txt"; });
attemptRefuses((copy) => { copy.tasks[0].artifacts.humanOutput.path = "fixtures/a0-independent-usability/../escape.txt"; });
attemptRefuses((copy) => { copy.redaction.removedFields = ["unknown-sensitive-field"]; });

console.log("A0 usability contract mutation tests passed (instructions, attempts, privacy, tasks, recovery, assistance, retention, synthetic refusal)");
