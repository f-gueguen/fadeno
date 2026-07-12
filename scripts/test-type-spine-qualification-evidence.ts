import { verifyQualificationCapture } from "./lib/type-spine-qualification-evidence.ts";

const host = () => ({ cpuIdlePercent: 80, loadAveragePerLogicalCpu: 0.4, powerSource: "ac", thermalState: "no-warning" });
const capture = {
  schemaVersion: 1,
  sourceCommit: "122ba574a5de78394ca375277c867378af0bd658",
  image: "node@sha256:663c09e4fd483fbcb2bb7297b3618061ac23f0a1925b0958db2ab734efad7c94",
  beforeHost: [host(), host(), host()], afterHost: [host(), host(), host()],
  beforeContainer: { nrPeriods: 100, nrThrottled: 2, oom: 0, oomKill: 0, pidsCurrent: 10, networkDisabled: true },
  afterContainer: { nrPeriods: 200, nrThrottled: 7, oom: 0, oomKill: 0, pidsCurrent: 10, networkDisabled: true },
  cpuThrottledRatio: 0.05,
  proof: `${"proof ".repeat(20)}type-spine qualification capability passed (no result or decision)`,
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
console.log("type-spine qualification evidence negative tests passed (6 mutations)");
