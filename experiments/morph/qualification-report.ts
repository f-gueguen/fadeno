import { isDeepStrictEqual } from "node:util";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import type { MorphProject } from "./contract.ts";
import {
  MorphHarnessError,
  verifyPortableHarnessAttachment,
} from "./harness-report.ts";
import type { MachineAttachment } from "./harness-report.ts";
import type { QualificationRecord } from "./qualification-proof.ts";
import {
  qualificationRepetitions,
  verifyQualificationRecords,
} from "./qualification-proof.ts";
import { MORPH_QUALIFICATION_CASES } from "./fixtures/qualification-corpus.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

type MachineResult = {
  project: string;
  title: string;
  status: string;
  expectedStatus: string;
  errors: string[];
  attachments: MachineAttachment[];
};

type MachineReport = {
  schemaVersion: number;
  status: string;
  results: MachineResult[];
};

export type QualificationEvidence = Readonly<{
  engine: MorphProject;
  recordsPath: string;
  summaryPath: string;
  summary: ReturnType<typeof verifyQualificationRecords>;
}>;

function fail(code: string, message: string): never {
  throw new MorphHarnessError(code, message);
}

function attachmentByName(
  result: MachineResult,
  verified: ReadonlyMap<MachineAttachment, string>,
  name: string,
): string {
  const matches = result.attachments.filter((attachment) => attachment.name === name);
  if (matches.length !== 1) {
    fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_SET", `${result.project}: expected one ${name}`);
  }
  const attachment = matches[0];
  if (!attachment) fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_SET", `${result.project}: missing ${name}`);
  return verified.get(attachment) ??
    fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_PATH", `${result.project}: unverified ${name}`);
}

export function verifyQualificationReport(
  reportPath: string,
  options: Readonly<{
    profile: MorphQualificationProfile;
    outputRoot: string;
  }>,
): readonly QualificationEvidence[] {
  const report = readJsonDocument(reportPath) as MachineReport;
  if (
    report.schemaVersion !== 1 ||
    !Array.isArray(report.results) ||
    !["passed", "failed", "timedout", "interrupted"].includes(report.status)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_REPORT_SHAPE", "qualification report shape is invalid");
  }
  if (report.results.length !== MORPH_PROJECTS.length) {
    fail("FADENO_MORPH_QUALIFICATION_EXECUTION_COUNT", "expected exactly three qualification executions");
  }
  const projects = report.results.map((result) => result.project).sort();
  if (!isDeepStrictEqual(projects, [...MORPH_PROJECTS].sort())) {
    fail("FADENO_MORPH_QUALIFICATION_PROJECT_SET", "qualification browser project set differs");
  }

  const seenPaths = new Set<string>();
  const evidence: QualificationEvidence[] = [];
  let observedFailure = false;
  for (const result of report.results) {
    const engine = result.project as MorphProject;
    if (
      result.title !== `qualification-${options.profile}` ||
      result.expectedStatus !== "passed" ||
      !["passed", "failed", "timedout", "interrupted"].includes(result.status) ||
      !Array.isArray(result.errors) ||
      !Array.isArray(result.attachments)
    ) {
      fail("FADENO_MORPH_QUALIFICATION_TEST_IDENTITY", `${engine}: test identity differs`);
    }
    const passing = result.status === "passed";
    const expectedAttachmentNames = passing
      ? ["qualification-records", "qualification-summary"]
      : [
          "error-context",
          "failure-before-after",
          "failure-operation",
          "qualification-records",
          "qualification-summary",
          "screenshot",
          "trace",
        ];
    if (
      !isDeepStrictEqual(
        result.attachments.map((attachment) => attachment.name).sort(),
        expectedAttachmentNames,
      )
    ) {
      fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_SET", `${engine}: attachment set differs`);
    }
    if (passing ? result.errors.length !== 0 : result.errors.length !== 1) {
      fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: diagnostic count differs`);
    }
    if (!passing && !result.errors[0]?.startsWith("Error: FADENO_MORPH_QUALIFICATION_FAILURE:")) {
      fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: failure diagnostic differs`);
    }

    const verified = new Map<MachineAttachment, string>();
    for (const attachment of result.attachments) {
      const verifiedAttachment = verifyPortableHarnessAttachment(attachment, options.outputRoot);
      if (seenPaths.has(verifiedAttachment.path)) {
        fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_DUPLICATE", `${engine}: duplicate attachment path`);
      }
      seenPaths.add(verifiedAttachment.path);
      verified.set(attachment, verifiedAttachment.path);
      if (attachment.name === "trace") {
        const trace = verifiedAttachment.traceEvidence;
        if (
          !trace ||
          trace.browserName !== engine ||
          !trace.title.endsWith(`› qualification-${options.profile}`) ||
          !trace.errorFirstLine.startsWith("Error: FADENO_MORPH_QUALIFICATION_FAILURE:")
        ) {
          fail("FADENO_MORPH_QUALIFICATION_TRACE", `${engine}: trace identity differs`);
        }
      }
    }
    const recordsPath = attachmentByName(result, verified, "qualification-records");
    const summaryPath = attachmentByName(result, verified, "qualification-summary");
    const records = readJsonDocument(recordsPath, { maxBytes: 20 * 1024 * 1024 }) as QualificationRecord[];
    const summaryDocument = readJsonDocument(summaryPath);
    if (passing) {
      if (report.status !== "passed") {
        fail("FADENO_MORPH_QUALIFICATION_RUN_STATUS", "passing results disagree with report status");
      }
      const summary = verifyQualificationRecords(records, options.profile, engine);
      if (!isDeepStrictEqual(summaryDocument, summary)) {
        fail("FADENO_MORPH_QUALIFICATION_SUMMARY", `${engine}: summary differs from raw records`);
      }
      evidence.push({ engine, recordsPath, summaryPath, summary });
    } else {
      observedFailure = true;
      const expectedRecords = MORPH_QUALIFICATION_CASES.length * qualificationRepetitions(options.profile);
      if (
        !Array.isArray(records) ||
        records.length >= expectedRecords ||
        !summaryDocument ||
        typeof summaryDocument !== "object" ||
        (summaryDocument as Record<string, unknown>).profile !== options.profile ||
        (summaryDocument as Record<string, unknown>).engine !== engine ||
        (summaryDocument as Record<string, unknown>).expectedRecords !== expectedRecords ||
        (summaryDocument as Record<string, unknown>).completedRecords !== records.length ||
        typeof (summaryDocument as Record<string, unknown>).failure !== "string"
      ) {
        fail("FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", `${engine}: partial summary differs`);
      }
      const operation = readJsonDocument(attachmentByName(result, verified, "failure-operation"));
      const beforeAfter = readJsonDocument(attachmentByName(result, verified, "failure-before-after"));
      if (
        !operation ||
        typeof operation !== "object" ||
        (operation as Record<string, unknown>).profile !== options.profile ||
        (operation as Record<string, unknown>).engine !== engine ||
        typeof (operation as Record<string, unknown>).nextCase !== "string" ||
        !Number.isInteger((operation as Record<string, unknown>).nextOrdinal) ||
        typeof (operation as Record<string, unknown>).failure !== "string" ||
        (records.length === 0 ? beforeAfter !== null : !isDeepStrictEqual(beforeAfter, records.at(-1)))
      ) {
        fail("FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", `${engine}: failure context differs`);
      }
    }
  }
  if (observedFailure || report.status !== "passed") {
    fail("FADENO_MORPH_QUALIFICATION_FAILURE", "qualification contains a verified browser failure");
  }
  return evidence;
}
