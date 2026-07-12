import { executeQualificationMeasurements, type QualificationRunnerHooks, type QualificationRunnerProfile } from "../experiments/revalidation/qualification-runner.ts";
import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";

const schedule = loadQualificationSchedule();
const success = schedule.cycles.find((cycle) => cycle.path === "s")!;
const expectedError = schedule.cycles.find((cycle) => cycle.path === "e")!;
const smokeSchedule = { ...schedule, cycles: [success, expectedError, success, expectedError] };
const profile: QualificationRunnerProfile = {
  correctnessCycles: 4,
  latencyWarmups: 2,
  latencySamples: 4,
  memoryWarmups: 2,
  memoryCycles: 10,
  memoryCheckpointInterval: 1,
  gcRounds: 3,
  stabilizationTurnsPerRound: 3,
};
let clock = 0n;
const hooks: QualificationRunnerHooks = {
  now: () => { clock += 100n; return clock; },
  gc: () => {},
  stabilize: async () => {},
  memoryUsage: () => ({ rss: 1000, heapUsed: 500 }),
};
const measurements = await executeQualificationMeasurements(profile, hooks, smokeSchedule);
if (
  measurements.correctness.cycles.length !== 4 || measurements.correctness.cycles.some(({ stale }) => stale) ||
  measurements.latency.defaultNs.length !== 4 || measurements.latency.selectiveNs.length !== 4 ||
  measurements.latency.defaultNs.some((value) => value !== 100) || measurements.latency.selectiveNs.some((value) => value !== 100) ||
  measurements.memory.checkpoints.length !== 10 || measurements.memory.baselineRss !== 1000 || measurements.memory.afterRss !== 1000 ||
  measurements.controls.unsafeKeepsDetected !== 4 || measurements.controls.sensitiveValuesDisclosed
) throw new Error("FADENO_REVALIDATION_QUALIFICATION_RUNNER_SMOKE");
console.log("revalidation qualification runner passed (fresh paired state, complete output, GC/RSS smoke)");
