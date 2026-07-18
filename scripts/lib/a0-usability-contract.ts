type RecordValue = Record<string, unknown>;

const taskContract = Object.freeze([
  ["install-create", false],
  ["application-test", true],
  ["successful-flow-explanation", false],
  ["route-failure", true],
  ["configuration-failure", true],
  ["generation-failure", true],
  ["development-run", false],
  ["immutable-deployment", true],
  ["missing-workflow-report", false],
] as const);

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], code: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new TypeError(code);
}

export function verifyA0UsabilityPacket(value: unknown): Readonly<{ packetId: string; taskIds: readonly string[] }> {
  const code = "FADENO_A0_USABILITY_PACKET";
  const packet = record(value, code);
  exactKeys(packet, [
    "schema", "version", "packetId", "minimumIndependentParticipants", "artifact", "tasks",
    "attemptOutcomes", "assistance", "retention", "syntheticFixturesCountAsEvidence",
  ], code);
  if (
    packet["schema"] !== "fadeno.a0.independent-usability-task-packet" || packet["version"] !== 1 ||
    packet["packetId"] !== "a0-public-workflow-v1" || packet["minimumIndependentParticipants"] !== 2 ||
    packet["retention"] !== "all-started-attempts" || packet["syntheticFixturesCountAsEvidence"] !== false
  ) throw new TypeError(code);
  const artifact = record(packet["artifact"], code);
  exactKeys(artifact, ["package", "kind", "identity"], code);
  if (
    artifact["package"] !== "@fadeno/framework" || artifact["kind"] !== "packed-tarball" ||
    artifact["identity"] !== "sha256-and-source-commit"
  ) throw new TypeError(code);
  if (JSON.stringify(packet["attemptOutcomes"]) !== JSON.stringify(["completed", "refused", "abandoned"])) {
    throw new TypeError(code);
  }
  if (JSON.stringify(packet["assistance"]) !== JSON.stringify(["none", "public-documentation", "facilitator-intervention"])) {
    throw new TypeError(code);
  }
  if (!Array.isArray(packet["tasks"]) || packet["tasks"].length !== taskContract.length) throw new TypeError(code);
  const taskIds = packet["tasks"].map((value, index) => {
    const task = record(value, code);
    exactKeys(task, ["id", "requiresRecovery"], code);
    const expected = taskContract[index]!;
    if (task["id"] !== expected[0] || task["requiresRecovery"] !== expected[1]) throw new TypeError(code);
    return expected[0];
  });
  return Object.freeze({ packetId: packet["packetId"] as string, taskIds: Object.freeze(taskIds) });
}

export function verifyA0UsabilityContractFixture(value: unknown, taskIds: readonly string[]): void {
  const code = "FADENO_A0_USABILITY_FIXTURE";
  const fixture = record(value, code);
  exactKeys(fixture, ["schema", "version", "disposition", "packetId", "taskIds"], code);
  if (
    fixture["schema"] !== "fadeno.a0.independent-usability-contract-fixture" || fixture["version"] !== 1 ||
    fixture["disposition"] !== "synthetic-not-user-evidence" || fixture["packetId"] !== "a0-public-workflow-v1" ||
    JSON.stringify(fixture["taskIds"]) !== JSON.stringify(taskIds)
  ) throw new TypeError(code);
}
