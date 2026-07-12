import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE = "122ba574a5de78394ca375277c867378af0bd658";
const IMAGE = "node@sha256:663c09e4fd483fbcb2bb7297b3618061ac23f0a1925b0958db2ab734efad7c94";

function command(file: string, args: readonly string[], options: { cwd?: string } = {}): string {
  return execFileSync(file, [...args], { cwd: options.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

type HostSample = Readonly<{ cpuIdlePercent: number; loadAveragePerLogicalCpu: number; powerSource: "ac"; thermalState: "no-warning" }>;

function hostSample(): HostSample {
  const top = command("top", ["-l", "2", "-n", "0", "-s", "1"]);
  const cpuLine = top.split("\n").filter((line) => line.includes("CPU usage:")).at(-1) ?? "";
  const idle = Number(/([0-9.]+)% idle/u.exec(cpuLine)?.[1]);
  const uptime = command("uptime", []);
  const load = Number(/load averages?: ([0-9.]+)/u.exec(uptime)?.[1]);
  const power = command("pmset", ["-g", "batt"]);
  const thermal = command("pmset", ["-g", "therm"]);
  if (!Number.isFinite(idle) || !Number.isFinite(load) || !power.includes("AC Power") || !thermal.includes("No thermal warning level has been recorded")) {
    throw new Error("FADENO_TYPE_SPINE_HOST_OBSERVATION");
  }
  return { cpuIdlePercent: idle, loadAveragePerLogicalCpu: load / 10, powerSource: "ac", thermalState: "no-warning" };
}

function hostPhase(): readonly HostSample[] {
  return [hostSample(), hostSample(), hostSample()];
}

function hostPass(samples: readonly HostSample[]): boolean {
  return samples.length === 3 && samples.every((sample) => sample.cpuIdlePercent >= 75 && sample.loadAveragePerLogicalCpu <= 0.5);
}

type Cgroup = Readonly<{ nrPeriods: number; nrThrottled: number; oom: number; oomKill: number; pidsCurrent: number; networkDisabled: boolean }>;

function cgroup(container: string): Cgroup {
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
  };
}

function assertHost(samples: readonly HostSample[]): void {
  if (!hostPass(samples)) throw new Error(`FADENO_TYPE_SPINE_PREFLIGHT_INCONCLUSIVE:${JSON.stringify(samples)}`);
}

export function runReferenceQualification(repository: string, output: string): void {
  if (command("git", ["status", "--porcelain"], { cwd: repository }) !== "") throw new Error("FADENO_TYPE_SPINE_SOURCE_DIRTY");
  if (command("git", ["rev-parse", "main"], { cwd: repository }) !== SOURCE) throw new Error("FADENO_TYPE_SPINE_SOURCE_COMMIT");
  const beforeHost = hostPhase();
  assertHost(beforeHost);
  const temporary = mkdtempSync(join(tmpdir(), "fadeno-k008b-"));
  const container = `fadeno-k008b-${randomUUID()}`;
  try {
    const archive = join(temporary, "source.tar");
    command("git", ["archive", "--format=tar", `--output=${archive}`, SOURCE], { cwd: repository });
    command("docker", ["create", "--name", container, "--platform", "linux/arm64", "--cpus", "2", "--memory", "8192m", "--memory-swap", "8192m", "--pids-limit", "256", "--workdir", "/work", IMAGE, "sleep", "infinity"]);
    command("docker", ["start", container]);
    command("docker", ["exec", container, "mkdir", "-p", "/work"]);
    command("docker", ["cp", archive, `${container}:/tmp/source.tar`]);
    command("docker", ["exec", container, "tar", "-xf", "/tmp/source.tar", "-C", "/work"]);
    command("docker", ["exec", container, "corepack", "enable"]);
    command("docker", ["exec", container, "corepack", "prepare", "pnpm@11.7.0", "--activate"]);
    command("docker", ["exec", container, "pnpm", "install", "--frozen-lockfile"]);
    command("docker", ["network", "disconnect", "bridge", container]);
    const beforeContainer = cgroup(container);
    const proof = command("docker", ["exec", container, "pnpm", "experiment:type-spine", "--", "--verify-qualification"]);
    const invocation = join(temporary, "run.mjs");
    writeFileSync(invocation, 'import { executeQualificationTimingRunner } from "/work/experiments/type-spine/qualification-runner.ts";\nprocess.stdout.write(`FADENO_SAMPLES=${JSON.stringify(executeQualificationTimingRunner("qualification"))}\\n`);\n');
    command("docker", ["cp", invocation, `${container}:/tmp/run.mjs`]);
    const measurement = command("docker", ["exec", container, "node", "--no-warnings", "--experimental-strip-types", "/tmp/run.mjs"]);
    const sampleLine = measurement.split("\n").find((line) => line.startsWith("FADENO_SAMPLES="));
    if (!sampleLine) throw new Error("FADENO_TYPE_SPINE_SAMPLE_OUTPUT");
    const samples = JSON.parse(sampleLine.slice("FADENO_SAMPLES=".length)) as unknown;
    const afterContainer = cgroup(container);
    const afterHost = hostPhase();
    assertHost(afterHost);
    const periods = afterContainer.nrPeriods - beforeContainer.nrPeriods;
    const throttled = afterContainer.nrThrottled - beforeContainer.nrThrottled;
    const cpuThrottledRatio = periods === 0 ? 0 : throttled / periods;
    const environmentValid = beforeContainer.networkDisabled && afterContainer.networkDisabled &&
      beforeContainer.pidsCurrent <= 64 && afterContainer.pidsCurrent <= 64 && cpuThrottledRatio <= 0.1 &&
      afterContainer.oom - beforeContainer.oom === 0 && afterContainer.oomKill - beforeContainer.oomKill === 0;
    if (!environmentValid) throw new Error("FADENO_TYPE_SPINE_POSTFLIGHT_INCONCLUSIVE");
    writeFileSync(output, `${JSON.stringify({
      schemaVersion: 1,
      sourceCommit: SOURCE,
      image: IMAGE,
      beforeHost,
      afterHost,
      beforeContainer,
      afterContainer,
      cpuThrottledRatio,
      proof,
      samples,
      toolchain: {
        node: command("docker", ["exec", container, "node", "--version"]),
        pnpm: command("docker", ["exec", container, "pnpm", "--version"]),
        typescript: command("docker", ["exec", container, "pnpm", "exec", "tsc", "--version"]),
      },
    }, null, 2)}\n`);
  } finally {
    try { command("docker", ["rm", "-f", container]); } catch { /* best-effort cleanup */ }
    rmSync(temporary, { recursive: true, force: true });
  }
}

const [repository, output] = process.argv.slice(2);
if (!repository || !output) throw new Error("usage: run-type-spine-reference-qualification.ts <repository> <output>");
runReferenceQualification(repository, output);
