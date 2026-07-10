import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

type ReportResult = {
  project: string;
  title: string;
  status: string;
  expectedStatus: string;
  errors: string[];
  attachments: Array<{
    name: string;
    contentType: string;
    path: string | undefined;
    bytes: number;
  }>;
};

export default class MorphMachineReporter implements Reporter {
  private readonly results: ReportResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.push({
      project: test.parent.project()?.name ?? "unknown",
      title: test.title,
      status: result.status,
      expectedStatus: test.expectedStatus,
      errors: result.errors.map((error) => error.message ?? String(error)),
      attachments: result.attachments.map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        path: attachment.path,
        bytes: attachment.path ? statSync(attachment.path).size : 0,
      })),
    });
  }

  onEnd(result: FullResult): void {
    const output = process.env.FADENO_MORPH_REPORT;
    if (!output) throw new Error("FADENO_MORPH_REPORT is required");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      `${JSON.stringify({ schemaVersion: 1, status: result.status, results: this.results }, null, 2)}\n`,
    );
  }
}
