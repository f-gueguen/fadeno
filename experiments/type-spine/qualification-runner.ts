import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { TypeSpineInput } from "./contract.ts";
import { generateTypeSpine } from "./generator.ts";
import { QUALIFICATION_POLICY } from "./qualification-policy.ts";

const root = dirname(fileURLToPath(import.meta.url));
const sampleScript = join(root, "qualification-sample.ts");
const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");
const expected = {
  A: QUALIFICATION_POLICY.corpus.outputA,
  B: QUALIFICATION_POLICY.corpus.outputB,
} as const;

type Variant = keyof typeof expected;
type GeneratorObservation = { schemaVersion: 1; variant: Variant; replacements: number; sha256: string };
export type TimingSample = Readonly<{ round: number; cleanGeneratorNs: number; stockTscNs: number; incrementalGeneratorNs: number; incrementalVariant: "A-to-B" | "B-to-A" }>;
export type QualificationMetrics = Readonly<{
  cleanGeneratorP95Ns: number;
  stockTscP95Ns: number;
  incrementalGeneratorP95Ns: number;
  cleanGeneratorToTscRatio: number;
  incrementalToCleanRatio: number;
}>;
export type EnvironmentPhase = Readonly<{
  phase: "before-warmup" | "after-samples";
  host: readonly Readonly<{ cpuIdlePercent: number; loadAveragePerLogicalCpu: number; powerSource: string; thermalState: string }>[];
  container: Readonly<{ cpuThrottledRatio: number; oom: number; oomKill: number; pidsCurrent: number; networkDisabled: boolean }>;
}>;

function timedChild(args: readonly string[], cwd: string): { elapsedNs: number; stdout: string } {
  const started = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [...args], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const elapsedNs = Number(process.hrtime.bigint() - started);
  if (child.status !== 0 || child.signal || child.error || child.stderr !== "") {
    throw new Error(`FADENO_TYPE_SPINE_SAMPLE_CHILD:${child.status ?? child.signal}:${child.stderr}`);
  }
  return { elapsedNs, stdout: child.stdout };
}

function generatorSample(variant: Variant, output: string, cwd: string): { elapsedNs: number; observation: GeneratorObservation } {
  const child = timedChild(["--no-warnings", "--experimental-strip-types", sampleScript, "generator", variant, output], cwd);
  const observation = JSON.parse(child.stdout) as GeneratorObservation;
  if (observation.schemaVersion !== 1 || observation.variant !== variant || observation.replacements !== 1 || observation.sha256 !== expected[variant]) {
    throw new Error("FADENO_TYPE_SPINE_SAMPLE_GENERATOR_RESULT");
  }
  return { elapsedNs: child.elapsedNs, observation };
}

function tscSample(project: string, cwd: string): number {
  return timedChild([tsc, ...QUALIFICATION_POLICY.stockTypeScript.compilerArguments, join(project, "qualification-fixtures/valid.ts")], cwd).elapsedNs;
}

export function nearestRank95(values: readonly number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("FADENO_TYPE_SPINE_PERCENTILE_INPUT");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(0.95 * ordered.length) - 1]!;
}

export function projectQualificationDecision(gates: Readonly<Record<string, boolean>>, environmentValid: boolean): "go" | "narrow" | "pivot" | "inconclusive" {
  if (!environmentValid) return "inconclusive";
  const correctness = ["valid-consumers", "invalid-source-diagnostics", "byte-determinism", "stale-output", "stock-tsc", "stock-language-server"];
  if (correctness.some((gate) => gates[gate] !== true)) return "pivot";
  if (gates["clean-latency"] !== true || gates["incremental-latency"] !== true) return "narrow";
  return "go";
}

export function deriveQualificationMetrics(samples: readonly TimingSample[]): QualificationMetrics {
  if (samples.length !== 20 || samples.some((sample, index) => sample.round !== index || sample.incrementalVariant !== (index % 2 === 0 ? "A-to-B" : "B-to-A"))) {
    throw new Error("FADENO_TYPE_SPINE_RESULT_SAMPLE_SET");
  }
  const cleanGeneratorP95Ns = nearestRank95(samples.map(({ cleanGeneratorNs }) => cleanGeneratorNs));
  const stockTscP95Ns = nearestRank95(samples.map(({ stockTscNs }) => stockTscNs));
  const incrementalGeneratorP95Ns = nearestRank95(samples.map(({ incrementalGeneratorNs }) => incrementalGeneratorNs));
  return {
    cleanGeneratorP95Ns,
    stockTscP95Ns,
    incrementalGeneratorP95Ns,
    cleanGeneratorToTscRatio: cleanGeneratorP95Ns / stockTscP95Ns,
    incrementalToCleanRatio: incrementalGeneratorP95Ns / cleanGeneratorP95Ns,
  };
}

export function validateQualificationEnvironment(before: EnvironmentPhase, after: EnvironmentPhase): boolean {
  if (before.phase !== "before-warmup" || after.phase !== "after-samples") return false;
  for (const observation of [before, after]) {
    if (observation.host.length !== 3 || observation.host.some((sample) =>
      sample.cpuIdlePercent < 75 || sample.loadAveragePerLogicalCpu > 0.5 ||
      sample.powerSource !== "ac" || sample.thermalState !== "no-warning"
    )) return false;
    const container = observation.container;
    if (container.cpuThrottledRatio > 0.1 || container.oom !== 0 || container.oomKill !== 0 || container.pidsCurrent > 64 || !container.networkDisabled) return false;
  }
  return true;
}

function prepareProject(workspace: string, inputA: TypeSpineInput): string {
  const project = join(workspace, "project");
  generateTypeSpine(inputA, project);
  cpSync(join(root, "qualification-fixtures"), join(project, "qualification-fixtures"), { recursive: true });
  return project;
}

export function executeQualificationTimingRunner(profile: "smoke" | "qualification"): readonly TimingSample[] {
  const options = profile === "qualification"
    ? QUALIFICATION_POLICY.measurement
    : { warmups: 1, samples: 2 };
  const corpus = JSON.parse(readFileSync(join(root, "qualification-corpus.json"), "utf8")) as { inputA: TypeSpineInput; inputB: TypeSpineInput };
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "fadeno-type-spine-timing-"));
  try {
    const project = prepareProject(workspace, corpus.inputA);
    const incremental = join(workspace, "incremental");
    generateTypeSpine(corpus.inputA, incremental);
    const observations: TimingSample[] = [];
    const rounds = options.warmups + options.samples;
    let current: Variant = "A";
    for (let round = 0; round < rounds; round += 1) {
      if (round === options.warmups && current !== "A") {
        const reset = generateTypeSpine(corpus.inputA, incremental);
        if (reset.replacements !== 1) throw new Error("FADENO_TYPE_SPINE_TIMING_RESET");
        current = "A";
      }
      const clean = generatorSample("A", join(workspace, `clean-${round}`), workspace);
      const compilerNs = tscSample(project, workspace);
      const next: Variant = current === "A" ? "B" : "A";
      const incrementalSample = generatorSample(next, incremental, workspace);
      const sample: TimingSample = {
        round: round - options.warmups,
        cleanGeneratorNs: clean.elapsedNs,
        stockTscNs: compilerNs,
        incrementalGeneratorNs: incrementalSample.elapsedNs,
        incrementalVariant: current === "A" ? "A-to-B" : "B-to-A",
      };
      current = next;
      if (round >= options.warmups) observations.push(sample);
    }
    return observations;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function verifyQualificationTimingRunner(): void {
  const samples = executeQualificationTimingRunner("smoke");
  if (samples.length !== 2 || samples[0]?.incrementalVariant !== "A-to-B" || samples[1]?.incrementalVariant !== "B-to-A") {
    throw new Error("FADENO_TYPE_SPINE_TIMING_SCHEDULE");
  }
  if (nearestRank95([5, 1, 4, 2, 3]) !== 5 || projectQualificationDecision({
    "valid-consumers": true, "invalid-source-diagnostics": true, "byte-determinism": true,
    "stale-output": true, "stock-tsc": true, "stock-language-server": true,
    "clean-latency": false, "incremental-latency": true,
  }, true) !== "narrow") throw new Error("FADENO_TYPE_SPINE_TIMING_DERIVATION");
  console.log("type-spine timing runner passed (fresh children, interleaved A/B smoke schedule)");
}
