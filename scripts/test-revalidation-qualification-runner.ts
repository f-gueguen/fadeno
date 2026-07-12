import { executeQualificationMeasurements, type QualificationRunnerHooks, type QualificationRunnerProfile } from "../experiments/revalidation/qualification-runner.ts";
import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";
import { completeTask } from "../experiments/revalidation/benchmark.ts";

const profile: QualificationRunnerProfile = {
  correctnessCycles: 1,
  latencyWarmups: 0,
  latencySamples: 1,
  memoryWarmups: 0,
  memoryCycles: 1,
  memoryCheckpointInterval: 1,
  gcRounds: 3,
  stabilizationTurnsPerRound: 3,
};
let clock = 0n;
const baseHooks: QualificationRunnerHooks = {
  now: () => { clock += 1n; return clock; },
  stabilize: async () => {},
  memoryUsage: () => ({ rss: 1, heapUsed: 1 }),
};
let gcRefused = false;
try {
  await executeQualificationMeasurements(profile, baseHooks, { ...loadQualificationSchedule(), cycles: [loadQualificationSchedule().cycles[0]!] });
} catch (error: unknown) {
  gcRefused = error instanceof Error && error.message === "FADENO_REVALIDATION_QUALIFICATION_GC_REQUIRED";
}
if (!gcRefused) throw new Error("FADENO_REVALIDATION_QUALIFICATION_MISSING_GC_ACCEPTED");

let shortScheduleRefused = false;
try {
  await executeQualificationMeasurements({ ...profile, correctnessCycles: 2 }, { ...baseHooks, gc: () => {} }, { ...loadQualificationSchedule(), cycles: [loadQualificationSchedule().cycles[0]!] });
} catch (error: unknown) {
  shortScheduleRefused = error instanceof Error && error.message === "FADENO_REVALIDATION_QUALIFICATION_SCHEDULE_SHORT";
}
if (!shortScheduleRefused) throw new Error("FADENO_REVALIDATION_QUALIFICATION_SHORT_SCHEDULE_ACCEPTED");

const deniedCycle = loadQualificationSchedule().cycles.find((cycle) => cycle.path === "e")!;
const mutatingDenied = await executeQualificationMeasurements(profile, {
  ...baseHooks,
  gc: () => {},
  completeAction: (state, auth, rowId) => {
    const result = completeTask(state, auth, rowId);
    if (result.status === "expected-error") {
      state.tasks[rowId]!.completed = true;
      state.revision += 1;
    }
    return result;
  },
}, { ...loadQualificationSchedule(), cycles: [deniedCycle] });
if (!mutatingDenied.correctness.cycles[0]!.stale) throw new Error("FADENO_REVALIDATION_QUALIFICATION_DENIED_MUTATION_ACCEPTED");
console.log("revalidation qualification runner negative tests passed (GC + schedule + denied mutation refusal)");
