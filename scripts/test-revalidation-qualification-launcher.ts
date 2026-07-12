import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeRetainedText, nextQualificationAttempt, qualificationAttemptId } from "./run-revalidation-reference-qualification.ts";
import { referenceIdentityAccepted, type ReferenceEnvironmentIdentity, type ReferenceIdentityObservation } from "../experiments/revalidation/reference-identity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (qualificationAttemptId("2026-07-12T00:00:00Z", "a".repeat(40), 1) !== "20260712T000000Z-aaaaaaa-a1") {
  throw new Error("FADENO_REVALIDATION_LAUNCHER_ATTEMPT_ID");
}
for (const invalid of [
  () => qualificationAttemptId("2026-07-12T00:00:00.000Z", "a".repeat(40), 1),
  () => qualificationAttemptId("2026-07-12T00:00:00Z", "bad", 1),
  () => qualificationAttemptId("2026-07-12T00:00:00Z", "a".repeat(40), 0),
]) {
  let rejected = false;
  try { invalid(); } catch (error: unknown) { rejected = error instanceof Error && error.message === "FADENO_REVALIDATION_ATTEMPT_ID"; }
  if (!rejected) throw new Error("FADENO_REVALIDATION_LAUNCHER_ATTEMPT_MUTATION");
}
const sensitive = ["canary-value", "principal-value", "tenant-value"];
for (const text of [...sensitive, "Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "password=hunter2", '{"password":"hunter2"}', '{"access_token":"abcdefghijklmnop"}', '{"client-secret":"abcdefghijklmnop"}', "-----BEGIN PRIVATE KEY-----"]) {
  let rejected = false;
  try { assertSafeRetainedText(`prefix:${text}:suffix`, sensitive); } catch (error: unknown) {
    rejected = error instanceof Error && error.message === "FADENO_REVALIDATION_RETAINED_SECRET" && !sensitive.some((value) => error.message.includes(value));
  }
  if (!rejected) throw new Error("FADENO_REVALIDATION_LAUNCHER_SECRET_MUTATION");
}
assertSafeRetainedText("allowlisted metrics and digests only", sensitive);
if (nextQualificationAttempt(join(root, "experiments/revalidation/results")) !== 1) throw new Error("FADENO_REVALIDATION_LAUNCHER_ATTEMPT_SEQUENCE");

const launcher = readFileSync(join(root, "scripts/run-revalidation-reference-qualification.ts"), "utf8");
for (const required of [
  '"--cpus", String(reference.container.cpuLimit)', '"--memory", `${reference.container.memoryMiB}m`',
  '"network", "disconnect"', '"--expose-gc"', "verifySourceInputs", "verifyContainerInputs", "referenceIdentityAccepted", "ls-remote", "statusPaths.some", "assertSafeRetainedText",
]) {
  if (!launcher.includes(required)) throw new Error(`FADENO_REVALIDATION_LAUNCHER_POLICY:${required}`);
}
const reference = JSON.parse(readFileSync(join(root, "experiments/revalidation/reference-environment.json"), "utf8")) as ReferenceEnvironmentIdentity;
const observed: ReferenceIdentityObservation = {
  schemaVersion: 1,
  environmentId: reference.id,
  host: {
    operatingSystemVersion: reference.host.operatingSystemVersion,
    buildVersion: reference.host.buildVersion,
    kernelVersion: reference.host.kernelVersion,
    architecture: reference.host.architecture,
    cpuModel: reference.host.cpuModel,
    logicalCpuCount: reference.host.logicalCpuCount,
    memoryMiB: reference.host.memoryMiB,
    freeStorageMiB: reference.host.minimumFreeStorageMiB,
  },
  docker: {
    desktopVersion: reference.docker.desktopVersion,
    engineVersion: reference.docker.engineVersion,
    apiVersion: reference.docker.apiVersion,
    operatingSystem: reference.docker.operatingSystem,
    architecture: reference.docker.architecture,
    kernelVersion: reference.docker.kernelVersion,
    cpuCount: reference.docker.minimumCpuCount,
    memoryMiB: reference.docker.minimumMemoryMiB,
  },
};
if (!referenceIdentityAccepted(reference, observed)) throw new Error("FADENO_REVALIDATION_LAUNCHER_IDENTITY_CONTROL");
for (const mutate of [
  (value: ReferenceIdentityObservation) => ({ ...value, host: { ...value.host, cpuModel: "wrong" } }),
  (value: ReferenceIdentityObservation) => ({ ...value, docker: { ...value.docker, engineVersion: "0.0.0" } }),
  (value: ReferenceIdentityObservation) => ({ ...value, host: { ...value.host, freeStorageMiB: reference.host.minimumFreeStorageMiB - 1 } }),
]) {
  if (referenceIdentityAccepted(reference, mutate(observed))) throw new Error("FADENO_REVALIDATION_LAUNCHER_IDENTITY_MUTATION");
}
if ((launcher.match(/writeFileSync\(/gu) ?? []).length !== 1) throw new Error("FADENO_REVALIDATION_LAUNCHER_UNSAFE_SINK");
if (launcher.includes(".mjs")) throw new Error("FADENO_REVALIDATION_LAUNCHER_MJS");
console.log("revalidation qualification launcher controls passed (source, limits, network, GC, retention, redaction)");
