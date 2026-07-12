import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  completeTask,
  compareResourceResults,
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
import { executeRevalidationHarness } from "./harness.ts";
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
  latency: Readonly<{
    defaultNs: readonly number[];
    selectiveNs: readonly number[];
    rounds: readonly Readonly<{ round: number; firstPath: "default" | "selective"; defaultNs: number; selectiveNs: number; defaultOutputDigest: string; selectiveOutputDigest: string }>[];
    outputsMatch: boolean;
  }>;
  memory: Readonly<{
    gcAvailable: true;
    gcRounds: 3;
    baselineRss: number;
    afterRss: number;
    baselineHeapUsed: number;
    afterHeapUsed: number;
    checkpoints: readonly number[];
  }>;
  controls: Readonly<{ unsafeKeepsDetected: number; unsafeKeepsTotal: number; comparisonPass: boolean; sensitiveValuesDisclosed: boolean }>;
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
  completeAction?: typeof completeTask;
}>;

const root = dirname(fileURLToPath(import.meta.url));

type QualificationPolicyDocument = Readonly<{
  correctness: Readonly<{ cycles: number }>;
  latency: Readonly<{ warmupsPerPath: number; samplesPerPath: number }>;
  memory: Readonly<{
    warmupCycles: number;
    measuredCycles: number;
    checkpointInterval: number;
    gc: Readonly<{ rounds: 3; stabilizationTurnsPerRound: 3 }>;
  }>;
}>;

export function loadQualificationRunnerProfile(): QualificationRunnerProfile {
  const policy = JSON.parse(readFileSync(join(root, "qualification-contract.json"), "utf8")) as QualificationPolicyDocument;
  if (policy.memory.gc.rounds !== 3 || policy.memory.gc.stabilizationTurnsPerRound !== 3) {
    throw new Error("FADENO_REVALIDATION_QUALIFICATION_GC_POLICY");
  }
  return {
    correctnessCycles: policy.correctness.cycles,
    latencyWarmups: policy.latency.warmupsPerPath,
    latencySamples: policy.latency.samplesPerPath,
    memoryWarmups: policy.memory.warmupCycles,
    memoryCycles: policy.memory.measuredCycles,
    memoryCheckpointInterval: policy.memory.checkpointInterval,
    gcRounds: policy.memory.gc.rounds,
    stabilizationTurnsPerRound: policy.memory.gc.stabilizationTurnsPerRound,
  };
}

export const QUALIFICATION_RUNNER_PROFILE: QualificationRunnerProfile = loadQualificationRunnerProfile();

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
  hooks: QualificationRunnerHooks,
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
  const action = hooks.completeAction ?? completeTask;
  const defaultAction = action(defaultState, actionAuth, workload.mutation.rowId);
  const selectiveAction = action(selectiveState, actionAuth, workload.mutation.rowId);
  const defaultAfter = cycle.path === "s"
    ? revalidateDefault(defaultState, workload.authentication, ordered, baselines)
    : renderPage(defaultState, workload.authentication, ordered);
  const selectiveObservation: SelectiveObservation = cycle.path === "s"
    ? revalidateSelective(selectiveState, workload.authentication, ordered, baselines)
    : {
        results: {},
        executions: Object.fromEntries(REVALIDATION_RESOURCE_IDS.map((resource) => [resource, 0])) as Record<typeof REVALIDATION_RESOURCE_IDS[number], number>,
      };
  const selectiveAfter = cycle.path === "s"
    ? composeSelectivePage(selectiveBefore, selectiveObservation)
    : renderPage(selectiveState, workload.authentication, ordered);
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
  const action = (hooks.completeAction ?? completeTask)(prepared.state, workload.authentication, workload.mutation.rowId);
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
  const rounds: Array<QualificationMeasurements["latency"]["rounds"][number]> = [];
  const runRound = (round: number, record: boolean) => {
    const order: readonly ("default" | "selective")[] = round % 2 === 0
      ? ["default", "selective"]
      : ["selective", "default"];
    const measuredRound: Partial<Record<"default" | "selective", Readonly<{ elapsedNs: number; outputDigest: string }>>> = {};
    for (const mode of order) {
      const measured = measureLatencyPath(mode, workload, baselines, hooks);
      if (measured.outputDigest !== expectedSuccessDigest) {
        throw new Error("FADENO_REVALIDATION_QUALIFICATION_LATENCY_OUTPUT");
      }
      measuredRound[mode] = measured;
      if (record) (mode === "default" ? defaultNs : selectiveNs).push(measured.elapsedNs);
    }
    if (record) rounds.push({
      round,
      firstPath: order[0],
      defaultNs: measuredRound.default!.elapsedNs,
      selectiveNs: measuredRound.selective!.elapsedNs,
      defaultOutputDigest: measuredRound.default!.outputDigest,
      selectiveOutputDigest: measuredRound.selective!.outputDigest,
    });
  };
  for (let round = 0; round < profile.latencyWarmups; round += 1) runRound(round, false);
  for (let round = 0; round < profile.latencySamples; round += 1) runRound(round, true);
  const outputsMatch = rounds.every((round) => round.defaultOutputDigest === round.selectiveOutputDigest);
  return { defaultNs, selectiveNs, rounds, outputsMatch };
}

function executeMemoryCycle(workload: RevalidationWorkload, baselines: RevalidationBaselines, hooks: QualificationRunnerHooks): void {
  const state = createState(workload.dataset.rowCount);
  const before = renderPage(state, workload.authentication, workload);
  const action = (hooks.completeAction ?? completeTask)(state, workload.authentication, workload.mutation.rowId);
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
  for (let cycle = 0; cycle < profile.memoryWarmups; cycle += 1) executeMemoryCycle(workload, baselines, hooks);
  await forceCleanup(profile, hooks);
  const baseline = hooks.memoryUsage();
  const checkpoints: number[] = [];
  for (let cycle = 1; cycle <= profile.memoryCycles; cycle += 1) {
    executeMemoryCycle(workload, baselines, hooks);
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
  // Measure RSS before retaining the O(cycles) correctness and latency evidence.
  // Otherwise those prior allocations can inflate the baseline and mask growth.
  const memory = await runMemory(workload, baselines, profile, hooks);
  const correctness = {
    cycles: schedule.cycles.slice(0, profile.correctnessCycles).map((cycle) => correctnessCycle(cycle, schedule, workload, baselines, hooks)),
  };
  const latency = runLatency(workload, baselines, profile, hooks, schedule.outputDigests.success);
  const harness = executeRevalidationHarness();
  return {
    correctness,
    latency,
    memory,
    controls: {
      unsafeKeepsDetected: harness.unsafeKeepsDetected,
      unsafeKeepsTotal: harness.unsafeKeepsTotal,
      comparisonPass:
        harness.equivalentInputValuePass && harness.distinctInputValuePass && harness.staleControlRejected &&
        harness.diagnostics.some((diagnostic) => diagnostic.includes(":value")) &&
        harness.diagnostics.some((diagnostic) => diagnostic.includes(":expected-error")) &&
        harness.diagnostics.some((diagnostic) => diagnostic.includes(":ordering")) &&
        harness.diagnostics.some((diagnostic) => diagnostic.includes(":non-cacheable")) &&
        compareResourceResults(
          { status: "value", cacheable: true, value: new Map([["unsupported", true]]) },
          { status: "value", cacheable: true, value: new Map([["unsupported", true]]) },
        ) === "refused",
      sensitiveValuesDisclosed: harness.sensitiveValuesDisclosed,
    },
  };
}
