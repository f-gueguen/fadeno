import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareResourceResults } from "../experiments/revalidation/benchmark.ts";
import { executeRevalidationHarness } from "../experiments/revalidation/harness.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = executeRevalidationHarness();
const repeated = executeRevalidationHarness();
if (
  report.rows !== 10_000 || report.uniqueResources !== 6 || report.pageReads !== 9 || report.duplicateReads !== 3 ||
  !report.deduplicationPass || !report.successPathPass || !report.failurePathPass ||
  !report.defaultRevalidationPass || !report.selectiveBaselinePass ||
  report.unsafeKeepsDetected !== 4 || report.unsafeKeepsTotal !== 4 || report.secretDisclosed
) throw new Error(`FADENO_REVALIDATION_HARNESS:${JSON.stringify(report)}`);
if (JSON.stringify(repeated) !== JSON.stringify(report)) throw new Error("FADENO_REVALIDATION_HARNESS_NONDETERMINISTIC");
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
  ) !== "refused"
) throw new Error("FADENO_REVALIDATION_COMPARISON_CONTROLS");
const manifests = JSON.parse(readFileSync(join(root, "experiments/revalidation/baseline-manifests.json"), "utf8"));
if (manifests.default.revalidates.length !== 6 || JSON.stringify(manifests.selective.revalidates) !== '["tasks"]' || manifests.selective.publicApi !== false) {
  throw new Error("FADENO_REVALIDATION_BASELINE_MANIFESTS");
}
console.log("revalidation harness passed (10000 rows, 6/9 deduplicated reads, 4/4 unsafe keeps)");
