import { deriveQualificationMetrics, nearestRank95, projectQualificationDecision, validateQualificationEnvironment, type EnvironmentPhase } from "../experiments/type-spine/qualification-runner.ts";

const nonPerformance = {
  "valid-consumers": true,
  "invalid-source-diagnostics": true,
  "byte-determinism": true,
  "stale-output": true,
  "stock-tsc": true,
  "stock-language-server": true,
};
const all = { ...nonPerformance, "clean-latency": true, "incremental-latency": true };
if (nearestRank95(Array.from({ length: 20 }, (_, index) => index + 1)) !== 19) {
  throw new Error("nearest-rank p95 drifted");
}
if (projectQualificationDecision(all, true) !== "go") throw new Error("GO projection drifted");
if (projectQualificationDecision({ ...all, "incremental-latency": false }, true) !== "narrow") throw new Error("NARROW projection drifted");
if (projectQualificationDecision({ ...all, "stock-tsc": false }, true) !== "pivot") throw new Error("PIVOT projection drifted");
if (projectQualificationDecision(all, false) !== "inconclusive") throw new Error("inconclusive projection drifted");
const synthetic = Array.from({ length: 20 }, (_, round) => ({
  round,
  cleanGeneratorNs: (round + 1) * 100,
  stockTscNs: (round + 1) * 200,
  incrementalGeneratorNs: (round + 1) * 10,
  incrementalVariant: (round % 2 === 0 ? "A-to-B" : "B-to-A") as "A-to-B" | "B-to-A",
}));
const metrics = deriveQualificationMetrics(synthetic);
if (metrics.cleanGeneratorP95Ns !== 1900 || metrics.stockTscP95Ns !== 3800 || metrics.incrementalGeneratorP95Ns !== 190 || metrics.cleanGeneratorToTscRatio !== 0.5 || metrics.incrementalToCleanRatio !== 0.1) {
  throw new Error("result projection drifted");
}
const phase = (name: EnvironmentPhase["phase"]): EnvironmentPhase => ({
  phase: name,
  host: Array.from({ length: 3 }, () => ({ cpuIdlePercent: 80, loadAveragePerLogicalCpu: 0.4, powerSource: "ac", thermalState: "no-warning" })),
  container: { cpuThrottledRatio: 0.05, oom: 0, oomKill: 0, pidsCurrent: 10, networkDisabled: true },
});
const before = phase("before-warmup");
const after = phase("after-samples");
if (!validateQualificationEnvironment(before, after)) throw new Error("valid environment rejected");
if (validateQualificationEnvironment(before, { ...after, container: { ...after.container, oomKill: 1 } })) throw new Error("invalid environment accepted");
console.log("type-spine qualification runner derivation tests passed (environment + 4 decisions + exact result projection)");
