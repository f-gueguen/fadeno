import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";
import { validQualificationCapture } from "./lib/revalidation-qualification-fixture.ts";
import { verifyAndDeriveQualificationResult, verifyQualificationAttempt } from "./lib/revalidation-qualification-verifier.ts";

const root = join(import.meta.dirname, "..");
const resultsRoot = join(root, "experiments/revalidation/results");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const contract = JSON.parse(readFileSync(join(root, "experiments/revalidation/qualification-contract.json"), "utf8")) as {
  environment: { path: string; sha256: string };
  inputs: Record<string, { path: string; sha256: string }>;
};
const reference = JSON.parse(readFileSync(join(root, contract.environment.path), "utf8")) as {
  id: string;
  host: Record<string, string | number> & { minimumFreeStorageMiB: number };
  docker: Record<string, string | number> & { minimumCpuCount: number; minimumMemoryMiB: number };
};
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function createAttempt(suffix: string): string {
  const attemptRoot = join(resultsRoot, `20260712T000000Z-${sourceCommit.slice(0, 7)}-a${suffix}`);
  mkdirSync(attemptRoot);
  const write = (name: string, value: unknown) => {
    const bytes = json(value);
    writeFileSync(join(attemptRoot, name), bytes);
    return sha256(bytes);
  };
  const identity = {
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
  const host = Array.from({ length: 3 }, () => ({ cpuIdlePercent: 100, loadAveragePerLogicalCpu: 0, powerSource: "ac", thermalState: "no-warning" }));
  const beforeContainer = { nrPeriods: 0, nrThrottled: 0, oom: 0, oomKill: 0, pidsCurrent: 1, networkDisabled: true, memoryCurrent: 2000 };
  const afterContainer = { ...beforeContainer, nrPeriods: 1000, memoryCurrent: 2050 };
  const identitySha256 = write("identity.json", identity);
  const beforeHostSha256 = write("before-host.json", host);
  const afterHostSha256 = write("after-host.json", host);
  const beforeContainerSha256 = write("before-container.json", beforeContainer);
  const afterContainerSha256 = write("after-container.json", afterContainer);
  const baseCapture = validQualificationCapture(loadQualificationSchedule());
  const capture = {
    ...baseCapture,
    sourceCommit,
    inputHashes: Object.fromEntries(Object.entries({ environment: contract.environment, ...contract.inputs }).map(([key, value]) => [key, value.sha256])),
    preflight: { identitySha256, beforeAccepted: true, afterAccepted: true, beforeHostSha256, afterHostSha256, beforeContainerSha256, afterContainerSha256 },
  };
  const measurements = { correctness: capture.correctness, latency: capture.latency, memory: {
    gcAvailable: capture.memory!.gcAvailable,
    gcRounds: capture.memory!.gcRounds,
    baselineRss: capture.memory!.baselineRss,
    afterRss: capture.memory!.afterRss,
    baselineHeapUsed: capture.memory!.baselineHeapUsed,
    afterHeapUsed: capture.memory!.afterHeapUsed,
    checkpoints: capture.memory!.checkpoints,
  }, controls: capture.controls };
  write("measurements.json", measurements);
  write("capture.json", capture);
  write("attempt.json", { schemaVersion: 1, id: `20260712T000000Z-${sourceCommit.slice(0, 7)}-a${suffix}`, attempt: Number(suffix), sourceCommit, startedAt: "2026-07-12T00:00:00Z", completedAt: "2026-07-12T00:00:01Z", status: "complete", phase: "complete" });
  return attemptRoot;
}

function expectRejected(name: string, mutate: (attemptRoot: string) => void, suffix: string): void {
  const attemptRoot = createAttempt(suffix);
  try {
    mutate(attemptRoot);
    let rejected = false;
    try { verifyQualificationAttempt(root, attemptRoot, sourceCommit); } catch { rejected = true; }
    if (!rejected) throw new Error(`FADENO_REVALIDATION_VERIFIER_MUTATION:${name}`);
  } finally {
    rmSync(attemptRoot, { recursive: true, force: true });
  }
}

const validRoot = createAttempt("90");
try {
  const evidence = verifyQualificationAttempt(root, validRoot, sourceCommit);
  if (evidence.captureSha256 !== sha256(readFileSync(join(validRoot, "capture.json"))) || verifyAndDeriveQualificationResult(root, validRoot, sourceCommit).decision.outcome !== "go") {
    throw new Error("FADENO_REVALIDATION_VERIFIER_CONTROL");
  }
} finally { rmSync(validRoot, { recursive: true, force: true }); }

expectRejected("inventory", (attemptRoot) => writeFileSync(join(attemptRoot, "extra.json"), "{}\n"), "91");
expectRejected("secret", (attemptRoot) => writeFileSync(join(attemptRoot, "measurements.json"), '{"password":"hunter2"}\n'), "92");
expectRejected("host-link", (attemptRoot) => writeFileSync(join(attemptRoot, "before-host.json"), "[]\n"), "93");
expectRejected("measurement-link", (attemptRoot) => writeFileSync(join(attemptRoot, "measurements.json"), "{}\n"), "94");
expectRejected("source", (attemptRoot) => {
  const capture = JSON.parse(readFileSync(join(attemptRoot, "capture.json"), "utf8")) as { sourceCommit: string };
  capture.sourceCommit = "0".repeat(40);
  writeFileSync(join(attemptRoot, "capture.json"), json(capture));
}, "95");
expectRejected("identity", (attemptRoot) => {
  const identityPath = join(attemptRoot, "identity.json");
  const identity = JSON.parse(readFileSync(identityPath, "utf8")) as { host: { cpuModel: string } };
  identity.host.cpuModel = "wrong";
  const identityBytes = json(identity);
  writeFileSync(identityPath, identityBytes);
  const capturePath = join(attemptRoot, "capture.json");
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as { preflight: { identitySha256: string } };
  capture.preflight.identitySha256 = sha256(identityBytes);
  writeFileSync(capturePath, json(capture));
}, "96");

console.log("revalidation qualification independent verifier passed (valid attempt + 6 coordinated mutations)");
