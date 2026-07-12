import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveQualificationResult } from "../experiments/revalidation/qualification-proof.ts";
import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";
import { validQualificationCapture } from "./lib/revalidation-qualification-fixture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schedule = loadQualificationSchedule();
const zeroHash = "0".repeat(64);

const result = deriveQualificationResult(validQualificationCapture(schedule), schedule, zeroHash, true, true);
if (
  result.decision.outcome !== "go" || !result.decision.productDecision ||
  result.metrics.correctnessCycles !== 10_000 || result.metrics.staleCycles !== 0 ||
  result.metrics.deduplicationFailures !== 0 || result.metrics.defaultP95Ns !== 100 ||
  result.metrics.memoryGrowthRatio !== 0.05 || result.metrics.unsafeKeepDetectionRatio !== 1
) throw new Error(`FADENO_REVALIDATION_QUALIFICATION_PROOF:${JSON.stringify(result)}`);
console.log("revalidation qualification proof passed (raw derivation -> GO control)");

void readFileSync(join(root, "experiments/revalidation/qualification-result.schema.json"), "utf8");
