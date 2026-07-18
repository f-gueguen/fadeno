import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { verifyA0UsabilityPacket } from "./a0-usability-contract.ts";

type Packet = ReturnType<typeof verifyA0UsabilityPacket>;
type ArtifactField = "humanOutput" | "machineOutput" | "correctionBefore" | "correctionAfter" | "flowInspection" | "recovery";

const fields = Object.freeze([
  "humanOutput", "machineOutput", "correctionBefore", "correctionAfter", "flowInspection", "recovery",
] as const);
const identity = Object.freeze({
  sourceCommit: "0".repeat(40),
  packageSha256: "0".repeat(64),
  packageVersion: "0.0.0",
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(root: string, path: string, value: unknown): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function completeAttempt(root: string, packet: Packet, participantId: string, assistance: "none" | "public-documentation"): string {
  const tasks = packet.taskIds.map((taskId) => {
    const requirement = packet.taskRequirements[taskId]!;
    const artifacts = Object.fromEntries(fields.map((field) => {
      if (!requirement.requiredArtifacts.includes(field)) return [field, null];
      const path = `fixtures/a0-independent-usability/replay/${participantId}/artifacts/${taskId}-${field}.json`;
      const body = `${JSON.stringify({ schemaVersion: 1, participantId, taskId, field })}\n`;
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
      return [field, { path, sha256: sha256(body) }];
    })) as Record<ArtifactField, Readonly<{ path: string; sha256: string }> | null>;
    return {
      taskId,
      outcome: "completed",
      assistance,
      durationBand: "5-15m",
      recovery: requirement.requiresRecovery ? "completed" : "not-applicable",
      observation: `Synthetic ${taskId} observation.`,
      artifacts,
    };
  });
  const path = `fixtures/a0-independent-usability/replay/${participantId}/attempt.json`;
  writeJson(root, path, {
    schema: "fadeno.a0.independent-usability-attempt",
    version: 1,
    disposition: "synthetic-not-user-evidence",
    packetId: packet.packetId,
    participant: {
      anonymousId: participantId,
      priorExperience: participantId.endsWith("01") ? "limited" : "regular",
      priorContributor: false,
      privateImplementationGuidance: false,
    },
    artifact: identity,
    tasks,
    missingWorkflow: {
      summary: `Synthetic missing-workflow report from ${participantId}.`,
      editorProductWouldHaveChangedOutcome: false,
    },
    redaction: { reviewed: true, removedFields: [] },
  });
  return path;
}

function abandonedAttempt(root: string, packet: Packet, participantId: string): string {
  const firstRequirement = packet.taskRequirements[packet.taskIds[0]!]!;
  const artifactPath = `fixtures/a0-independent-usability/replay/${participantId}/artifacts/install-create-humanOutput.json`;
  const artifactBody = `${JSON.stringify({ schemaVersion: 1, participantId, taskId: packet.taskIds[0], field: "humanOutput" })}\n`;
  mkdirSync(dirname(join(root, artifactPath)), { recursive: true });
  writeFileSync(join(root, artifactPath), artifactBody);
  const artifacts = Object.fromEntries(fields.map((field) => [
    field,
    field === "humanOutput" ? { path: artifactPath, sha256: sha256(artifactBody) } : null,
  ]));
  const path = `fixtures/a0-independent-usability/replay/${participantId}/attempt.json`;
  writeJson(root, path, {
    schema: "fadeno.a0.independent-usability-attempt",
    version: 1,
    disposition: "synthetic-not-user-evidence",
    packetId: packet.packetId,
    participant: {
      anonymousId: participantId,
      priorExperience: "none",
      priorContributor: false,
      privateImplementationGuidance: false,
    },
    artifact: identity,
    tasks: [
      {
        taskId: packet.taskIds[0], outcome: "completed", assistance: "none", durationBand: "under-5m",
        recovery: firstRequirement.requiresRecovery ? "completed" : "not-applicable",
        observation: "Synthetic completed first task.", artifacts,
      },
      {
        taskId: packet.taskIds[1], outcome: "abandoned", assistance: "facilitator-intervention", durationBand: "under-5m",
        recovery: "abandoned", observation: "Synthetic abandoned attempt.",
        artifacts: Object.fromEntries(fields.map((field) => [field, null])),
      },
    ],
    missingWorkflow: { summary: "", editorProductWouldHaveChangedOutcome: null },
    redaction: { reviewed: true, removedFields: [] },
  });
  return path;
}

export function writeSyntheticA0UsabilityEvidenceFixture(root: string, packet: Packet): Readonly<{
  manifestPath: string;
  attemptFiles: readonly string[];
}> {
  const participantIds = ["participant-synthetic01", "participant-synthetic02", "participant-synthetic03"] as const;
  const attemptFiles = [
    completeAttempt(root, packet, participantIds[0], "public-documentation"),
    completeAttempt(root, packet, participantIds[1], "none"),
    abandonedAttempt(root, packet, participantIds[2]),
  ].sort();
  const manifestPath = "fixtures/a0-independent-usability/replay/manifest.json";
  writeJson(root, manifestPath, {
    schema: "fadeno.a0.independent-usability-evidence",
    version: 1,
    disposition: "synthetic-not-user-evidence",
    packetId: packet.packetId,
    instructionSha256: packet.instructionSha256,
    artifact: identity,
    attemptFiles,
    retention: {
      collectionClosed: true,
      startedAttemptIds: [...participantIds].sort(),
      retainedAttemptIds: [...participantIds].sort(),
      omittedAttemptIds: [],
    },
  });
  return Object.freeze({ manifestPath, attemptFiles: Object.freeze(attemptFiles) });
}
