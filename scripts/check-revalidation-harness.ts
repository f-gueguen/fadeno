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
const symbolLeft = { visible: true };
const symbolRight = { visible: true, [Symbol("hidden")]: true };
const nonEnumerable = { visible: true };
Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false });
const accessor: Record<string, unknown> = {};
Object.defineProperty(accessor, "value", { get: () => true, enumerable: true });
const sparse = Array(1);
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
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: symbolLeft },
    { status: "value", cacheable: true, value: symbolRight },
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: { visible: true } },
    { status: "value", cacheable: true, value: nonEnumerable },
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: [] },
    { status: "value", cacheable: true, value: sparse },
  ) !== "refused" ||
  compareResourceResults(
    { status: "value", cacheable: true, value: { value: true } },
    { status: "value", cacheable: true, value: accessor },
  ) !== "refused"
) throw new Error("FADENO_REVALIDATION_COMPARISON_CONTROLS");

for (const input of [
  { unsupported: new Map() },
  symbolRight,
  nonEnumerable,
  accessor,
  { unsupported: sparse },
]) {
  let unsupportedInputRefused = false;
  try {
    resourceIdentityKey("tasks", input);
  } catch (error: unknown) {
    unsupportedInputRefused = error instanceof Error && error.message === "FADENO_REVALIDATION_UNSUPPORTED_INPUT:tasks";
  }
  if (!unsupportedInputRefused) throw new Error("FADENO_REVALIDATION_INPUT_REFUSAL");
}

const failingReports: readonly RevalidationHarnessReport[] = [
  { ...report, deduplicationPass: false },
  { ...report, equivalentInputDeduplicationPass: false },
  { ...report, equivalentInputValuePass: false },
  { ...report, distinctInputIsolationPass: false },
  { ...report, distinctInputValuePass: false },
  { ...report, observableMutationPass: false },
  { ...report, staleControlRejected: false },
  { ...report, unsafeKeepsDetected: 3 },
  { ...report, sensitiveValuesDisclosed: true },
  { ...report, diagnostics: [...report.diagnostics, "injected:fadeno-auth-secret-must-not-escape"], sensitiveValuesDisclosed: false },
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
