import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  completeTask,
  composeSelectivePage,
  createState,
  materializePage,
  pageOutputDigest,
  renderPage,
  revalidateDefault,
  revalidateSelective,
  type PageObservation,
  type SelectiveObservation,
} from "./benchmark.ts";
import {
  loadRevalidationBaselines,
  loadRevalidationWorkload,
  REVALIDATION_RESOURCE_IDS,
  type RevalidationBaselines,
  type RevalidationWorkload,
} from "./contract.ts";
import { assertRevalidationHarnessReport, executeRevalidationHarness } from "./harness.ts";
import type { QualificationCycle, QualificationSchedule } from "./qualification-schedule.ts";

export type QualificationCycleRecord = Readonly<{
  id: string;
  path: "s" | "e";
  readOrder: string;
  beforeDigest: string;
  defaultDigest: string;
  selectiveDigest: string;
  defaultExecutions: string;
  selectiveExecutions: string;
  defaultActionStatus: "success" | "expected-error";
  selectiveActionStatus: "success" | "expected-error";
  stateIsolated: boolean;
  stale: boolean;
}>;

export type QualificationMeasurements = Readonly<{
  correctness: Readonly<{ cycles: readonly QualificationCycleRecord[] }>;
  latency: Readonly<{ defaultNs: readonly number[]; selectiveNs: readonly number[]; outputsMatch: true }>;
  memory: Readonly<{
    gcAvailable: true;
    gcRounds: 3;
    baselineRss: number;
    afterRss: number;
    baselineHeapUsed: number;
    afterHeapUsed: number;
    checkpoints: readonly number[];
  }>;
  controls: Readonly<{ unsafeKeepsDetected: 4; unsafeKeepsTotal: 4; comparisonPass: true; sensitiveValuesDisclosed: false }>;
}>;

export type QualificationRunnerProfile = Readonly<{
  correctnessCycles: number;
  latencyWarmups: number;
  latencySamples: number;
  memoryWarmups: number;
  memoryCycles: number;
  memoryCheckpointInterval: number;
  gcRounds: 3;
  stabilizationTurnsPerRound: 3;
}>;

export type QualificationRunnerHooks = Readonly<{
  now: () => bigint;
  gc?: () => void;
  stabilize: () => Promise<void>;
  memoryUsage: () => Readonly<{ rss: number; heapUsed: number }>;
}>;

export const QUALIFICATION_RUNNER_PROFILE: QualificationRunnerProfile = {
  correctnessCycles: 10_000,
  latencyWarmups: 100,
  latencySamples: 1_000,
  memoryWarmups: 100,
  memoryCycles: 10_000,
  memoryCheckpointInterval: 1_000,
  gcRounds: 3,
  stabilizationTurnsPerRound: 3,
};

const root = dirname(fileURLToPath(import.meta.url));

export function loadQualificationSchedule(): QualificationSchedule {
  return JSON.parse(readFileSync(join(root, "qualification-schedule.json"), "utf8")) as QualificationSchedule;
}

function orderedWorkload(workload: RevalidationWorkload, order: string): RevalidationWorkload {
  const pageReads = [...order].map((index) => workload.pageReads[Number(index)]!);
  return { ...workload, pageReads };
}

function executionSignature(observation: Readonly<{ executions: Readonly<Record<string, number>> }>): string {
  return REVALIDATION_RESOURCE_IDS.map((resource) => observation.executions[resource] ?? 0).join("");
}

function digest(page: PageObservation): string {
  return pageOutputDigest(materializePage(page));
}

function correctnessCycle(
  cycle: QualificationCycle,
  schedule: QualificationSchedule,
  workload: RevalidationWorkload,
  baselines: RevalidationBaselines,
): QualificationCycleRecord {
  const ordered = orderedWorkload(workload, cycle.readOrder);
  const defaultState = createState(workload.dataset.rowCount);
  const selectiveState = createState(workload.dataset.rowCount);
  const defaultBefore = renderPage(defaultState, workload.authentication, ordered);
  const selectiveBefore = renderPage(selectiveState, workload.authentication, ordered);
  const stateIsolated = defaultState !== selectiveState;
  const actionAuth = cycle.path === "s"
    ? workload.authentication
    : { ...workload.authentication, principalId: "unauthorized" };
  const defaultAction = completeTask(defaultState, actionAuth, workload.mutation.rowId);
  const selectiveAction = completeTask(selectiveState, actionAuth, workload.mutation.rowId);
  const defaultAfter = cycle.path === "s"
    ? revalidateDefault(defaultState, workload.authentication, ordered, baselines)
    : defaultBefore;
  const selectiveObservation: SelectiveObservation = cycle.path === "s"
    ? revalidateSelective(selectiveState, workload.authentication, ordered, baselines)
    : {
        results: {},
        executions: Object.fromEntries(REVALIDATION_RESOURCE_IDS.map((resource) => [resource, 0])) as Record<typeof REVALIDATION_RESOURCE_IDS[number], number>,
      };
  const selectiveAfter = cycle.path === "s"
    ? composeSelectivePage(selectiveBefore, selectiveObservation)
    : selectiveBefore;
  const expectedDigest = cycle.expectedDigest === "s" ? schedule.outputDigests.success : schedule.outputDigests.before;
  const beforeDigest = digest(defaultBefore);
  const selectiveBeforeDigest = digest(selectiveBefore);
  const defaultDigest = digest(defaultAfter);
  const selectiveDigest = digest(selectiveAfter);
  const expectedAction = cycle.path === "s" ? "success" : "expected-error";
  const defaultExecutions = cycle.path === "s" ? executionSignature(defaultAfter) : "000000";
  const selectiveExecutions = cycle.path === "s" ? executionSignature(selectiveObservation) : "000000";
  const stale =
    beforeDigest !== schedule.outputDigests.before ||
    selectiveBeforeDigest !== schedule.outputDigests.before ||
    defaultDigest !== expectedDigest ||
    selectiveDigest !== expectedDigest ||
    defaultAction.status !== expectedAction ||
    selectiveAction.status !== expectedAction ||
    defaultExecutions !== (cycle.path === "s" ? "111111" : "000000") ||
    selectiveExecutions !== (cycle.path === "s" ? "000001" : "000000") ||
    !stateIsolated;
  return {
    id: cycle.id,
    path: cycle.path,
    readOrder: cycle.readOrder,
    beforeDigest,
    defaultDigest,
    selectiveDigest,
    defaultExecutions,
    selectiveExecutions,
    defaultActionStatus: defaultAction.status,
    selectiveActionStatus: selectiveAction.status,
    stateIsolated,
    stale,
  };
}

function prepareLatencyPath(workload: RevalidationWorkload): Readonly<{ state: ReturnType<typeof createState>; before: PageObservation }> {
  const state = createState(workload.dataset.rowCount);
  return { state, before: renderPage(state, workload.authentication, workload) };
}

function measureLatencyPath(
  mode: "default" | "selective",
  workload: RevalidationWorkload,
  baselines: RevalidationBaselines,
  hooks: QualificationRunnerHooks,
): Readonly<{ elapsedNs: number; outputDigest: string }> {
  const prepared = prepareLatencyPath(workload);
  const started = hooks.now();
  const action = completeTask(prepared.state, workload.authentication, workload.mutation.rowId);
  if (action.status !== "success") throw new Error("FADENO_REVALIDATION_QUALIFICATION_LATENCY_ACTION");
  const page = mode === "default"
    ? revalidateDefault(prepared.state, workload.authentication, workload, baselines)
    : composeSelectivePage(prepared.before, revalidateSelective(prepared.state, workload.authentication, workload, baselines));
  const output = materializePage(page);
  const elapsedNs = Number(hooks.now() - started);
  if (!Number.isSafeInteger(elapsedNs) || elapsedNs <= 0) throw new Error("FADENO_REVALIDATION_QUALIFICATION_LATENCY_CLOCK");
  return { elapsedNs, outputDigest: pageOutputDigest(output) };
}

function runLatency(
  workload: RevalidationWorkload,
  baselines: RevalidationBaselines,
  profile: QualificationRunnerProfile,
  hooks: QualificationRunnerHooks,
  expectedSuccessDigest: string,
): QualificationMeasurements["latency"] {
  const defaultNs: number[] = [];
  const selectiveNs: number[] = [];
  const runRound = (round: number, record: boolean) => {
    const order: readonly ("default" | "selective")[] = round % 2 === 0
      ? ["default", "selective"]
      : ["selective", "default"];
    for (const mode of order) {
      const measured = measureLatencyPath(mode, workload, baselines, hooks);
      if (measured.outputDigest !== expectedSuccessDigest) {
        throw new Error("FADENO_REVALIDATION_QUALIFICATION_LATENCY_OUTPUT");
      }
      if (record) (mode === "default" ? defaultNs : selectiveNs).push(measured.elapsedNs);
    }
  };
  for (let round = 0; round < profile.latencyWarmups; round += 1) runRound(round, false);
  for (let round = 0; round < profile.latencySamples; round += 1) runRound(round, true);
  return { defaultNs, selectiveNs, outputsMatch: true };
}

function executeMemoryCycle(workload: RevalidationWorkload, baselines: RevalidationBaselines): void {
  const state = createState(workload.dataset.rowCount);
  const before = renderPage(state, workload.authentication, workload);
  const action = completeTask(state, workload.authentication, workload.mutation.rowId);
  if (action.status !== "success") throw new Error("FADENO_REVALIDATION_QUALIFICATION_MEMORY_ACTION");
  materializePage(revalidateDefault(state, workload.authentication, workload, baselines));
  void before;
}

async function forceCleanup(profile: QualificationRunnerProfile, hooks: QualificationRunnerHooks): Promise<void> {
  if (!hooks.gc) throw new Error("FADENO_REVALIDATION_QUALIFICATION_GC_REQUIRED");
  for (let round = 0; round < profile.gcRounds; round += 1) {
    hooks.gc();
    for (let turn = 0; turn < profile.stabilizationTurnsPerRound; turn += 1) await hooks.stabilize();
  }
}

async function runMemory(
  workload: RevalidationWorkload,
  baselines: RevalidationBaselines,
  profile: QualificationRunnerProfile,
  hooks: QualificationRunnerHooks,
): Promise<QualificationMeasurements["memory"]> {
  for (let cycle = 0; cycle < profile.memoryWarmups; cycle += 1) executeMemoryCycle(workload, baselines);
  await forceCleanup(profile, hooks);
  const baseline = hooks.memoryUsage();
  const checkpoints: number[] = [];
  for (let cycle = 1; cycle <= profile.memoryCycles; cycle += 1) {
    executeMemoryCycle(workload, baselines);
    if (cycle % profile.memoryCheckpointInterval === 0) checkpoints.push(hooks.memoryUsage().rss);
  }
  await forceCleanup(profile, hooks);
  const after = hooks.memoryUsage();
  return {
    gcAvailable: true,
    gcRounds: 3,
    baselineRss: baseline.rss,
    afterRss: after.rss,
    baselineHeapUsed: baseline.heapUsed,
    afterHeapUsed: after.heapUsed,
    checkpoints,
  };
}

export async function executeQualificationMeasurements(
  profile: QualificationRunnerProfile = QUALIFICATION_RUNNER_PROFILE,
  hooks: QualificationRunnerHooks = {
    now: () => process.hrtime.bigint(),
    gc: globalThis.gc,
    stabilize: () => new Promise((resolve) => setImmediate(resolve)),
    memoryUsage: () => process.memoryUsage(),
  },
  schedule: QualificationSchedule = loadQualificationSchedule(),
): Promise<QualificationMeasurements> {
  if (profile.correctnessCycles > schedule.cycles.length) throw new Error("FADENO_REVALIDATION_QUALIFICATION_SCHEDULE_SHORT");
  const workload = loadRevalidationWorkload();
  const baselines = loadRevalidationBaselines();
  const correctness = {
    cycles: schedule.cycles.slice(0, profile.correctnessCycles).map((cycle) => correctnessCycle(cycle, schedule, workload, baselines)),
  };
  const latency = runLatency(workload, baselines, profile, hooks, schedule.outputDigests.success);
  const memory = await runMemory(workload, baselines, profile, hooks);
  const harness = executeRevalidationHarness();
  assertRevalidationHarnessReport(harness);
  return {
    correctness,
    latency,
    memory,
    controls: {
      unsafeKeepsDetected: 4,
      unsafeKeepsTotal: 4,
      comparisonPass: true,
      sensitiveValuesDisclosed: false,
    },
  };
}
