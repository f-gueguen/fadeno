type RecordValue = Record<string, unknown>;

const taskContract = Object.freeze([
  ["install-create", false, ["humanOutput"]],
  ["application-test", true, ["humanOutput", "machineOutput", "correctionBefore", "correctionAfter", "recovery"]],
  ["successful-flow-explanation", false, ["humanOutput", "flowInspection"]],
  ["route-failure", true, ["humanOutput", "correctionBefore", "correctionAfter", "recovery"]],
  ["failed-flow-explanation", true, ["humanOutput", "flowInspection", "recovery"]],
  ["configuration-failure", true, ["humanOutput", "correctionBefore", "correctionAfter", "recovery"]],
  ["generation-failure", true, ["humanOutput", "correctionBefore", "correctionAfter", "flowInspection", "recovery"]],
  ["development-run", false, ["humanOutput"]],
  ["production-build", false, ["humanOutput", "machineOutput"]],
  ["immutable-deployment", true, ["humanOutput", "machineOutput", "correctionBefore", "correctionAfter", "flowInspection", "recovery"]],
  ["missing-workflow-report", false, ["humanOutput"]],
] as const);

const attemptOutcomes = Object.freeze(["completed", "refused", "abandoned"] as const);
const assistanceCategories = Object.freeze(["none", "public-documentation", "facilitator-intervention"] as const);
const priorExperienceBands = Object.freeze(["none", "limited", "regular"] as const);
const durationBands = Object.freeze(["under-5m", "5-15m", "15-30m", "over-30m", "not-recorded"] as const);
const recoveryOutcomes = Object.freeze(["not-applicable", "completed", "refused", "abandoned"] as const);
const artifactFields = Object.freeze([
  "humanOutput", "machineOutput", "correctionBefore", "correctionAfter", "flowInspection", "recovery",
] as const);
const prohibitedFields = Object.freeze([
  "name", "contactDetails", "secret", "absolutePath", "environmentValue", "unrelatedCommandHistory", "preciseTimestamp",
] as const);
const attemptRecordKeys = Object.freeze([
  "schema", "version", "disposition", "packetId", "participant", "artifact", "tasks", "missingWorkflow", "redaction",
] as const);
const participantKeys = Object.freeze([
  "anonymousId", "priorExperience", "priorContributor", "privateImplementationGuidance",
] as const);
const artifactIdentityKeys = Object.freeze(["sourceCommit", "packageSha256", "packageVersion"] as const);
const taskAttemptKeys = Object.freeze([
  "taskId", "outcome", "assistance", "durationBand", "recovery", "observation", "artifacts",
] as const);
const artifactReferenceKeys = Object.freeze(["path", "sha256"] as const);
const missingWorkflowKeys = Object.freeze(["summary", "editorProductWouldHaveChangedOutcome"] as const);
const redactionKeys = Object.freeze(["reviewed", "removedFields"] as const);
const digestPattern = /^[a-f0-9]{64}$/u;
const participantPattern = /^participant-[a-z0-9]{8,32}$/u;
const evidencePathPattern = /^(?:evidence\/a0\/independent-usability\/attempts|fixtures\/a0-independent-usability)\/[a-zA-Z0-9._/-]+$/u;

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], code: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new TypeError(code);
}

function exactArray(value: unknown, expected: readonly string[], code: string): void {
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new TypeError(code);
}

function oneOf(value: unknown, expected: readonly string[], code: string): string {
  if (typeof value !== "string" || !expected.includes(value)) throw new TypeError(code);
  return value;
}

export function verifyA0UsabilityPacket(value: unknown): Readonly<{
  instructionSha256: string;
  packetId: string;
  taskIds: readonly string[];
  taskRequirements: Readonly<Record<string, Readonly<{ requiredArtifacts: readonly string[]; requiresRecovery: boolean }>>>;
}> {
  const code = "FADENO_A0_USABILITY_PACKET";
  const packet = record(value, code);
  exactKeys(packet, [
    "schema", "version", "packetId", "instructionSha256", "minimumIndependentParticipants", "artifact", "tasks",
    "attemptOutcomes", "assistance", "attemptRecord", "retention", "syntheticFixturesCountAsEvidence",
  ], code);
  if (
    packet["schema"] !== "fadeno.a0.independent-usability-task-packet" || packet["version"] !== 1 ||
    packet["packetId"] !== "a0-public-workflow-v1" || typeof packet["instructionSha256"] !== "string" ||
    !digestPattern.test(packet["instructionSha256"]) || packet["minimumIndependentParticipants"] !== 2 ||
    packet["retention"] !== "all-started-attempts" || packet["syntheticFixturesCountAsEvidence"] !== false
  ) throw new TypeError(code);
  const artifact = record(packet["artifact"], code);
  exactKeys(artifact, ["package", "kind", "identity"], code);
  if (
    artifact["package"] !== "@fadeno/framework" || artifact["kind"] !== "packed-tarball" ||
    artifact["identity"] !== "sha256-and-source-commit"
  ) throw new TypeError(code);
  exactArray(packet["attemptOutcomes"], attemptOutcomes, code);
  exactArray(packet["assistance"], assistanceCategories, code);
  const attemptRecord = record(packet["attemptRecord"], code);
  exactKeys(attemptRecord, [
    "schema", "version", "dispositions", "recordKeys", "participantKeys", "artifactIdentityKeys", "taskAttemptKeys",
    "artifactReferenceKeys", "missingWorkflowKeys", "redactionKeys", "anonymousIdPattern", "digestFormat",
    "priorExperienceBands", "durationBands", "recoveryOutcomes", "artifactFields", "maxObservationBytes", "maxArtifactBytes",
    "prohibitedFields",
  ], code);
  if (
    attemptRecord["schema"] !== "fadeno.a0.independent-usability-attempt" || attemptRecord["version"] !== 1 ||
    attemptRecord["anonymousIdPattern"] !== "participant-[a-z0-9]{8,32}" ||
    attemptRecord["digestFormat"] !== "lowercase-sha256" || attemptRecord["maxObservationBytes"] !== 2048 ||
    attemptRecord["maxArtifactBytes"] !== 262144
  ) throw new TypeError(code);
  exactArray(attemptRecord["dispositions"], ["participant-attempt", "synthetic-not-user-evidence"], code);
  exactArray(attemptRecord["recordKeys"], attemptRecordKeys, code);
  exactArray(attemptRecord["participantKeys"], participantKeys, code);
  exactArray(attemptRecord["artifactIdentityKeys"], artifactIdentityKeys, code);
  exactArray(attemptRecord["taskAttemptKeys"], taskAttemptKeys, code);
  exactArray(attemptRecord["artifactReferenceKeys"], artifactReferenceKeys, code);
  exactArray(attemptRecord["missingWorkflowKeys"], missingWorkflowKeys, code);
  exactArray(attemptRecord["redactionKeys"], redactionKeys, code);
  exactArray(attemptRecord["priorExperienceBands"], priorExperienceBands, code);
  exactArray(attemptRecord["durationBands"], durationBands, code);
  exactArray(attemptRecord["recoveryOutcomes"], recoveryOutcomes, code);
  exactArray(attemptRecord["artifactFields"], artifactFields, code);
  exactArray(attemptRecord["prohibitedFields"], prohibitedFields, code);
  if (!Array.isArray(packet["tasks"]) || packet["tasks"].length !== taskContract.length) throw new TypeError(code);
  const taskIds = packet["tasks"].map((value, index) => {
    const task = record(value, code);
    exactKeys(task, ["id", "requiresRecovery", "requiredArtifacts"], code);
    const expected = taskContract[index]!;
    if (
      task["id"] !== expected[0] || task["requiresRecovery"] !== expected[1] ||
      JSON.stringify(task["requiredArtifacts"]) !== JSON.stringify(expected[2])
    ) throw new TypeError(code);
    return expected[0];
  });
  const taskRequirements = Object.freeze(Object.fromEntries(taskContract.map(([id, requiresRecovery, requiredArtifacts]) => [
    id,
    Object.freeze({ requiresRecovery, requiredArtifacts: Object.freeze([...requiredArtifacts]) }),
  ])));
  return Object.freeze({
    instructionSha256: packet["instructionSha256"],
    packetId: packet["packetId"],
    taskIds: Object.freeze(taskIds),
    taskRequirements,
  });
}

function verifyArtifactReference(value: unknown, code: string): void {
  if (value === null) return;
  const artifact = record(value, code);
  exactKeys(artifact, artifactReferenceKeys, code);
  if (
    typeof artifact["path"] !== "string" || !evidencePathPattern.test(artifact["path"]) ||
    artifact["path"].split("/").some((segment) => segment === "." || segment === "..") ||
    typeof artifact["sha256"] !== "string" || !digestPattern.test(artifact["sha256"])
  ) throw new TypeError(code);
}

export function verifyA0UsabilityAttemptRecord(value: unknown, taskIds: readonly string[]): void {
  const code = "FADENO_A0_USABILITY_ATTEMPT";
  const attempt = record(value, code);
  exactKeys(attempt, attemptRecordKeys, code);
  if (
    attempt["schema"] !== "fadeno.a0.independent-usability-attempt" || attempt["version"] !== 1 ||
    attempt["packetId"] !== "a0-public-workflow-v1"
  ) throw new TypeError(code);
  oneOf(attempt["disposition"], ["participant-attempt", "synthetic-not-user-evidence"], code);

  const participant = record(attempt["participant"], code);
  exactKeys(participant, participantKeys, code);
  if (
    typeof participant["anonymousId"] !== "string" || !participantPattern.test(participant["anonymousId"]) ||
    typeof participant["priorContributor"] !== "boolean" || typeof participant["privateImplementationGuidance"] !== "boolean"
  ) throw new TypeError(code);
  oneOf(participant["priorExperience"], priorExperienceBands, code);

  const artifact = record(attempt["artifact"], code);
  exactKeys(artifact, artifactIdentityKeys, code);
  if (
    typeof artifact["sourceCommit"] !== "string" || !/^[a-f0-9]{40}$/u.test(artifact["sourceCommit"]) ||
    typeof artifact["packageSha256"] !== "string" || !digestPattern.test(artifact["packageSha256"]) ||
    typeof artifact["packageVersion"] !== "string" || !/^0\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(artifact["packageVersion"])
  ) throw new TypeError(code);

  if (!Array.isArray(attempt["tasks"]) || attempt["tasks"].length < 1 || attempt["tasks"].length > taskIds.length) {
    throw new TypeError(code);
  }
  attempt["tasks"].forEach((value, index) => {
    const task = record(value, code);
    exactKeys(task, taskAttemptKeys, code);
    if (task["taskId"] !== taskIds[index]) throw new TypeError(code);
    oneOf(task["outcome"], attemptOutcomes, code);
    oneOf(task["assistance"], assistanceCategories, code);
    oneOf(task["durationBand"], durationBands, code);
    oneOf(task["recovery"], recoveryOutcomes, code);
    if (typeof task["observation"] !== "string" || Buffer.byteLength(task["observation"], "utf8") > 2048) {
      throw new TypeError(code);
    }
    const artifacts = record(task["artifacts"], code);
    exactKeys(artifacts, artifactFields, code);
    for (const field of artifactFields) verifyArtifactReference(artifacts[field], code);
  });

  const missingWorkflow = record(attempt["missingWorkflow"], code);
  exactKeys(missingWorkflow, missingWorkflowKeys, code);
  if (
    typeof missingWorkflow["summary"] !== "string" || Buffer.byteLength(missingWorkflow["summary"], "utf8") > 2048 ||
    ![true, false, null].includes(missingWorkflow["editorProductWouldHaveChangedOutcome"] as boolean | null)
  ) throw new TypeError(code);

  const redaction = record(attempt["redaction"], code);
  exactKeys(redaction, redactionKeys, code);
  if (redaction["reviewed"] !== true || !Array.isArray(redaction["removedFields"])) throw new TypeError(code);
  for (const field of redaction["removedFields"]) oneOf(field, prohibitedFields, code);
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
