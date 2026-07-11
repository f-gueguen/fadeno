import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { loadExperimentRegistry } from "../../scripts/lib/experiment-validation.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import { MORPH_QUALIFICATION_CASES } from "./fixtures/qualification-corpus.ts";
import { MorphHarnessError } from "./harness-report.ts";
import type { QualificationReportOutcome } from "./qualification-report.ts";
import { qualificationRepetitions } from "./qualification-proof.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

export type QualificationDecisionSignature = Readonly<{
  schemaVersion: 1;
  diagnosticCase: string;
  failureCases: readonly Readonly<{
    caseId: string;
    categories: readonly string[];
  }>[];
}>;

const signaturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/accepted-failure-signature.json",
);

export function loadQualificationDecisionSignature(): QualificationDecisionSignature {
  return readJsonDocument(signaturePath) as QualificationDecisionSignature;
}

function fail(message: string): never {
  throw new MorphHarnessError("FADENO_MORPH_DECISION_SIGNATURE", message);
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return actual.length === keys.length && actual.every((key) => expected.has(key));
}

export function verifyQualificationDecisionSignature(
  signature: QualificationDecisionSignature,
  outcome: QualificationReportOutcome,
  profile: MorphQualificationProfile,
): void {
  if (
    !hasExactKeys(signature, ["schemaVersion", "diagnosticCase", "failureCases"]) ||
    signature.schemaVersion !== 1 ||
    typeof signature.diagnosticCase !== "string" ||
    !Array.isArray(signature.failureCases) ||
    signature.failureCases.length === 0 ||
    outcome.status !== "failed" ||
    outcome.passed.length !== 0 ||
    outcome.failed.length !== MORPH_PROJECTS.length
  ) {
    fail("qualification outcome does not match an accepted narrow decision");
  }
  const cases = new Map<string, readonly string[]>();
  for (const entry of signature.failureCases) {
    if (
      !entry ||
      !hasExactKeys(entry, ["caseId", "categories"]) ||
      typeof entry.caseId !== "string" ||
      !MORPH_QUALIFICATION_CASES.some((fixture) => fixture.id === entry.caseId) ||
      !Array.isArray(entry.categories) ||
      entry.categories.length === 0 ||
      new Set(entry.categories).size !== entry.categories.length ||
      cases.has(entry.caseId)
    ) {
      fail("accepted failure cases are invalid");
    }
    cases.set(entry.caseId, entry.categories);
  }
  if (!cases.has(signature.diagnosticCase)) fail("accepted diagnostic case is invalid");
  const repetitions = qualificationRepetitions(profile);
  const expectedFailures = signature.failureCases.length * repetitions;
  const engines = new Set(outcome.failed.map((item) => item.engine));
  if (engines.size !== MORPH_PROJECTS.length || MORPH_PROJECTS.some((engine) => !engines.has(engine))) {
    fail("accepted engine matrix differs");
  }
  for (const item of outcome.failed) {
    if (
      item.summary.failedRecords !== expectedFailures ||
      item.summary.passedRecords + item.summary.failedRecords !== item.summary.expectedRecords ||
      item.summary.intentionalReplacements !== repetitions
    ) {
      fail(`${item.engine}: accepted matrix totals differ`);
    }
    const expected = signature.failureCases.flatMap((entry) =>
      Array.from({ length: repetitions }, (_, index) => ({
        key: `${item.engine}/${entry.caseId}/${index + 1}`,
        categories: entry.categories,
      }))
    );
    if (!isDeepStrictEqual(item.summary.failures, expected)) {
      fail(`${item.engine}: failure signature differs`);
    }
  }
}

export function verifyAcceptedQualificationFailure(
  root: string,
  outcome: QualificationReportOutcome,
  profile: MorphQualificationProfile,
): void {
  if (!existsSync(signaturePath)) fail("no accepted failure signature exists");
  const signature = loadQualificationDecisionSignature();
  verifyQualificationDecisionSignature(signature, outcome, profile);
  const registry = loadExperimentRegistry(root);
  const experiment = registry.experiments.find(
    (entry: { id?: string }) => entry.id === "morph",
  );
  if (
    experiment?.status !== "qualified" ||
    experiment.decision !== "narrow" ||
    typeof experiment.decisionAdr !== "string"
  ) {
    fail("morph registry lacks an accepted narrow decision");
  }
  const adr = join(root, experiment.decisionAdr);
  if (!existsSync(adr) || !readFileSync(adr, "utf8").includes("- Status: Accepted")) {
    fail("accepted failure signature lacks an effective ADR");
  }
}
