import { loadRevalidationWorkload, REVALIDATION_RESOURCE_IDS } from "./contract.ts";
import { compareResourceResults, completeTask, createState, renderPage, revalidateDefault, revalidateSelective, type ResourceResult } from "./benchmark.ts";

export type RevalidationHarnessReport = Readonly<{
  rows: number;
  uniqueResources: number;
  pageReads: number;
  duplicateReads: number;
  deduplicationPass: boolean;
  successPathPass: boolean;
  failurePathPass: boolean;
  defaultRevalidationPass: boolean;
  selectiveBaselinePass: boolean;
  unsafeKeepsDetected: number;
  unsafeKeepsTotal: number;
  diagnostics: readonly string[];
  secretDisclosed: boolean;
}>;

function allOnce(executions: Readonly<Record<string, number>>): boolean {
  return REVALIDATION_RESOURCE_IDS.every((id) => executions[id] === 1);
}

export function executeRevalidationHarness(): RevalidationHarnessReport {
  const workload = loadRevalidationWorkload();
  const state = createState(workload.dataset.rowCount);
  const auth = workload.authentication;
  const before = renderPage(state, auth, workload);
  const targetBefore = state.tasks[workload.mutation.rowId]?.completed;
  const success = completeTask(state, auth, workload.mutation.rowId);
  const afterDefault = revalidateDefault(state, auth, workload);
  const afterSelective = revalidateSelective(state, auth);
  const targetAfter = state.tasks[workload.mutation.rowId]?.completed;

  const failureState = createState(workload.dataset.rowCount);
  const revisionBeforeFailure = failureState.revision;
  const denied = completeTask(failureState, { ...auth, principalId: "unauthorized" }, workload.mutation.rowId);

  const diagnostics: string[] = [];
  const comparisons = new Map<string, readonly [ResourceResult, ResourceResult]>([
    ["value", [before.results.tasks, afterDefault.results.tasks]],
    ["expected-error", [before.results.permissions, { status: "expected-error", cacheable: true, code: "not-authorized" }]],
    ["ordering", [
      { status: "value", cacheable: true, value: [1, 2, 3] },
      { status: "value", cacheable: true, value: [3, 2, 1] },
    ]],
    ["non-cacheable", [before.results.activity, afterDefault.results.activity]],
  ]);
  for (const unsafe of workload.unsafeKeeps) {
    const pair = comparisons.get(unsafe.class);
    if (!pair) throw new Error(`FADENO_REVALIDATION_UNKNOWN_KEEP_CLASS:${unsafe.class}`);
    const comparison = compareResourceResults(pair[0], pair[1]);
    if (comparison === "changed" || comparison === "refused") diagnostics.push(`FADENO_REVALIDATION_UNSAFE_KEEP:${unsafe.id}:${unsafe.class}`);
  }

  const duplicateReads = workload.pageReads.length - new Set(workload.pageReads).size;
  const unchangedResources = ["notifications", "permissions", "profile", "projects"] as const;
  return {
    rows: state.tasks.length,
    uniqueResources: workload.resources.length,
    pageReads: workload.pageReads.length,
    duplicateReads,
    deduplicationPass: allOnce(before.executions) && allOnce(afterDefault.executions),
    successPathPass: success.status === "success" && targetBefore === false && targetAfter === true && state.revision === 1,
    failurePathPass: denied.status === "expected-error" && denied.code === "not-authorized" && failureState.revision === revisionBeforeFailure && failureState.tasks[workload.mutation.rowId]?.completed === false,
    defaultRevalidationPass:
      compareResourceResults(before.results.tasks, afterDefault.results.tasks) === "changed" &&
      unchangedResources.every((id) => compareResourceResults(before.results[id], afterDefault.results[id]) === "equal") &&
      REVALIDATION_RESOURCE_IDS.every((id) => afterDefault.results[id] !== undefined),
    selectiveBaselinePass:
      afterSelective.executions.tasks === 1 &&
      compareResourceResults(afterSelective.results.tasks, afterDefault.results.tasks) === "equal" &&
      REVALIDATION_RESOURCE_IDS.filter((id) => id !== "tasks").every((id) => afterSelective.executions[id] === 0),
    unsafeKeepsDetected: diagnostics.length,
    unsafeKeepsTotal: workload.unsafeKeeps.length,
    diagnostics,
    secretDisclosed: diagnostics.some((diagnostic) => diagnostic.includes(auth.secretCanary)),
  };
}
