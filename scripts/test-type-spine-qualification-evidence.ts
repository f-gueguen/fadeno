import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyQualificationCapture, verifyQualificationResult } from "./lib/type-spine-qualification-evidence.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const host = () => ({ cpuIdlePercent: 80, loadAveragePerLogicalCpu: 0.4, powerSource: "ac", thermalState: "no-warning" });
const capture = {
  schemaVersion: 1,
  sourceCommit: "122ba574a5de78394ca375277c867378af0bd658",
  image: "node@sha256:663c09e4fd483fbcb2bb7297b3618061ac23f0a1925b0958db2ab734efad7c94",
  beforeHost: [host(), host(), host()], afterHost: [host(), host(), host()],
  beforeContainer: { nrPeriods: 100, nrThrottled: 2, oom: 0, oomKill: 0, pidsCurrent: 10, networkDisabled: true },
  afterContainer: { nrPeriods: 200, nrThrottled: 7, oom: 0, oomKill: 0, pidsCurrent: 10, networkDisabled: true },
  cpuThrottledRatio: 0.05,
  proof: [
    "type-spine qualification corpus passed (1000 routes, 800 parameterized, A:eb98472c8a9bfa5c1902fa2c127d0343be9e9dba27377453909441d26fbff421, B:3033291eb9cb6875ceca30b17e1fcc4829f9d86658af41ba5ceb3cde71da2037)",
    "type-spine qualification contract passed (5 warmups, 20 samples, no result)",
    "type-spine stock-tool controls passed (tsc + TypeScript 7 LSP, eb98472c8a9bfa5c1902fa2c127d0343be9e9dba27377453909441d26fbff421)",
    "type-spine timing runner passed (fresh children, interleaved A/B smoke schedule)",
    "type-spine qualification capability passed (no result or decision)",
  ].join("\n"),
  samples: Array.from({ length: 20 }, (_, round) => ({
    round, cleanGeneratorNs: 2000 + round, stockTscNs: 4000 + round,
    incrementalGeneratorNs: 1000 + round,
    incrementalVariant: round % 2 === 0 ? "A-to-B" : "B-to-A",
  })),
  toolchain: { node: "v22.14.0", pnpm: "11.7.0", typescript: "Version 7.0.2" },
};
const conclusion = verifyQualificationCapture(capture);
if (conclusion.decision !== "narrow") throw new Error("synthetic NARROW projection failed");
for (const mutate of [
  (value: typeof capture) => { value.sourceCommit = "0".repeat(40); },
  (value: typeof capture) => { value.beforeHost[0]!.cpuIdlePercent = 74; },
  (value: typeof capture) => { value.samples.pop(); },
  (value: typeof capture) => { value.samples[1]!.incrementalVariant = "A-to-B"; },
  (value: typeof capture) => { value.cpuThrottledRatio = 0.04; },
  (value: typeof capture) => { value.afterContainer.oomKill = 1; },
  (value: typeof capture) => { value.proof = "type-spine qualification capability passed (no result or decision)"; },
] as const) {
  const invalid = structuredClone(capture);
  mutate(invalid);
  try {
    verifyQualificationCapture(invalid);
    throw new Error("qualification evidence mutation accepted");
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "qualification evidence mutation accepted") throw error;
  }
}
const result = join(root, "experiments/type-spine/results/20260712T022123Z-122ba57-a1");
if (verifyQualificationResult(result).decision !== "narrow") throw new Error("immutable result rejected");
function rejectResultMutation<T>(file: string, mutate: (value: T) => void): void {
  const temporary = mkdtempSync(join(tmpdir(), "fadeno-type-spine-result-"));
  try {
    cpSync(result, temporary, { recursive: true });
    const path = join(temporary, file);
    const document = JSON.parse(readFileSync(path, "utf8")) as T;
    mutate(document);
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    try {
      verifyQualificationResult(temporary);
      throw new Error("qualification result mutation accepted");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "qualification result mutation accepted") throw error;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
rejectResultMutation<{ measurements: { incrementalToCleanRatio: number } }>(
  "manifest.json",
  (value) => { value.measurements.incrementalToCleanRatio = 0.2; },
);
rejectResultMutation<{ gates: Record<string, boolean> }>(
  "decision.json",
  (value) => { value.gates["incremental-latency"] = true; },
);
console.log("type-spine qualification evidence negative tests passed (7 capture + 2 result mutations)");
