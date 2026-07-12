import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { referenceIdentityAccepted, type ReferenceEnvironmentIdentity, type ReferenceIdentityObservation } from "../../experiments/revalidation/reference-identity.ts";
import { deriveQualificationResult, type QualificationCapture, type QualificationResult } from "../../experiments/revalidation/qualification-proof.ts";
import { loadQualificationSchedule } from "../../experiments/revalidation/qualification-runner.ts";
import { assertSafeRetainedText } from "./revalidation-retained-text.ts";
import { assertQualificationAttemptDocument, assertQualificationCaptureDocument, assertReferenceIdentityDocument } from "./revalidation-qualification-validation.ts";

type Attempt = Readonly<{ attempt: number; sourceCommit: string; status: string; phase: string }>;
type Contract = Readonly<{
  environment: Readonly<{ path: string; sha256: string }>;
  inputs: Readonly<Record<string, Readonly<{ path: string; sha256: string }>>>;
}>;
type Reference = ReferenceEnvironmentIdentity & Readonly<{
  preflight: Readonly<{
    hostSamples: number;
    minimumCpuIdlePercent: number;
    maximumLoadAveragePerLogicalCpu: number;
    containerProcessLimit: number;
    maximumCpuThrottledRatio: number;
    requiredOomDelta: number;
    requiredOomKillDelta: number;
  }>;
}>;
type HostSample = Readonly<{ cpuIdlePercent: number; loadAveragePerLogicalCpu: number; powerSource: string; thermalState: string }>;
type ContainerSample = Readonly<{ nrPeriods: number; nrThrottled: number; oom: number; oomKill: number; pidsCurrent: number; networkDisabled: boolean; memoryCurrent: number }>;

export type VerifiedQualificationEvidence = Readonly<{
  capture: QualificationCapture;
  captureSha256: string;
  environmentEvidenceValid: true;
  artifactIntegrityValid: true;
}>;

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSourceBytes(root: string, commit: string, path: string): Buffer {
  return execFileSync("git", ["show", `${commit}:${path}`], { cwd: root });
}

function readSourceJson(root: string, commit: string, path: string): unknown {
  return JSON.parse(readSourceBytes(root, commit, path).toString("utf8"));
}

function hashMatches(path: string, expected: string): boolean {
  return sha256(readFileSync(path)) === expected;
}

function hostPhaseAccepted(samples: readonly HostSample[], reference: Reference): boolean {
  return samples.length === reference.preflight.hostSamples && samples.every((sample) =>
    sample.powerSource === "ac" && sample.thermalState === "no-warning" &&
    sample.cpuIdlePercent >= reference.preflight.minimumCpuIdlePercent &&
    sample.loadAveragePerLogicalCpu <= reference.preflight.maximumLoadAveragePerLogicalCpu);
}

function containerPhaseAccepted(before: ContainerSample, after: ContainerSample, reference: Reference): boolean {
  const periods = after.nrPeriods - before.nrPeriods;
  const throttled = after.nrThrottled - before.nrThrottled;
  const ratio = periods === 0 ? 0 : throttled / periods;
  return before.networkDisabled && after.networkDisabled &&
    before.pidsCurrent <= reference.preflight.containerProcessLimit && after.pidsCurrent <= reference.preflight.containerProcessLimit &&
    ratio <= reference.preflight.maximumCpuThrottledRatio &&
    after.oom - before.oom === reference.preflight.requiredOomDelta &&
    after.oomKill - before.oomKill === reference.preflight.requiredOomKillDelta;
}

function assertCompleteMeasurementLink(capture: QualificationCapture, measurements: Record<string, unknown>): void {
  const rawMemory = measurements.memory as Record<string, unknown> | undefined;
  const linkedMemory = capture.memory && rawMemory
    ? { ...rawMemory, baselineCgroupMemory: capture.memory.baselineCgroupMemory, afterCgroupMemory: capture.memory.afterCgroupMemory }
    : undefined;
  if (
    !isDeepStrictEqual(measurements.correctness, capture.correctness) ||
    !isDeepStrictEqual(measurements.latency, capture.latency) ||
    !isDeepStrictEqual(linkedMemory, capture.memory) ||
    !isDeepStrictEqual(measurements.controls, capture.controls)
  ) throw new Error("FADENO_REVALIDATION_EVIDENCE_MEASUREMENT_LINK");
}

export function verifyQualificationAttempt(
  repository: string,
  attemptRoot: string,
  expectedSourceCommit: string,
): VerifiedQualificationEvidence {
  const root = resolve(repository);
  const resolvedAttempt = resolve(attemptRoot);
  const resultsRoot = join(root, "experiments/revalidation/results");
  if (!resolvedAttempt.startsWith(`${resultsRoot}/`) || !/^[a-f0-9]{40}$/u.test(expectedSourceCommit)) {
    throw new Error("FADENO_REVALIDATION_EVIDENCE_PATH");
  }
  const expectedArtifacts = ["after-container.json", "after-host.json", "attempt.json", "before-container.json", "before-host.json", "capture.json", "identity.json", "measurements.json"];
  const artifacts = readdirSync(resolvedAttempt).filter((name) => statSync(join(resolvedAttempt, name)).isFile()).sort();
  if (JSON.stringify(artifacts) !== JSON.stringify(expectedArtifacts)) throw new Error("FADENO_REVALIDATION_EVIDENCE_INVENTORY");

  const workload = readSourceJson(root, expectedSourceCommit, "experiments/revalidation/workload.json") as { authentication: { secretCanary: string; principalId: string; tenantId: string } };
  const sensitive = [workload.authentication.secretCanary, workload.authentication.principalId, workload.authentication.tenantId];
  for (const name of artifacts) assertSafeRetainedText(readFileSync(join(resolvedAttempt, name), "utf8"), sensitive);

  const attempt = readJson(join(resolvedAttempt, "attempt.json")) as Attempt;
  const captureBytes = readFileSync(join(resolvedAttempt, "capture.json"));
  const capture = JSON.parse(captureBytes.toString("utf8")) as QualificationCapture;
  assertQualificationAttemptDocument(root, attempt);
  assertQualificationCaptureDocument(root, capture);
  if (attempt.status !== "complete" || attempt.phase !== "complete" || capture.status !== "complete" ||
      attempt.sourceCommit !== expectedSourceCommit || capture.sourceCommit !== expectedSourceCommit ||
      basename(resolvedAttempt) === "" ||
      execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim() !== "https://github.com/f-gueguen/fadeno.git" ||
      execFileSync("git", ["merge-base", "--is-ancestor", expectedSourceCommit, capture.sourceCommit], { cwd: root }).length !== 0) {
    throw new Error("FADENO_REVALIDATION_EVIDENCE_SOURCE");
  }

  const contract = readSourceJson(root, expectedSourceCommit, "experiments/revalidation/qualification-contract.json") as Contract;
  const records = { environment: contract.environment, ...contract.inputs };
  const expectedInputHashes = Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.sha256]));
  if (JSON.stringify(capture.inputHashes) !== JSON.stringify(expectedInputHashes)) throw new Error("FADENO_REVALIDATION_EVIDENCE_INPUTS");
  for (const record of Object.values(records)) {
    if (sha256(readSourceBytes(root, expectedSourceCommit, record.path)) !== record.sha256) throw new Error("FADENO_REVALIDATION_EVIDENCE_INPUT_BYTES");
  }

  const identity = readJson(join(resolvedAttempt, "identity.json")) as ReferenceIdentityObservation;
  const reference = readSourceJson(root, expectedSourceCommit, contract.environment.path) as Reference;
  assertReferenceIdentityDocument(root, identity);
  if (!hashMatches(join(resolvedAttempt, "identity.json"), capture.preflight.identitySha256) || !referenceIdentityAccepted(reference, identity)) {
    throw new Error("FADENO_REVALIDATION_EVIDENCE_IDENTITY");
  }
  const beforeHost = readJson(join(resolvedAttempt, "before-host.json")) as readonly HostSample[];
  const afterHost = readJson(join(resolvedAttempt, "after-host.json")) as readonly HostSample[];
  const beforeContainer = readJson(join(resolvedAttempt, "before-container.json")) as ContainerSample;
  const afterContainer = readJson(join(resolvedAttempt, "after-container.json")) as ContainerSample;
  const links = [
    ["before-host.json", capture.preflight.beforeHostSha256],
    ["after-host.json", capture.preflight.afterHostSha256],
    ["before-container.json", capture.preflight.beforeContainerSha256],
    ["after-container.json", capture.preflight.afterContainerSha256],
  ] as const;
  if (links.some(([name, digest]) => !hashMatches(join(resolvedAttempt, name), digest)) ||
      !hostPhaseAccepted(beforeHost, reference) || !hostPhaseAccepted(afterHost, reference) ||
      !containerPhaseAccepted(beforeContainer, afterContainer, reference)) {
    throw new Error("FADENO_REVALIDATION_EVIDENCE_ENVIRONMENT");
  }
  assertCompleteMeasurementLink(capture, readJson(join(resolvedAttempt, "measurements.json")) as Record<string, unknown>);
  return { capture, captureSha256: sha256(captureBytes), environmentEvidenceValid: true, artifactIntegrityValid: true };
}

export function selectFirstVerifiedQualificationAttempt(
  repository: string,
  expectedSourceCommit: string,
): VerifiedQualificationEvidence {
  const resultsRoot = join(resolve(repository), "experiments/revalidation/results");
  const candidates = readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(resultsRoot, entry.name))
    .sort((left, right) => {
      const leftAttempt = (readJson(join(left, "attempt.json")) as Attempt).attempt;
      const rightAttempt = (readJson(join(right, "attempt.json")) as Attempt).attempt;
      return leftAttempt - rightAttempt;
    });
  for (const candidate of candidates) {
    const attempt = readJson(join(candidate, "attempt.json")) as Attempt;
    assertQualificationAttemptDocument(repository, attempt);
    if (attempt.status === "complete") return verifyQualificationAttempt(repository, candidate, expectedSourceCommit);
  }
  throw new Error("FADENO_REVALIDATION_EVIDENCE_NO_COMPLETE_ATTEMPT");
}

export function verifyAndDeriveQualificationResult(
  repository: string,
  attemptRoot: string,
  expectedSourceCommit: string,
): QualificationResult {
  const evidence = verifyQualificationAttempt(repository, attemptRoot, expectedSourceCommit);
  return deriveQualificationResult(
    evidence.capture,
    loadQualificationSchedule(),
    evidence.captureSha256,
    evidence.environmentEvidenceValid,
    evidence.artifactIntegrityValid,
  );
}
