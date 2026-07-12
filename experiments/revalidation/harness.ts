import { loadRevalidationBaselines, loadRevalidationWorkload, REVALIDATION_RESOURCE_IDS } from "./contract.ts";
import {
  buildUnsafeKeepsControls,
  compareResourceResults,
  completeTask,
  createState,
  observableTaskTarget,
  renderPage,
  RequestScope,
  resourceIdentityKey,
  revalidateDefault,
  revalidateSelective,
  type ResourceResult,
} from "./benchmark.ts";

export type RevalidationHarnessReport = Readonly<{
  rows: number;
  uniqueResources: number;
  pageReads: number;
  duplicateReads: number;
  deduplicationPass: boolean;
  equivalentInputDeduplicationPass: boolean;
  equivalentInputValuePass: boolean;
  distinctInputIsolationPass: boolean;
  distinctInputValuePass: boolean;
  successPathPass: boolean;
  observableMutationPass: boolean;
  staleControlRejected: boolean;
  failurePathPass: boolean;
  defaultRevalidationPass: boolean;
  selectiveBaselinePass: boolean;
  unsafeKeepsDetected: number;
  unsafeKeepsTotal: number;
  diagnostics: readonly string[];
  sensitiveValuesDisclosed: boolean;
}>;

function allOnce(executions: Readonly<Record<string, number>>): boolean {
  return REVALIDATION_RESOURCE_IDS.every((id) => executions[id] === 1);
}

function observableTaskTransition(before: ResourceResult | undefined, after: ResourceResult | undefined): boolean {
  return observableTaskTarget(before) === false && observableTaskTarget(after) === true;
}

export function assertRevalidationHarnessReport(report: RevalidationHarnessReport): void {
  const authentication = loadRevalidationWorkload().authentication;
  const sensitiveValues = [authentication.secretCanary, authentication.principalId, authentication.tenantId];
  const diagnosticDisclosure = report.diagnostics.some((diagnostic) => sensitiveValues.some((value) => diagnostic.includes(value)));
  if (
    report.rows !== 10_000 || report.uniqueResources !== 6 || report.pageReads !== 9 || report.duplicateReads !== 3 ||
    !report.deduplicationPass || !report.equivalentInputDeduplicationPass || !report.equivalentInputValuePass ||
    !report.distinctInputIsolationPass || !report.distinctInputValuePass ||
    !report.successPathPass || !report.observableMutationPass || !report.staleControlRejected || !report.failurePathPass ||
    !report.defaultRevalidationPass || !report.selectiveBaselinePass ||
    report.unsafeKeepsDetected !== 4 || report.unsafeKeepsTotal !== 4 || report.sensitiveValuesDisclosed || diagnosticDisclosure
  ) throw new Error("FADENO_REVALIDATION_HARNESS_FAILED");
}

export function executeRevalidationHarness(): RevalidationHarnessReport {
  const workload = loadRevalidationWorkload();
  const baselines = loadRevalidationBaselines();
  const state = createState(workload.dataset.rowCount);
  const auth = workload.authentication;
  const before = renderPage(state, auth, workload);
  const targetBefore = observableTaskTarget(before.results.tasks);
  const success = completeTask(state, auth, workload.mutation.rowId);
  const afterDefault = revalidateDefault(state, auth, workload, baselines);
  const afterSelective = revalidateSelective(state, auth, workload, baselines);
  const targetAfter = observableTaskTarget(afterDefault.results.tasks);

  const staleCandidate: ResourceResult = {
    status: "value",
    cacheable: true,
    value: { completed: workload.dataset.rowCount, target: false },
  };

  const identityState = createState(workload.dataset.rowCount);
  const identityScope = new RequestScope(identityState, auth);
  const [equivalentLeft, equivalentRight] = workload.identityControls.equivalentInputs;
  const equivalentLeftResult = identityScope.read(workload.identityControls.resource, equivalentLeft);
  const equivalentRightResult = identityScope.read(workload.identityControls.resource, equivalentRight);
  const equivalentExecutions = identityScope.executions()[workload.identityControls.resource];
  const distinctResult = identityScope.read(workload.identityControls.resource, workload.identityControls.distinctInput);
  const distinctExecutions = identityScope.executions()[workload.identityControls.resource];

  const failureState = createState(workload.dataset.rowCount);
  const revisionBeforeFailure = failureState.revision;
  const denied = completeTask(failureState, { ...auth, principalId: "unauthorized" }, workload.mutation.rowId);

  const diagnostics: string[] = [];
  const comparisons = buildUnsafeKeepsControls(workload);
  for (const unsafe of workload.unsafeKeeps) {
    const pair = comparisons.get(unsafe.declaredResource);
    if (!pair) throw new Error(`FADENO_REVALIDATION_UNKNOWN_KEEP_RESOURCE:${unsafe.declaredResource}`);
    const comparison = compareResourceResults(pair[0], pair[1]);
    if (comparison === "changed" || comparison === "refused") diagnostics.push(`FADENO_REVALIDATION_UNSAFE_KEEP:${unsafe.id}:${unsafe.class}`);
  }

  const duplicateReads = workload.pageReads.length - new Set(
    workload.pageReads.map(({ resource, input }) => resourceIdentityKey(resource, input)),
  ).size;
  const unchangedResources = ["notifications", "permissions", "profile", "projects"] as const;
  const sensitiveValues = [auth.secretCanary, auth.principalId, auth.tenantId];
  return {
    rows: state.tasks.length,
    uniqueResources: workload.resources.length,
    pageReads: workload.pageReads.length,
    duplicateReads,
    deduplicationPass: allOnce(before.executions) && allOnce(afterDefault.executions),
    equivalentInputDeduplicationPass: equivalentExecutions === 1,
    equivalentInputValuePass: compareResourceResults(equivalentLeftResult, equivalentRightResult) === "equal",
    distinctInputIsolationPass: distinctExecutions === 2,
    distinctInputValuePass: compareResourceResults(equivalentLeftResult, distinctResult) === "changed",
    successPathPass: success.status === "success" && targetBefore === false && targetAfter === true && state.revision === 1,
    observableMutationPass:
      observableTaskTransition(before.results.tasks, afterDefault.results.tasks) &&
      observableTaskTransition(before.results.tasks, afterSelective.results.tasks),
    staleControlRejected: !observableTaskTransition(before.results.tasks, staleCandidate),
    failurePathPass: denied.status === "expected-error" && denied.code === "not-authorized" && failureState.revision === revisionBeforeFailure && observableTaskTarget(renderPage(failureState, auth, workload).results.tasks) === false,
    defaultRevalidationPass:
      compareResourceResults(before.results.tasks, afterDefault.results.tasks) === "changed" &&
      unchangedResources.every((id) => compareResourceResults(before.results[id], afterDefault.results[id]) === "equal") &&
      REVALIDATION_RESOURCE_IDS.every((id) => afterDefault.results[id] !== undefined),
    selectiveBaselinePass:
      afterSelective.executions.tasks === 1 &&
      afterSelective.results.tasks !== undefined &&
      compareResourceResults(afterSelective.results.tasks, afterDefault.results.tasks) === "equal" &&
      REVALIDATION_RESOURCE_IDS.filter((id) => id !== "tasks").every((id) => afterSelective.executions[id] === 0),
    unsafeKeepsDetected: diagnostics.length,
    unsafeKeepsTotal: workload.unsafeKeeps.length,
    diagnostics,
    sensitiveValuesDisclosed: diagnostics.some((diagnostic) => sensitiveValues.some((value) => diagnostic.includes(value))),
  };
}
