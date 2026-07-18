import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { verifyA0UsabilityAttemptRecord, verifyA0UsabilityPacket } from "./a0-usability-contract.ts";

type RecordValue = Record<string, unknown>;
type Packet = ReturnType<typeof verifyA0UsabilityPacket>;
type ArtifactField = "humanOutput" | "machineOutput" | "correctionBefore" | "correctionAfter" | "flowInspection" | "recovery";
type AttemptDisposition = "participant-attempt" | "synthetic-not-user-evidence";
type EvidenceDisposition = "participant-evidence" | "synthetic-not-user-evidence";

interface ArtifactReference {
  readonly path: string;
  readonly sha256: string;
}

interface TaskAttempt {
  readonly taskId: string;
  readonly outcome: "completed" | "refused" | "abandoned";
  readonly assistance: "none" | "public-documentation" | "facilitator-intervention";
  readonly recovery: "not-applicable" | "completed" | "refused" | "abandoned";
  readonly observation: string;
  readonly artifacts: Readonly<Record<ArtifactField, ArtifactReference | null>>;
}

interface AttemptRecord {
  readonly disposition: AttemptDisposition;
  readonly participant: Readonly<{
    anonymousId: string;
    priorContributor: boolean;
    privateImplementationGuidance: boolean;
  }>;
  readonly artifact: A0UsabilityArtifactIdentity;
  readonly tasks: readonly TaskAttempt[];
  readonly missingWorkflow: Readonly<{
    summary: string;
    editorProductWouldHaveChangedOutcome: boolean | null;
  }>;
}

export interface A0UsabilityArtifactIdentity {
  readonly sourceCommit: string;
  readonly packageSha256: string;
  readonly packageVersion: string;
}

interface EvidenceManifest {
  readonly disposition: EvidenceDisposition;
  readonly packetId: string;
  readonly instructionSha256: string;
  readonly artifact: A0UsabilityArtifactIdentity;
  readonly attemptFiles: readonly string[];
  readonly retention: Readonly<{
    collectionClosed: boolean;
    startedAttemptIds: readonly string[];
    retainedAttemptIds: readonly string[];
    omittedAttemptIds: readonly string[];
  }>;
}

export interface A0UsabilityReplaySummary {
  readonly schema: "fadeno.a0.independent-usability-replay-summary";
  readonly version: 1;
  readonly disposition: EvidenceDisposition;
  readonly packetId: string;
  readonly attemptsRetained: number;
  readonly qualifyingIndependentParticipants: number;
  readonly taskOutcomes: Readonly<{ completed: number; refused: number; abandoned: number }>;
  readonly assistance: Readonly<{ none: number; publicDocumentation: number; facilitatorIntervention: number }>;
  readonly missingWorkflowReports: number;
  readonly accepted: boolean;
  readonly reason: "accepted-real-evidence" | "synthetic-fixture-excluded";
}

const artifactFields = Object.freeze([
  "humanOutput", "machineOutput", "correctionBefore", "correctionAfter", "flowInspection", "recovery",
] as const);
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const participantPattern = /^participant-[a-z0-9]{8,32}$/u;

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], code: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new TypeError(code);
}

function exactStrings(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new TypeError(code);
  return value;
}

function parseArtifactIdentity(value: unknown, code: string): A0UsabilityArtifactIdentity {
  const identity = record(value, code);
  exactKeys(identity, ["sourceCommit", "packageSha256", "packageVersion"], code);
  if (
    typeof identity["sourceCommit"] !== "string" || !commitPattern.test(identity["sourceCommit"]) ||
    typeof identity["packageSha256"] !== "string" || !digestPattern.test(identity["packageSha256"]) ||
    typeof identity["packageVersion"] !== "string"
  ) throw new TypeError(code);
  return identity as unknown as A0UsabilityArtifactIdentity;
}

function parseManifest(value: unknown): EvidenceManifest {
  const code = "FADENO_A0_USABILITY_EVIDENCE_MANIFEST";
  const manifest = record(value, code);
  exactKeys(manifest, [
    "schema", "version", "disposition", "packetId", "instructionSha256", "artifact", "attemptFiles", "retention",
  ], code);
  if (
    manifest["schema"] !== "fadeno.a0.independent-usability-evidence" || manifest["version"] !== 1 ||
    !["participant-evidence", "synthetic-not-user-evidence"].includes(manifest["disposition"] as string) ||
    typeof manifest["packetId"] !== "string" || typeof manifest["instructionSha256"] !== "string" ||
    !digestPattern.test(manifest["instructionSha256"])
  ) throw new TypeError(code);
  parseArtifactIdentity(manifest["artifact"], code);
  const attemptFiles = exactStrings(manifest["attemptFiles"], code);
  if (attemptFiles.length === 0 || new Set(attemptFiles).size !== attemptFiles.length) throw new TypeError(code);
  const sortedFiles = [...attemptFiles].sort();
  if (JSON.stringify(attemptFiles) !== JSON.stringify(sortedFiles)) throw new TypeError(code);
  const retention = record(manifest["retention"], code);
  exactKeys(retention, ["collectionClosed", "startedAttemptIds", "retainedAttemptIds", "omittedAttemptIds"], code);
  if (retention["collectionClosed"] !== true) throw new TypeError(code);
  for (const key of ["startedAttemptIds", "retainedAttemptIds", "omittedAttemptIds"] as const) {
    const ids = exactStrings(retention[key], code);
    if (ids.some((id) => !participantPattern.test(id)) || new Set(ids).size !== ids.length) throw new TypeError(code);
    if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) throw new TypeError(code);
  }
  return manifest as unknown as EvidenceManifest;
}

function containedRegularFile(root: string, path: string, code: string): string {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) throw new TypeError(code);
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) throw new TypeError(code);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    const containment = relative(root, current);
    if (containment.length === 0 || containment.startsWith("..")) throw new TypeError(code);
    const status = lstatSync(current);
    if (index === segments.length - 1 ? !status.isFile() : !status.isDirectory()) throw new TypeError(code);
  }
  return current;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyPrivateText(text: string, code: string): void {
  if (
    text.includes("\uFFFD") ||
    /(?:^|[\s"'(])\/(?!\/)(?:[^/\s"')]+\/){2,}[^/\s"')]+/u.test(text) ||
    /(?:^|[\s"'(])[A-Za-z]:[\\/](?:[^\\/\s"')]+[\\/])+[^\\/\s"')]+/u.test(text) ||
    /\/(?:Users|home|private|tmp|workspace|workspaces|root|opt|srv|mnt|var|data|code|build)\//u.test(text) ||
    /(?:FADENO_SESSION_KEYS|TOKEN|PASSWORD|SECRET|API_KEY)\s*=\s*(?!<)[^\s]+/iu.test(text)
  ) throw new TypeError(code);
}

function verifyArtifactBytes(
  root: string,
  reference: ArtifactReference,
  participantId: string,
  seen: Set<string>,
  mode: "real-evidence" | "synthetic-contract",
): void {
  const code = "FADENO_A0_USABILITY_EVIDENCE_ARTIFACT";
  const expectedPrefix = mode === "real-evidence"
    ? `evidence/a0/independent-usability/attempts/${participantId}/`
    : `fixtures/a0-independent-usability/replay/${participantId}/`;
  if (!reference.path.startsWith(expectedPrefix) || seen.has(reference.path)) {
    throw new TypeError(code);
  }
  seen.add(reference.path);
  const bytes = readFileSync(containedRegularFile(root, reference.path, code));
  if (bytes.byteLength > 262144 || sha256(bytes) !== reference.sha256) throw new TypeError(code);
  verifyPrivateText(bytes.toString("utf8"), code);
}

function counts<T extends string>(values: readonly T[], expected: readonly T[]): Record<T, number> {
  return Object.fromEntries(expected.map((value) => [value, values.filter((candidate) => candidate === value).length])) as Record<T, number>;
}

export function readA0UsabilityEvidenceArtifactIdentity(options: Readonly<{
  repositoryRoot: string;
  manifestPath: string;
}>): A0UsabilityArtifactIdentity {
  const bytes = readFileSync(containedRegularFile(
    options.repositoryRoot,
    options.manifestPath,
    "FADENO_A0_USABILITY_EVIDENCE_PATH",
  ));
  return parseManifest(JSON.parse(bytes.toString("utf8")) as unknown).artifact;
}

export function verifyA0UsabilityEvidence(options: Readonly<{
  repositoryRoot: string;
  manifestPath: string;
  packet: Packet;
  mode: "real-evidence" | "synthetic-contract";
  reconstructedArtifact?: A0UsabilityArtifactIdentity;
}>): A0UsabilityReplaySummary {
  const manifestBytes = readFileSync(containedRegularFile(
    options.repositoryRoot,
    options.manifestPath,
    "FADENO_A0_USABILITY_EVIDENCE_PATH",
  ));
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  if (manifest.packetId !== options.packet.packetId || manifest.instructionSha256 !== options.packet.instructionSha256) {
    throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_PACKET");
  }
  if (options.mode === "real-evidence") {
    if (
      manifest.disposition !== "participant-evidence" || manifest.artifact.sourceCommit === "0".repeat(40) ||
      manifest.artifact.packageSha256 === "0".repeat(64)
    ) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_SYNTHETIC");
    if (options.reconstructedArtifact?.sourceCommit !== manifest.artifact.sourceCommit) {
      throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_SOURCE");
    }
    if (options.reconstructedArtifact.packageSha256 !== manifest.artifact.packageSha256) {
      throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_PACKAGE");
    }
    if (options.reconstructedArtifact.packageVersion !== manifest.artifact.packageVersion) {
      throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_PACKAGE");
    }
  } else if (manifest.disposition !== "synthetic-not-user-evidence") {
    throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_FIXTURE");
  }

  const attempts = manifest.attemptFiles.map((path) => {
    const bytes = readFileSync(containedRegularFile(options.repositoryRoot, path, "FADENO_A0_USABILITY_EVIDENCE_ATTEMPT_PATH"));
    if (bytes.byteLength > 524288) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_ATTEMPT_SIZE");
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    verifyA0UsabilityAttemptRecord(value, options.packet.taskIds);
    const attempt = value as AttemptRecord;
    const expectedPath = options.mode === "real-evidence"
      ? `evidence/a0/independent-usability/attempts/${attempt.participant.anonymousId}/attempt.json`
      : `fixtures/a0-independent-usability/replay/${attempt.participant.anonymousId}/attempt.json`;
    if (path !== expectedPath) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_ATTEMPT_PATH");
    return attempt;
  });
  const participantIds = attempts.map(({ participant }) => participant.anonymousId);
  if (new Set(participantIds).size !== participantIds.length) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_PARTICIPANT");
  const sortedIds = [...participantIds].sort();
  if (
    JSON.stringify(manifest.retention.startedAttemptIds) !== JSON.stringify(sortedIds) ||
    JSON.stringify(manifest.retention.retainedAttemptIds) !== JSON.stringify(sortedIds) ||
    manifest.retention.omittedAttemptIds.length !== 0
  ) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_RETENTION");

  const taskOutcomes: TaskAttempt["outcome"][] = [];
  const assistance: TaskAttempt["assistance"][] = [];
  let qualifyingIndependentParticipants = 0;
  let missingWorkflowReports = 0;
  for (const attempt of attempts) {
    if (
      attempt.artifact.sourceCommit !== manifest.artifact.sourceCommit ||
      attempt.artifact.packageSha256 !== manifest.artifact.packageSha256 ||
      attempt.artifact.packageVersion !== manifest.artifact.packageVersion
    ) {
      throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_IDENTITY");
    }
    if (
      options.mode === "real-evidence" ? attempt.disposition !== "participant-attempt" :
        attempt.disposition !== "synthetic-not-user-evidence"
    ) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_DISPOSITION");
    const seenArtifacts = new Set<string>();
    let complete = attempt.tasks.length === options.packet.taskIds.length;
    for (const task of attempt.tasks) {
      verifyPrivateText(task.observation, "FADENO_A0_USABILITY_EVIDENCE_PRIVACY");
      taskOutcomes.push(task.outcome);
      assistance.push(task.assistance);
      const requirement = options.packet.taskRequirements[task.taskId];
      if (!requirement) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_TASK");
      for (const field of artifactFields) {
        const reference = task.artifacts[field];
        if (reference) verifyArtifactBytes(
          options.repositoryRoot,
          reference,
          attempt.participant.anonymousId,
          seenArtifacts,
          options.mode,
        );
      }
      if (task.outcome === "completed") {
        for (const field of requirement.requiredArtifacts) {
          if (!task.artifacts[field as ArtifactField]) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_REQUIRED_ARTIFACT");
        }
      }
      const expectedRecovery = requirement.requiresRecovery
        ? task.outcome === "completed" ? "completed" : task.outcome
        : "not-applicable";
      if (task.recovery !== expectedRecovery) throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_RECOVERY");
      if (task.outcome !== "completed" || task.assistance === "facilitator-intervention") complete = false;
    }
    verifyPrivateText(attempt.missingWorkflow.summary, "FADENO_A0_USABILITY_EVIDENCE_PRIVACY");
    const reportsMissingWorkflow = attempt.missingWorkflow.summary.trim().length > 0;
    if (reportsMissingWorkflow) missingWorkflowReports += 1;
    if (
      complete && reportsMissingWorkflow && attempt.missingWorkflow.editorProductWouldHaveChangedOutcome !== null &&
      !attempt.participant.priorContributor && !attempt.participant.privateImplementationGuidance
    ) qualifyingIndependentParticipants += 1;
  }

  const outcomeCounts = counts(taskOutcomes, ["completed", "refused", "abandoned"]);
  const assistanceCounts = counts(assistance, ["none", "public-documentation", "facilitator-intervention"]);
  if (options.mode === "real-evidence" && qualifyingIndependentParticipants < 2) {
    throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_MINIMUM");
  }
  return Object.freeze({
    schema: "fadeno.a0.independent-usability-replay-summary",
    version: 1,
    disposition: manifest.disposition,
    packetId: manifest.packetId,
    attemptsRetained: attempts.length,
    qualifyingIndependentParticipants,
    taskOutcomes: Object.freeze({
      completed: outcomeCounts.completed,
      refused: outcomeCounts.refused,
      abandoned: outcomeCounts.abandoned,
    }),
    assistance: Object.freeze({
      none: assistanceCounts.none,
      publicDocumentation: assistanceCounts["public-documentation"],
      facilitatorIntervention: assistanceCounts["facilitator-intervention"],
    }),
    missingWorkflowReports,
    accepted: options.mode === "real-evidence",
    reason: options.mode === "real-evidence" ? "accepted-real-evidence" : "synthetic-fixture-excluded",
  });
}
