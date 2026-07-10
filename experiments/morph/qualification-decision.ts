import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import { MORPH_QUALIFICATION_CASES } from "./fixtures/qualification-corpus.ts";
import { MorphHarnessError } from "./harness-report.ts";
import type { QualificationReportOutcome } from "./qualification-report.ts";
import { qualificationRepetitions } from "./qualification-proof.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

export type QualificationDecisionSignature = Readonly<{
  schemaVersion: 1;
  decision: "narrow";
  adr: string;
  failureCases: readonly Readonly<{
    caseId: string;
    categories: readonly string[];
  }>[];
}>;

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
    !hasExactKeys(signature, ["schemaVersion", "decision", "adr", "failureCases"]) ||
    signature.schemaVersion !== 1 ||
    signature.decision !== "narrow" ||
    !/^docs\/adr\/[0-9]{4}-[a-z0-9-]+\.md$/u.test(signature.adr) ||
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
  const path = join(root, "experiments/morph/fixtures/accepted-failure-signature.json");
  if (!existsSync(path)) fail("no accepted failure signature exists");
  const signature = readJsonDocument(path) as QualificationDecisionSignature;
  verifyQualificationDecisionSignature(signature, outcome, profile);
  const adr = join(root, signature.adr);
  if (!existsSync(adr) || !readFileSync(adr, "utf8").includes("- Status: Accepted")) {
    fail("accepted failure signature lacks an effective ADR");
  }
}
