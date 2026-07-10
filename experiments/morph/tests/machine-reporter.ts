import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import type { MorphMachineResult } from "../machine-report.ts";

export default class MorphMachineReporter implements Reporter {
  private readonly results: MorphMachineResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const outputRoot = process.env.FADENO_MORPH_CHILD_OUTPUT;
    if (!outputRoot) throw new Error("FADENO_MORPH_CHILD_OUTPUT is required");
    this.results.push({
      project: test.parent.project()?.name ?? "unknown",
      title: test.title,
      status: result.status,
      expectedStatus: test.expectedStatus,
      errors: result.errors.map((error) => error.message ?? String(error)),
      attachments: result.attachments.map((attachment) => {
        if (!attachment.path) {
          return {
            name: attachment.name,
            contentType: attachment.contentType,
            bytes: 0,
          };
        }
        const portablePath = relative(outputRoot, attachment.path);
        if (
          portablePath === "" ||
          portablePath === ".." ||
          portablePath.startsWith(`..${sep}`) ||
          isAbsolute(portablePath)
        ) {
          throw new Error(`FADENO_MORPH_ATTACHMENT_PATH: ${attachment.name}`);
        }
        return {
          name: attachment.name,
          contentType: attachment.contentType,
          path: portablePath,
          bytes: statSync(attachment.path).size,
        };
      }),
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
