import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertQualificationAttemptDocument,
  assertQualificationCaptureDocument,
  assertReferenceIdentityDocument,
} from "./lib/revalidation-qualification-validation.ts";
import {
  referenceIdentityAccepted,
  type ReferenceEnvironmentIdentity,
  type ReferenceIdentityObservation,
} from "../experiments/revalidation/reference-identity.ts";
import { assertSafeRetainedText } from "./lib/revalidation-retained-text.ts";

export { assertSafeRetainedText } from "./lib/revalidation-retained-text.ts";

const IMAGE = "node@sha256:663c09e4fd483fbcb2bb7297b3618061ac23f0a1925b0958db2ab734efad7c94";
const INPUT_KEYS = ["workload", "baselines", "schedule", "scheduleGolden", "dependencyLock"] as const;

type QualificationContract = Readonly<{
  environment: Readonly<{ path: string; sha256: string }>;
  inputs: Readonly<Record<(typeof INPUT_KEYS)[number], Readonly<{ path: string; sha256: string }>>>;
}>;
type ReferenceEnvironment = ReferenceEnvironmentIdentity & Readonly<{
  container: Readonly<{ runtimeImage: string; configDigest: string; platform: string; cpuLimit: number; memoryMiB: number; memorySwapMiB: number; pidsLimit: number; workingDirectory: string }>;
  preflight: Readonly<{ hostSamples: number; minimumCpuIdlePercent: number; maximumLoadAveragePerLogicalCpu: number; containerProcessLimit: number; maximumCpuThrottledRatio: number; requiredOomDelta: number; requiredOomKillDelta: number }>;
}>;
type HostSample = Readonly<{ cpuIdlePercent: number; loadAveragePerLogicalCpu: number; powerSource: "ac"; thermalState: "no-warning" }>;
type ContainerSample = Readonly<{ nrPeriods: number; nrThrottled: number; oom: number; oomKill: number; pidsCurrent: number; networkDisabled: boolean; memoryCurrent: number }>;

function command(file: string, args: readonly string[], cwd?: string): string {
  return execFileSync(file, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function safeWriteJson(path: string, value: unknown, sensitiveValues: readonly string[]): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertSafeRetainedText(text, sensitiveValues);
  writeFileSync(path, text);
  return sha256(text);
}

export function qualificationAttemptId(startedAt: string, sourceCommit: string, attempt: number): string {
  const timestamp = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/u.exec(startedAt);
  if (!timestamp || !/^[a-f0-9]{40}$/u.test(sourceCommit) || !Number.isInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new Error("FADENO_REVALIDATION_ATTEMPT_ID");
  }
  return `${timestamp[1]}${timestamp[2]}${timestamp[3]}T${timestamp[4]}${timestamp[5]}${timestamp[6]}Z-${sourceCommit.slice(0, 7)}-a${attempt}`;
}

export function nextQualificationAttempt(resultsRoot: string): number {
  const attempts = readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => Number(/-a([1-9][0-9]*)$/u.exec(entry.name)?.[1]))
    .filter(Number.isSafeInteger);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}

function hostSample(logicalCpuCount: number): HostSample {
  const top = command("top", ["-l", "2", "-n", "0", "-s", "1"]);
  const cpuLine = top.split("\n").filter((line) => line.includes("CPU usage:")).at(-1) ?? "";
  const idle = Number(/([0-9.]+)% idle/u.exec(cpuLine)?.[1]);
  const load = Number(/load averages?: ([0-9.]+)/u.exec(command("uptime", []))?.[1]);
  const power = command("pmset", ["-g", "batt"]);
  const thermal = command("pmset", ["-g", "therm"]);
  if (!Number.isFinite(idle) || !Number.isFinite(load) || !power.includes("AC Power") || !thermal.includes("No thermal warning level has been recorded")) {
    throw new Error("FADENO_REVALIDATION_HOST_OBSERVATION");
  }
  return { cpuIdlePercent: idle, loadAveragePerLogicalCpu: load / logicalCpuCount, powerSource: "ac", thermalState: "no-warning" };
}

function hostPhase(sampleCount: number, logicalCpuCount: number): readonly HostSample[] {
  return Array.from({ length: sampleCount }, () => hostSample(logicalCpuCount));
}

function hostAccepted(samples: readonly HostSample[], reference: ReferenceEnvironment): boolean {
  return samples.length === reference.preflight.hostSamples && samples.every((sample) =>
    sample.cpuIdlePercent >= reference.preflight.minimumCpuIdlePercent &&
    sample.loadAveragePerLogicalCpu <= reference.preflight.maximumLoadAveragePerLogicalCpu);
}

function observeReferenceIdentity(environmentId: string): ReferenceIdentityObservation {
  const dockerVersion = JSON.parse(command("docker", ["version", "--format", "{{json .}}"] )) as {
    Server: { Platform: { Name: string }; Version: string; ApiVersion: string; Os: string; Arch: string; KernelVersion: string };
  };
  const dockerInfo = JSON.parse(command("docker", ["info", "--format", "{{json .}}"] )) as { NCPU: number; MemTotal: number };
  const desktopVersion = /Docker Desktop ([0-9.]+)/u.exec(dockerVersion.Server.Platform.Name)?.[1];
  if (!desktopVersion) throw new Error("FADENO_REVALIDATION_IDENTITY_OBSERVATION");
  return {
    schemaVersion: 1,
    environmentId,
    host: {
      operatingSystemVersion: command("sw_vers", ["-productVersion"]),
      buildVersion: command("sw_vers", ["-buildVersion"]),
      kernelVersion: command("uname", ["-r"]),
      architecture: command("uname", ["-m"]),
      cpuModel: command("sysctl", ["-n", "machdep.cpu.brand_string"]),
      logicalCpuCount: Number(command("sysctl", ["-n", "hw.logicalcpu"])),
      memoryMiB: Math.floor(Number(command("sysctl", ["-n", "hw.memsize"])) / 1024 / 1024),
      freeStorageMiB: Number(command("df", ["-Pm", "."]).split("\n").at(-1)?.trim().split(/\s+/u)[3]),
    },
    docker: {
      desktopVersion,
      engineVersion: dockerVersion.Server.Version,
      apiVersion: dockerVersion.Server.ApiVersion,
      operatingSystem: dockerVersion.Server.Os,
      architecture: dockerVersion.Server.Arch,
      kernelVersion: dockerVersion.Server.KernelVersion,
      cpuCount: dockerInfo.NCPU,
      memoryMiB: Math.floor(dockerInfo.MemTotal / 1024 / 1024),
    },
  };
}

function cgroup(container: string): ContainerSample {
  const cpu = command("docker", ["exec", container, "cat", "/sys/fs/cgroup/cpu.stat"]);
  const memory = command("docker", ["exec", container, "cat", "/sys/fs/cgroup/memory.events"]);
  const value = (text: string, key: string) => Number(new RegExp(`^${key} ([0-9]+)$`, "mu").exec(text)?.[1]);
  const networks = JSON.parse(command("docker", ["inspect", "--format", "{{json .NetworkSettings.Networks}}", container])) as Record<string, unknown>;
  return {
    nrPeriods: value(cpu, "nr_periods"),
    nrThrottled: value(cpu, "nr_throttled"),
    oom: value(memory, "oom"),
    oomKill: value(memory, "oom_kill"),
    pidsCurrent: Number(command("docker", ["exec", container, "cat", "/sys/fs/cgroup/pids.current"])),
    networkDisabled: Object.keys(networks).length === 0,
    memoryCurrent: Number(command("docker", ["exec", container, "cat", "/sys/fs/cgroup/memory.current"])),
  };
}

function inputRecords(contract: QualificationContract): Readonly<Record<string, Readonly<{ path: string; sha256: string }>>> {
  return { environment: contract.environment, ...contract.inputs };
}

function verifySourceInputs(repository: string, sourceCommit: string, inputs: ReturnType<typeof inputRecords>): void {
  for (const { path, sha256: expected } of Object.values(inputs)) {
    const bytes = execFileSync("git", ["show", `${sourceCommit}:${path}`], { cwd: repository, encoding: null, maxBuffer: 4 * 1024 * 1024 });
    if (sha256(bytes) !== expected) throw new Error("FADENO_REVALIDATION_SOURCE_INPUT");
  }
}

function verifyContainerInputs(container: string, inputs: ReturnType<typeof inputRecords>): void {
  for (const { path, sha256: expected } of Object.values(inputs)) {
    const actual = command("docker", ["exec", container, "sha256sum", `/work/${path}`]).split(/\s+/u)[0];
    if (actual !== expected) throw new Error("FADENO_REVALIDATION_CONTAINER_INPUT");
  }
}

function containerAccepted(before: ContainerSample, after: ContainerSample, reference: ReferenceEnvironment): boolean {
  const periods = after.nrPeriods - before.nrPeriods;
  const throttled = after.nrThrottled - before.nrThrottled;
  const throttledRatio = periods === 0 ? 0 : throttled / periods;
  return before.networkDisabled && after.networkDisabled &&
    before.pidsCurrent <= reference.preflight.containerProcessLimit && after.pidsCurrent <= reference.preflight.containerProcessLimit &&
    throttledRatio <= reference.preflight.maximumCpuThrottledRatio &&
    after.oom - before.oom === reference.preflight.requiredOomDelta &&
    after.oomKill - before.oomKill === reference.preflight.requiredOomKillDelta;
}

export function runRevalidationReferenceQualification(
  repository: string,
  sourceCommit: string,
  startedAt: string,
  attempt: number,
): string {
  const runId = qualificationAttemptId(startedAt, sourceCommit, attempt);
  if (command("git", ["remote", "get-url", "origin"], repository) !== "https://github.com/f-gueguen/fadeno.git") {
    throw new Error("FADENO_REVALIDATION_SOURCE_REMOTE");
  }
  const remoteMain = command("git", ["ls-remote", "--exit-code", "origin", "refs/heads/main"], repository).split(/\s+/u)[0];
  if (remoteMain !== sourceCommit || command("git", ["status", "--porcelain"], repository) !== "" || command("git", ["rev-parse", "--abbrev-ref", "HEAD"], repository) !== "main" || command("git", ["rev-parse", "HEAD"], repository) !== sourceCommit) {
    throw new Error("FADENO_REVALIDATION_SOURCE_IDENTITY");
  }
  const resultsRoot = resolve(repository, "experiments/revalidation/results");
  if (attempt !== nextQualificationAttempt(resultsRoot)) throw new Error("FADENO_REVALIDATION_ATTEMPT_SEQUENCE");
  const attemptRoot = resolve(resultsRoot, runId);
  if (!attemptRoot.startsWith(`${resultsRoot}/`)) throw new Error("FADENO_REVALIDATION_ATTEMPT_PATH");
  mkdirSync(attemptRoot, { recursive: false });
  let sensitiveValues: readonly string[] = [];
  const attemptRecord = (status: "launched" | "complete" | "inconclusive", phase: "allocated" | "preflight" | "measurement" | "postflight" | "complete", failureCode?: string) => ({
    schemaVersion: 1,
    id: runId,
    attempt,
    sourceCommit,
    startedAt,
    ...(status === "launched" ? {} : { completedAt: new Date().toISOString() }),
    status,
    phase,
    ...(failureCode ? { failureCode } : {}),
  });
  const writeAttempt = (status: "launched" | "complete" | "inconclusive", phase: "allocated" | "preflight" | "measurement" | "postflight" | "complete", failureCode?: string) => {
    const document = attemptRecord(status, phase, failureCode);
    assertQualificationAttemptDocument(repository, document);
    safeWriteJson(join(attemptRoot, "attempt.json"), document, sensitiveValues);
  };
  let temporary: string | undefined;
  let container: string | undefined;
  let phase: "allocated" | "preflight" | "measurement" | "postflight" = "allocated";
  try {
    temporary = mkdtempSync(join(tmpdir(), "fadeno-k010b-"));
    container = `fadeno-k010b-${randomUUID()}`;
    const workload = JSON.parse(readFileSync(join(repository, "experiments/revalidation/workload.json"), "utf8")) as { authentication: { secretCanary: string; principalId: string; tenantId: string } };
    sensitiveValues = [workload.authentication.secretCanary, workload.authentication.principalId, workload.authentication.tenantId];
    writeAttempt("launched", "allocated");
    phase = "preflight";
    const contract = JSON.parse(readFileSync(join(repository, "experiments/revalidation/qualification-contract.json"), "utf8")) as QualificationContract;
    const inputs = inputRecords(contract);
    verifySourceInputs(repository, sourceCommit, inputs);
    const reference = JSON.parse(readFileSync(join(repository, contract.environment.path), "utf8")) as ReferenceEnvironment;
    const identity = observeReferenceIdentity(reference.id);
    assertReferenceIdentityDocument(repository, identity);
    const identitySha256 = safeWriteJson(join(attemptRoot, "identity.json"), identity, sensitiveValues);
    if (!referenceIdentityAccepted(reference, identity)) throw new Error("FADENO_REVALIDATION_REFERENCE_IDENTITY");
    if (command("docker", ["ps", "-aq", "--filter", "label=fadeno.qualification=h4"]) !== "") throw new Error("FADENO_REVALIDATION_COMPETING_CONTAINER");
    if (reference.container.runtimeImage !== IMAGE || command("docker", ["image", "inspect", "--format", "{{.Id}}", IMAGE]) !== reference.container.configDigest) {
      throw new Error("FADENO_REVALIDATION_IMAGE_IDENTITY");
    }
    const beforeHost = hostPhase(reference.preflight.hostSamples, reference.host.logicalCpuCount);
    const beforeHostSha256 = safeWriteJson(join(attemptRoot, "before-host.json"), beforeHost, sensitiveValues);
    if (!hostAccepted(beforeHost, reference)) throw new Error("FADENO_REVALIDATION_PREFLIGHT_INCONCLUSIVE");

    const archive = join(temporary, "source.tar");
    command("git", ["archive", "--format=tar", `--output=${archive}`, sourceCommit], repository);
    command("docker", ["create", "--name", container, "--label", "fadeno.qualification=h4", "--platform", reference.container.platform, "--cpus", String(reference.container.cpuLimit), "--memory", `${reference.container.memoryMiB}m`, "--memory-swap", `${reference.container.memorySwapMiB}m`, "--pids-limit", String(reference.container.pidsLimit), "--workdir", reference.container.workingDirectory, IMAGE, "sleep", "infinity"]);
    command("docker", ["start", container]);
    command("docker", ["cp", archive, `${container}:/tmp/source.tar`]);
    command("docker", ["exec", container, "tar", "-xf", "/tmp/source.tar", "-C", "/work"]);
    command("docker", ["exec", container, "corepack", "enable"]);
    command("docker", ["exec", container, "corepack", "prepare", "pnpm@11.7.0", "--activate"]);
    command("docker", ["exec", container, "pnpm", "install", "--frozen-lockfile"]);
    command("docker", ["network", "disconnect", "bridge", container]);
    verifyContainerInputs(container, inputs);
    const beforeContainer = cgroup(container);
    const beforeContainerSha256 = safeWriteJson(join(attemptRoot, "before-container.json"), beforeContainer, sensitiveValues);

    phase = "measurement";
    writeAttempt("launched", "measurement");
    const output = command("docker", ["exec", container, "node", "--expose-gc", "--no-warnings", "--experimental-strip-types", "/work/experiments/revalidation/qualification-entry.ts"]);
    assertSafeRetainedText(output, sensitiveValues);
    const line = output.split("\n").find((candidate) => candidate.startsWith("FADENO_H4_MEASUREMENTS="));
    if (!line) throw new Error("FADENO_REVALIDATION_MEASUREMENT_OUTPUT");
    const measurements = JSON.parse(line.slice("FADENO_H4_MEASUREMENTS=".length)) as Record<string, unknown>;
    safeWriteJson(join(attemptRoot, "measurements.json"), measurements, sensitiveValues);

    phase = "postflight";
    const afterContainer = cgroup(container);
    const afterContainerSha256 = safeWriteJson(join(attemptRoot, "after-container.json"), afterContainer, sensitiveValues);
    const afterHost = hostPhase(reference.preflight.hostSamples, reference.host.logicalCpuCount);
    const afterHostSha256 = safeWriteJson(join(attemptRoot, "after-host.json"), afterHost, sensitiveValues);
    const environmentValid = hostAccepted(afterHost, reference) && containerAccepted(beforeContainer, afterContainer, reference);
    const memory = measurements.memory as Record<string, unknown>;
    memory.baselineCgroupMemory = beforeContainer.memoryCurrent;
    memory.afterCgroupMemory = afterContainer.memoryCurrent;
    const capture = {
      schemaVersion: 1,
      sourceCommit,
      environmentId: "k0-h4-local-docker-arm64-v1",
      status: environmentValid ? "complete" : "inconclusive",
      inputHashes: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.sha256])),
      preflight: { identitySha256, beforeAccepted: true, afterAccepted: environmentValid, beforeHostSha256, afterHostSha256, beforeContainerSha256, afterContainerSha256 },
      ...measurements,
      failures: environmentValid ? [] : [{ code: "FADENO_REVALIDATION_POSTFLIGHT_INCONCLUSIVE" }],
    };
    assertQualificationCaptureDocument(repository, capture);
    safeWriteJson(join(attemptRoot, "capture.json"), capture, sensitiveValues);
    if (!environmentValid) throw new Error("FADENO_REVALIDATION_POSTFLIGHT_INCONCLUSIVE");
    const statusPaths = command("git", ["status", "--porcelain"], repository)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
    if (
      command("git", ["rev-parse", "HEAD"], repository) !== sourceCommit ||
      statusPaths.some((path) => !path.startsWith(`experiments/revalidation/results/${runId}/`))
    ) {
      throw new Error("FADENO_REVALIDATION_SOURCE_CHANGED");
    }
    writeAttempt("complete", "complete");
    return attemptRoot;
  } catch (error: unknown) {
    const failureCode = error instanceof Error && /^FADENO_REVALIDATION_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "FADENO_REVALIDATION_LAUNCHER_FAILURE";
    writeAttempt("inconclusive", phase, failureCode);
    throw new Error(failureCode);
  } finally {
    if (container) try { command("docker", ["rm", "-f", container]); } catch { /* best-effort cleanup */ }
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

const [repository, sourceCommit, startedAt, attemptText] = process.argv.slice(2);
if (repository && sourceCommit && startedAt && attemptText) {
  process.stdout.write(`${runRevalidationReferenceQualification(repository, sourceCommit, startedAt, Number(attemptText))}\n`);
}
