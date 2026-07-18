import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { verifyA0UsabilityPacket } from "./lib/a0-usability-contract.ts";
import { verifyA0UsabilityEvidence } from "./lib/a0-usability-evidence.ts";
import { writeSyntheticA0UsabilityEvidenceFixture } from "./lib/a0-usability-evidence-fixture.ts";

const packet = verifyA0UsabilityPacket(
  JSON.parse(readFileSync("evidence/a0/independent-usability/task-packet.json", "utf8")) as unknown,
);
const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-usability-replay-tests-"));
const baseline = join(temporary, "baseline");
const fixture = writeSyntheticA0UsabilityEvidenceFixture(baseline, packet);
let mutationOrdinal = 0;

const readJson = (root: string, path: string): any => JSON.parse(readFileSync(join(root, path), "utf8")) as unknown;
const writeJson = (root: string, path: string, value: unknown): void => {
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
};
const verify = (root: string, mode: "real-evidence" | "synthetic-contract" = "synthetic-contract", digest?: string) =>
  verifyA0UsabilityEvidence({
    repositoryRoot: root,
    manifestPath: fixture.manifestPath,
    packet,
    mode,
    reconstructedPackageSha256: digest,
  });
const refuses = (
  mutate: (root: string, manifest: any) => void,
  code: RegExp,
  mode: "real-evidence" | "synthetic-contract" = "synthetic-contract",
  digest?: string,
): void => {
  const root = join(temporary, `mutation-${String(++mutationOrdinal).padStart(2, "0")}`);
  cpSync(baseline, root, { recursive: true });
  const manifest = readJson(root, fixture.manifestPath);
  mutate(root, manifest);
  writeJson(root, fixture.manifestPath, manifest);
  assert.throws(() => verify(root, mode, digest), code);
};

try {
  const summary = verify(baseline);
  assert.equal(summary.accepted, false);
  assert.equal(summary.reason, "synthetic-fixture-excluded");
  assert.throws(() => verify(baseline, "real-evidence", "0".repeat(64)), /FADENO_A0_USABILITY_EVIDENCE_SYNTHETIC/u);

  refuses((_root, manifest) => { manifest.instructionSha256 = "1".repeat(64); }, /FADENO_A0_USABILITY_EVIDENCE_PACKET/u);
  refuses((_root, manifest) => { manifest.retention.collectionClosed = false; }, /FADENO_A0_USABILITY_EVIDENCE_MANIFEST/u);
  refuses((_root, manifest) => { manifest.retention.omittedAttemptIds = ["participant-omitted01"]; }, /FADENO_A0_USABILITY_EVIDENCE_RETENTION/u);
  refuses((_root, manifest) => { manifest.attemptFiles.pop(); }, /FADENO_A0_USABILITY_EVIDENCE_RETENTION/u);
  refuses((root, manifest) => {
    const first = readJson(root, manifest.attemptFiles[0]);
    const second = readJson(root, manifest.attemptFiles[1]);
    second.participant.anonymousId = first.participant.anonymousId;
    writeJson(root, manifest.attemptFiles[1], second);
  }, /FADENO_A0_USABILITY_EVIDENCE_ATTEMPT_PATH/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.artifact.packageVersion = "0.0.1";
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_IDENTITY/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.tasks[0].artifacts.humanOutput = null;
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_REQUIRED_ARTIFACT/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.tasks[1].recovery = "not-applicable";
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_RECOVERY/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.tasks[0].artifacts.humanOutput.sha256 = "1".repeat(64);
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_ARTIFACT/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.tasks[0].observation = "retained from /Users/example/private/project";
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_PRIVACY/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    const reference = attempt.tasks[0].artifacts.humanOutput;
    const body = "local path: /Users/example/private/project\n";
    writeFileSync(join(root, reference.path), body);
    reference.sha256 = createHash("sha256").update(body).digest("hex");
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_ARTIFACT/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    attempt.tasks[1].artifacts.humanOutput = attempt.tasks[0].artifacts.humanOutput;
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_EVIDENCE_ARTIFACT/u);
  refuses((root, manifest) => {
    const attempt = readJson(root, manifest.attemptFiles[0]);
    [attempt.tasks[0], attempt.tasks[1]] = [attempt.tasks[1], attempt.tasks[0]];
    writeJson(root, manifest.attemptFiles[0], attempt);
  }, /FADENO_A0_USABILITY_ATTEMPT/u);

  const realSha = "2".repeat(64);
  refuses((root, manifest) => {
    const realIdentity = { sourceCommit: "1".repeat(40), packageSha256: realSha, packageVersion: "0.0.0" };
    manifest.disposition = "participant-evidence";
    manifest.artifact = realIdentity;
    const realAttemptFiles = [];
    for (const path of manifest.attemptFiles) {
      const attempt = readJson(root, path);
      attempt.disposition = "participant-attempt";
      attempt.artifact = realIdentity;
      if (attempt.participant.anonymousId === "participant-synthetic02") {
        attempt.tasks[0].assistance = "facilitator-intervention";
      }
      for (const task of attempt.tasks) {
        for (const value of Object.values(task.artifacts) as unknown[]) {
          if (!value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string") continue;
          const reference = value as { path: string };
          const nextPath = reference.path.replace(
            `fixtures/a0-independent-usability/replay/${attempt.participant.anonymousId}/`,
            `evidence/a0/independent-usability/attempts/${attempt.participant.anonymousId}/`,
          );
          mkdirSync(dirname(join(root, nextPath)), { recursive: true });
          cpSync(join(root, reference.path), join(root, nextPath));
          reference.path = nextPath;
        }
      }
      const nextAttemptPath = `evidence/a0/independent-usability/attempts/${attempt.participant.anonymousId}/attempt.json`;
      mkdirSync(dirname(join(root, nextAttemptPath)), { recursive: true });
      writeJson(root, nextAttemptPath, attempt);
      realAttemptFiles.push(nextAttemptPath);
    }
    manifest.attemptFiles = realAttemptFiles.sort();
  }, /FADENO_A0_USABILITY_EVIDENCE_MINIMUM/u, "real-evidence", realSha);

  console.log(`A0 usability replay negative tests passed (${mutationOrdinal + 1} retention, identity, artifact, recovery, privacy, minimum, synthetic controls)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
