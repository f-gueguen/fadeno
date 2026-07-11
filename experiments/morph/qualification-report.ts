import { isDeepStrictEqual } from "node:util";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import type { MorphProject } from "./contract.ts";
import {
  verifyQualificationDiagnosticSelection,
} from "./qualification-decision.ts";
import {
  MorphHarnessError,
  verifyPortableHarnessAttachment,
  verifyTraceAttachmentBindings,
} from "./harness-report.ts";
import type { TraceEvidence } from "./harness-report.ts";
import type {
  QualificationFailureEvidence,
  QualificationRecord,
} from "./qualification-proof.ts";
import {
  classifyQualificationFailure,
  verifyQualificationDiagnosticRecord,
  verifyQualificationFailureAlignment,
  verifyQualificationOutcome,
} from "./qualification-proof.ts";
import type {
  MorphMachineAttachment as MachineAttachment,
  MorphMachineReport as MachineReport,
  MorphMachineResult as MachineResult,
} from "./machine-report.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

export type QualificationEvidence = Readonly<{
  engine: MorphProject;
  recordsPath: string;
  failuresPath: string;
  summaryPath: string;
  summary: ReturnType<typeof verifyQualificationOutcome>;
}>;

export type QualificationFailedEvidence = Readonly<{
  engine: MorphProject;
  recordsPath: string;
  failuresPath: string;
  summaryPath: string;
  diagnosticFailurePath: string;
  screenshotPath: string;
  tracePath: string;
  errorContextPath: string;
  summary: ReturnType<typeof verifyQualificationOutcome>;
}>;

export type QualificationReportOutcome =
  | Readonly<{ status: "passed"; passed: readonly QualificationEvidence[]; failed: readonly [] }>
  | Readonly<{
      status: "failed";
      passed: readonly QualificationEvidence[];
      failed: readonly QualificationFailedEvidence[];
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
): QualificationReportOutcome {
  const report = readJsonDocument(reportPath) as MachineReport;
  if (
    report.schemaVersion !== 1 ||
    !Array.isArray(report.results) ||
    !["passed", "failed", "timedout", "interrupted"].includes(report.status)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_REPORT_SHAPE", "qualification report shape is invalid");
  }
  if (report.results.length !== MORPH_PROJECTS.length * 2) {
    fail("FADENO_MORPH_QUALIFICATION_EXECUTION_COUNT", "expected matrix and diagnostic executions");
  }
  const seenPaths = new Set<string>();
  const passedEvidence: QualificationEvidence[] = [];
  const failedEvidence: QualificationFailedEvidence[] = [];
  for (const engine of MORPH_PROJECTS) {
    const engineResults = report.results.filter((result) => result.project === engine);
    const matrix = engineResults.find(
      (result) => result.title === `qualification-matrix-${options.profile}`,
    );
    const diagnostic = engineResults.find(
      (result) => result.title === `qualification-diagnostic-${options.profile}`,
    );
    if (
      engineResults.length !== 2 ||
      !matrix ||
      !diagnostic ||
      matrix.expectedStatus !== "passed" ||
      matrix.status !== "passed" ||
      matrix.errors.length !== 0
    ) {
      fail("FADENO_MORPH_QUALIFICATION_TEST_IDENTITY", `${engine}: execution identity differs`);
    }
    const matrixNames = matrix.attachments.map(
      (attachment: MachineAttachment) => attachment.name,
    ).sort();
    if (!isDeepStrictEqual(matrixNames, [
      "qualification-failures",
      "qualification-records",
      "qualification-summary",
    ])) {
      fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_SET", `${engine}: matrix attachments differ`);
    }
    const matrixVerified = new Map<MachineAttachment, string>();
    for (const attachment of matrix.attachments) {
      const verified = verifyPortableHarnessAttachment(attachment, options.outputRoot);
      if (seenPaths.has(verified.path)) {
        fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_DUPLICATE", `${engine}: duplicate attachment path`);
      }
      seenPaths.add(verified.path);
      matrixVerified.set(attachment, verified.path);
    }
    const recordsPath = attachmentByName(matrix, matrixVerified, "qualification-records");
    const failuresPath = attachmentByName(matrix, matrixVerified, "qualification-failures");
    const summaryPath = attachmentByName(matrix, matrixVerified, "qualification-summary");
    const records = readJsonDocument(recordsPath, { maxBytes: 20 * 1024 * 1024 }) as QualificationRecord[];
    const failures = readJsonDocument(failuresPath, {
      maxBytes: 20 * 1024 * 1024,
    }) as QualificationFailureEvidence[];
    if (!Array.isArray(records) || !Array.isArray(failures)) {
      fail("FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", `${engine}: matrix documents differ`);
    }
    const summary = verifyQualificationOutcome(records, failures, options.profile, engine);
    if (!isDeepStrictEqual(readJsonDocument(summaryPath), summary)) {
      fail("FADENO_MORPH_QUALIFICATION_SUMMARY", `${engine}: summary differs from raw outcome`);
    }

    if (failures.length === 0) {
      if (
        diagnostic.expectedStatus !== "passed" ||
        diagnostic.status !== "passed" ||
        diagnostic.errors.length !== 0 ||
        !isDeepStrictEqual(
          diagnostic.attachments.map((item: MachineAttachment) => item.name),
          ["diagnostic-record"],
        )
      ) {
        fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: passing diagnostic differs`);
      }
      const verified = new Map<MachineAttachment, string>();
      const attachment = diagnostic.attachments[0];
      if (!attachment) fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: diagnostic missing`);
      const evidence = verifyPortableHarnessAttachment(attachment, options.outputRoot);
      verified.set(attachment, evidence.path);
      const record = readJsonDocument(
        attachmentByName(diagnostic, verified, "diagnostic-record"),
      ) as QualificationRecord;
      verifyQualificationDiagnosticRecord(record, options.profile, engine);
      passedEvidence.push({ engine, recordsPath, failuresPath, summaryPath, summary });
      continue;
    }

    if (
      diagnostic.expectedStatus !== "passed" ||
      diagnostic.status !== "failed" ||
      diagnostic.errors.length !== 1 ||
      !diagnostic.errors[0]?.startsWith("Error: FADENO_MORPH_QUALIFICATION_FAILURE:")
    ) {
      fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: failed diagnostic differs`);
    }
    const expectedDiagnosticNames = [
      "diagnostic-failure",
      "error-context",
      "screenshot",
      "trace",
    ];
    if (!isDeepStrictEqual(
      diagnostic.attachments.map((item: MachineAttachment) => item.name).sort(),
      expectedDiagnosticNames,
    )) {
      fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_SET", `${engine}: diagnostic attachments differ`);
    }
    const diagnosticVerified = new Map<MachineAttachment, string>();
    let traceEvidence: TraceEvidence | undefined;
    for (const attachment of diagnostic.attachments) {
      const verified = verifyPortableHarnessAttachment(attachment, options.outputRoot);
      if (seenPaths.has(verified.path)) {
        fail("FADENO_MORPH_QUALIFICATION_ATTACHMENT_DUPLICATE", `${engine}: duplicate attachment path`);
      }
      seenPaths.add(verified.path);
      diagnosticVerified.set(attachment, verified.path);
      if (attachment.name === "trace") traceEvidence = verified.traceEvidence;
    }
    if (
      !traceEvidence ||
      traceEvidence.browserName !== engine ||
      !traceEvidence.title.endsWith(`› qualification-diagnostic-${options.profile}`) ||
      !traceEvidence.errorFirstLine.startsWith("Error: FADENO_MORPH_QUALIFICATION_FAILURE:")
    ) {
      fail("FADENO_MORPH_QUALIFICATION_TRACE", `${engine}: diagnostic trace differs`);
    }
    verifyTraceAttachmentBindings(diagnostic, diagnosticVerified, traceEvidence);
    const diagnosticFailure = readJsonDocument(
      attachmentByName(diagnostic, diagnosticVerified, "diagnostic-failure"),
    ) as QualificationFailureEvidence;
    verifyQualificationFailureAlignment(
      diagnosticFailure.operation,
      diagnosticFailure.observation,
      options.profile,
      engine,
    );
    verifyQualificationDiagnosticSelection(diagnosticFailure, options.profile);
    const classification = classifyQualificationFailure(
      diagnosticFailure.observation,
      options.profile,
    );
    const matrixClassification = summary.failures.find((item) => item.key === classification.key);
    if (!matrixClassification || !isDeepStrictEqual(matrixClassification, classification)) {
      fail("FADENO_MORPH_QUALIFICATION_DIAGNOSTIC", `${engine}: diagnostic is absent from matrix`);
    }
    failedEvidence.push({
      engine,
      recordsPath,
      failuresPath,
      summaryPath,
      diagnosticFailurePath: attachmentByName(
        diagnostic,
        diagnosticVerified,
        "diagnostic-failure",
      ),
      screenshotPath: attachmentByName(diagnostic, diagnosticVerified, "screenshot"),
      tracePath: attachmentByName(diagnostic, diagnosticVerified, "trace"),
      errorContextPath: attachmentByName(diagnostic, diagnosticVerified, "error-context"),
      summary,
    });
  }
  const observedFailure = failedEvidence.length > 0;
  if ((observedFailure && report.status !== "failed") || (!observedFailure && report.status !== "passed")) {
    fail("FADENO_MORPH_QUALIFICATION_RUN_STATUS", "result statuses disagree with report status");
  }
  return observedFailure
    ? { status: "failed", passed: passedEvidence, failed: failedEvidence }
    : { status: "passed", passed: passedEvidence, failed: [] };
}
