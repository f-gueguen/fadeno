import { compareResourceResults, resourceIdentityKey } from "../experiments/revalidation/benchmark.ts";
import {
  assertRevalidationHarnessReport,
  executeRevalidationHarness,
  type RevalidationHarnessReport,
} from "../experiments/revalidation/harness.ts";

const report = executeRevalidationHarness();
const repeated = executeRevalidationHarness();
assertRevalidationHarnessReport(report);
if (JSON.stringify(repeated) !== JSON.stringify(report)) throw new Error("FADENO_REVALIDATION_HARNESS_NONDETERMINISTIC");

const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
if (
  compareResourceResults(
    { status: "value", cacheable: true, value: { a: 1, b: 2 } },
    { status: "value", cacheable: true, value: { b: 2, a: 1 } },
  ) !== "equal" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: [1, 2] },
    { status: "value", cacheable: true, value: [2, 1] },
  ) !== "changed" ||
  compareResourceResults(
    { status: "expected-error", cacheable: true, code: "one" },
    { status: "expected-error", cacheable: true, code: "two" },
  ) !== "changed" ||
  compareResourceResults(
    { status: "value", cacheable: false, value: "one" },
    { status: "value", cacheable: false, value: "one" },
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: new Map([["key", "value"]]) },
    { status: "value", cacheable: true, value: new Map([["key", "value"]]) },
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: cyclic },
    { status: "value", cacheable: true, value: cyclic },
  ) !== "refused"
) throw new Error("FADENO_REVALIDATION_COMPARISON_CONTROLS");

let unsupportedInputRefused = false;
try {
  resourceIdentityKey("tasks", { unsupported: new Map() });
} catch (error: unknown) {
  unsupportedInputRefused = error instanceof Error && error.message === "FADENO_REVALIDATION_UNSUPPORTED_INPUT:tasks";
}
if (!unsupportedInputRefused) throw new Error("FADENO_REVALIDATION_INPUT_REFUSAL");

const failingReports: readonly RevalidationHarnessReport[] = [
  { ...report, deduplicationPass: false },
  { ...report, equivalentInputDeduplicationPass: false },
  { ...report, distinctInputIsolationPass: false },
  { ...report, observableMutationPass: false },
  { ...report, staleControlRejected: false },
  { ...report, unsafeKeepsDetected: 3 },
  { ...report, sensitiveValuesDisclosed: true },
];
for (const candidate of failingReports) {
  let rejected = false;
  try {
    assertRevalidationHarnessReport(candidate);
  } catch (error: unknown) {
    rejected = error instanceof Error && error.message.startsWith("FADENO_REVALIDATION_HARNESS:");
  }
  if (!rejected) throw new Error("FADENO_REVALIDATION_REPORT_MUTATION_ACCEPTED");
}

console.log("revalidation harness passed (10000 rows, input-aware 6/9 deduplicated reads, 4/4 resource-bound unsafe keeps)");
