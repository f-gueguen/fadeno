import { isDeepStrictEqual } from "node:util";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { deriveQualificationResult } from "../experiments/revalidation/qualification-proof.ts";
import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";
import { assertQualificationAttemptDocument, assertQualificationCaptureDocument } from "./lib/revalidation-qualification-validation.ts";
import { verifyQualificationAttempt } from "./lib/revalidation-qualification-verifier.ts";
import { assertSafeRetainedText } from "./lib/revalidation-retained-text.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const resultsRoot = join(experiment, "results");
const sourceCommit = "51594a8b8f460a9b28e1e0ade25816a5a898395b";
const workload = JSON.parse(readFileSync(join(experiment, "workload.json"), "utf8")) as { authentication: { secretCanary: string; principalId: string; tenantId: string } };
const sensitive = [workload.authentication.secretCanary, workload.authentication.principalId, workload.authentication.tenantId];
const entries = readdirSync(resultsRoot, { withFileTypes: true });
const attemptRoots = entries.filter((entry) => entry.isDirectory()).map((entry) => join(resultsRoot, entry.name));
const expectedFiles = new Set(["README.md", "qualification-result.json"]);
if (entries.some((entry) => !entry.isDirectory() && !expectedFiles.has(entry.name))) throw new Error("FADENO_REVALIDATION_EVIDENCE_ROOT_INVENTORY");

const attempts = attemptRoots.map((attemptRoot) => {
  const attempt = JSON.parse(readFileSync(join(attemptRoot, "attempt.json"), "utf8")) as {
    id: string; attempt: number; sourceCommit: string; status: "complete" | "inconclusive"; phase: string;
  };
  assertQualificationAttemptDocument(root, attempt);
  if (attempt.id !== attemptRoot.split("/").at(-1) || attempt.sourceCommit !== sourceCommit) throw new Error("FADENO_REVALIDATION_EVIDENCE_ATTEMPT_IDENTITY");
  const files = readdirSync(attemptRoot).sort();
  for (const file of files) {
    const path = join(attemptRoot, file);
    if (!statSync(path).isFile() || !file.endsWith(".json")) throw new Error("FADENO_REVALIDATION_EVIDENCE_ATTEMPT_INVENTORY");
    assertSafeRetainedText(readFileSync(path, "utf8"), sensitive);
  }
  const capturePath = join(attemptRoot, "capture.json");
  if (files.includes("capture.json")) {
    const capture = JSON.parse(readFileSync(capturePath, "utf8")) as { sourceCommit: string; status: string };
    assertQualificationCaptureDocument(root, capture);
    if (capture.sourceCommit !== sourceCommit || capture.status !== attempt.status) throw new Error("FADENO_REVALIDATION_EVIDENCE_CAPTURE_STATE");
  }
  return { attemptRoot, attempt };
}).sort((left, right) => left.attempt.attempt - right.attempt.attempt);

if (attempts.length !== 12 || attempts.some(({ attempt }, index) => attempt.attempt !== index + 1)) {
  throw new Error("FADENO_REVALIDATION_EVIDENCE_ATTEMPT_SEQUENCE");
}
const complete = attempts.filter(({ attempt }) => attempt.status === "complete");
if (complete.length !== 1 || complete[0]!.attempt.attempt !== 12 || attempts.slice(0, 11).some(({ attempt }) => attempt.status !== "inconclusive")) {
  throw new Error("FADENO_REVALIDATION_EVIDENCE_DECISION_ATTEMPT");
}

const evidence = verifyQualificationAttempt(root, complete[0]!.attemptRoot, sourceCommit);
const derived = deriveQualificationResult(evidence.capture, loadQualificationSchedule(), evidence.captureSha256, evidence.environmentEvidenceValid, evidence.artifactIntegrityValid);
const retained = JSON.parse(readFileSync(join(resultsRoot, "qualification-result.json"), "utf8"));
const decisionSchema = JSON.parse(readFileSync(join(experiment, "qualification-decision.schema.json"), "utf8"));
const resultSchema = JSON.parse(readFileSync(join(experiment, "qualification-result.schema.json"), "utf8"));
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { addSchema(schema: unknown): void; compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown } };
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(decisionSchema);
const validateResult = ajv.compile(resultSchema);
if (!validateResult(retained)) throw new Error(`FADENO_REVALIDATION_EVIDENCE_RESULT_SCHEMA:${JSON.stringify(validateResult.errors)}`);
if (!isDeepStrictEqual(retained, derived)) {
  throw new Error("FADENO_REVALIDATION_EVIDENCE_RESULT_PROJECTION");
}
if (derived.decision.outcome !== "go" || Object.values(derived.decision.gates).some((gate) => !gate)) {
  throw new Error("FADENO_REVALIDATION_EVIDENCE_DECISION");
}
console.log(`revalidation qualification evidence passed (GO; attempts=${attempts.length}; default/selective p95=${derived.metrics.defaultToSelectiveP95Ratio.toFixed(6)}; memory=${derived.metrics.memoryGrowthRatio.toFixed(6)})`);
