import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node@sha256:663c09e4fd483fbcb2bb7297b3618061ac23f0a1925b0958db2ab734efad7c94";
const INPUT_KEYS = ["workload", "baselines", "schedule", "scheduleGolden", "dependencyLock"] as const;

type QualificationContract = Readonly<{
  environment: Readonly<{ path: string; sha256: string }>;
  inputs: Readonly<Record<(typeof INPUT_KEYS)[number], Readonly<{ path: string; sha256: string }>>>;
}>;
type HostSample = Readonly<{ cpuIdlePercent: number; loadAveragePerLogicalCpu: number; powerSource: "ac"; thermalState: "no-warning" }>;
type ContainerSample = Readonly<{ nrPeriods: number; nrThrottled: number; oom: number; oomKill: number; pidsCurrent: number; networkDisabled: boolean; memoryCurrent: number }>;

function command(file: string, args: readonly string[], cwd?: string): string {
  return execFileSync(file, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export function assertSafeRetainedText(text: string, sensitiveValues: readonly string[]): void {
  const secretPatterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|session(?:id|_id|[-_ ]?token)?)\s*[:=]\s*\S+/iu,
  ];
  if (sensitiveValues.some((value) => value.length > 0 && text.includes(value)) || secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("FADENO_REVALIDATION_RETAINED_SECRET");
  }
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

function hostSample(): HostSample {
  const top = command("top", ["-l", "2", "-n", "0", "-s", "1"]);
  const cpuLine = top.split("\n").filter((line) => line.includes("CPU usage:")).at(-1) ?? "";
  const idle = Number(/([0-9.]+)% idle/u.exec(cpuLine)?.[1]);
  const load = Number(/load averages?: ([0-9.]+)/u.exec(command("uptime", []))?.[1]);
  const power = command("pmset", ["-g", "batt"]);
  const thermal = command("pmset", ["-g", "therm"]);
  if (!Number.isFinite(idle) || !Number.isFinite(load) || !power.includes("AC Power") || !thermal.includes("No thermal warning level has been recorded")) {
    throw new Error("FADENO_REVALIDATION_HOST_OBSERVATION");
  }
  return { cpuIdlePercent: idle, loadAveragePerLogicalCpu: load / 10, powerSource: "ac", thermalState: "no-warning" };
}

function hostPhase(): readonly HostSample[] {
  return [hostSample(), hostSample(), hostSample()];
}

function hostAccepted(samples: readonly HostSample[]): boolean {
  return samples.length === 3 && samples.every((sample) => sample.cpuIdlePercent >= 75 && sample.loadAveragePerLogicalCpu <= 0.5);
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

function containerAccepted(before: ContainerSample, after: ContainerSample): boolean {
  const periods = after.nrPeriods - before.nrPeriods;
  const throttled = after.nrThrottled - before.nrThrottled;
  const throttledRatio = periods === 0 ? 0 : throttled / periods;
  return before.networkDisabled && after.networkDisabled && before.pidsCurrent <= 64 && after.pidsCurrent <= 64 &&
    throttledRatio <= 0.1 && after.oom - before.oom === 0 && after.oomKill - before.oomKill === 0;
}

export function runRevalidationReferenceQualification(
  repository: string,
  sourceCommit: string,
  startedAt: string,
  attempt: number,
): string {
  const runId = qualificationAttemptId(startedAt, sourceCommit, attempt);
  if (command("git", ["status", "--porcelain"], repository) !== "" || command("git", ["rev-parse", "--abbrev-ref", "HEAD"], repository) !== "main" || command("git", ["rev-parse", "HEAD"], repository) !== sourceCommit) {
    throw new Error("FADENO_REVALIDATION_SOURCE_IDENTITY");
  }
  const resultsRoot = resolve(repository, "experiments/revalidation/results");
  const attemptRoot = resolve(resultsRoot, runId);
  if (!attemptRoot.startsWith(`${resultsRoot}/`)) throw new Error("FADENO_REVALIDATION_ATTEMPT_PATH");
  mkdirSync(attemptRoot, { recursive: false });
  const workload = JSON.parse(readFileSync(join(repository, "experiments/revalidation/workload.json"), "utf8")) as { authentication: { secretCanary: string; principalId: string; tenantId: string } };
  const sensitiveValues = [workload.authentication.secretCanary, workload.authentication.principalId, workload.authentication.tenantId];
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
  safeWriteJson(join(attemptRoot, "attempt.json"), attemptRecord("launched", "allocated"), sensitiveValues);

  const temporary = mkdtempSync(join(tmpdir(), "fadeno-k010b-"));
  const container = `fadeno-k010b-${randomUUID()}`;
  let phase: "preflight" | "measurement" | "postflight" = "preflight";
  try {
    const contract = JSON.parse(readFileSync(join(repository, "experiments/revalidation/qualification-contract.json"), "utf8")) as QualificationContract;
    const inputs = inputRecords(contract);
    verifySourceInputs(repository, sourceCommit, inputs);
    if (command("docker", ["ps", "-aq", "--filter", "label=fadeno.qualification=h4"]) !== "") throw new Error("FADENO_REVALIDATION_COMPETING_CONTAINER");
    if (command("docker", ["image", "inspect", "--format", "{{.Id}}", IMAGE]) !== "sha256:cb36a58af87cd9b6203aa5fdc9493fe5d14500c7d52391e7e87d459e739dd770") {
      throw new Error("FADENO_REVALIDATION_IMAGE_IDENTITY");
    }
    const beforeHost = hostPhase();
    const beforeHostSha256 = safeWriteJson(join(attemptRoot, "before-host.json"), beforeHost, sensitiveValues);
    if (!hostAccepted(beforeHost)) throw new Error("FADENO_REVALIDATION_PREFLIGHT_INCONCLUSIVE");

    const archive = join(temporary, "source.tar");
    command("git", ["archive", "--format=tar", `--output=${archive}`, sourceCommit], repository);
    command("docker", ["create", "--name", container, "--label", "fadeno.qualification=h4", "--platform", "linux/arm64", "--cpus", "2", "--memory", "8192m", "--memory-swap", "8192m", "--pids-limit", "256", "--workdir", "/work", IMAGE, "sleep", "infinity"]);
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
    safeWriteJson(join(attemptRoot, "attempt.json"), attemptRecord("launched", "measurement"), sensitiveValues);
    const output = command("docker", ["exec", container, "node", "--expose-gc", "--no-warnings", "--experimental-strip-types", "/work/experiments/revalidation/qualification-entry.ts"]);
    assertSafeRetainedText(output, sensitiveValues);
    const line = output.split("\n").find((candidate) => candidate.startsWith("FADENO_H4_MEASUREMENTS="));
    if (!line) throw new Error("FADENO_REVALIDATION_MEASUREMENT_OUTPUT");
    const measurements = JSON.parse(line.slice("FADENO_H4_MEASUREMENTS=".length)) as Record<string, unknown>;
    safeWriteJson(join(attemptRoot, "measurements.json"), measurements, sensitiveValues);

    phase = "postflight";
    const afterContainer = cgroup(container);
    const afterContainerSha256 = safeWriteJson(join(attemptRoot, "after-container.json"), afterContainer, sensitiveValues);
    const afterHost = hostPhase();
    const afterHostSha256 = safeWriteJson(join(attemptRoot, "after-host.json"), afterHost, sensitiveValues);
    const environmentValid = hostAccepted(afterHost) && containerAccepted(beforeContainer, afterContainer);
    const memory = measurements.memory as Record<string, unknown>;
    memory.baselineCgroupMemory = beforeContainer.memoryCurrent;
    memory.afterCgroupMemory = afterContainer.memoryCurrent;
    const capture = {
      schemaVersion: 1,
      sourceCommit,
      environmentId: "k0-h4-local-docker-arm64-v1",
      status: environmentValid ? "complete" : "inconclusive",
      inputHashes: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.sha256])),
      preflight: { beforeAccepted: true, afterAccepted: environmentValid, beforeHostSha256, afterHostSha256, beforeContainerSha256, afterContainerSha256 },
      ...measurements,
      failures: environmentValid ? [] : [{ code: "FADENO_REVALIDATION_POSTFLIGHT_INCONCLUSIVE" }],
    };
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
    safeWriteJson(join(attemptRoot, "attempt.json"), attemptRecord("complete", "complete"), sensitiveValues);
    return attemptRoot;
  } catch (error: unknown) {
    const failureCode = error instanceof Error && /^FADENO_REVALIDATION_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "FADENO_REVALIDATION_LAUNCHER_FAILURE";
    safeWriteJson(join(attemptRoot, "attempt.json"), attemptRecord("inconclusive", phase, failureCode), sensitiveValues);
    throw new Error(failureCode);
  } finally {
    try { command("docker", ["rm", "-f", container]); } catch { /* best-effort cleanup */ }
    rmSync(temporary, { recursive: true, force: true });
  }
}

const [repository, sourceCommit, startedAt, attemptText] = process.argv.slice(2);
if (repository && sourceCommit && startedAt && attemptText) {
  process.stdout.write(`${runRevalidationReferenceQualification(repository, sourceCommit, startedAt, Number(attemptText))}\n`);
}
