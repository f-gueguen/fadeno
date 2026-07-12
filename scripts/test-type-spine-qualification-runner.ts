import { nearestRank95, projectQualificationDecision } from "../experiments/type-spine/qualification-runner.ts";

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
console.log("type-spine qualification runner derivation tests passed (4 decisions + nearest-rank p95)");
