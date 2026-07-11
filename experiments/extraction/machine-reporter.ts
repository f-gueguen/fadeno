import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import type { ExtractionRunReport } from "./contract.ts";

type TestRecord = ExtractionRunReport["tests"][number];

export default class ExtractionMachineReporter implements Reporter {
  readonly #outputRoot: string;
  readonly #tests: TestRecord[] = [];
  #reporterFailed = false;

  constructor() {
    const outputRoot = process.env.FADENO_EXTRACTION_OUTPUT;
    if (!outputRoot) throw new Error("FADENO_EXTRACTION_OUTPUT is required");
    this.#outputRoot = outputRoot;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      const projectName = test.parent.project()?.name ?? "";
      const attachments = result.attachments.filter(
        (attachment) => attachment.name === "accepted-observation",
      );
      if (attachments.length !== 1) throw new Error("expected one accepted observation");
      const source = attachments[0];
      if (!source) throw new Error("accepted observation is absent");
      const body = source.body ?? (source.path ? readFileSync(source.path) : undefined);
      if (!body) throw new Error("accepted observation body is absent");
      const relativePath = `attachments/${projectName}.json`;
      const attachmentRoot = join(this.#outputRoot, "attachments");
      mkdirSync(attachmentRoot, { recursive: true });
      writeFileSync(join(this.#outputRoot, relativePath), body);
      this.#tests.push({
        projectName,
        title: test.title,
        status: result.status,
        expectedStatus: test.expectedStatus,
        retry: result.retry,
        attachment: {
          name: source.name,
          contentType: source.contentType,
          path: relativePath,
          sha256: createHash("sha256").update(body).digest("hex"),
        },
      });
    } catch {
      this.#reporterFailed = true;
    }
  }

  async onEnd(
    result: FullResult,
  ): Promise<{ status?: FullResult["status"] } | void> {
    const status = this.#reporterFailed ? "failed" : result.status;
    const report: ExtractionRunReport = {
      schemaVersion: 1,
      status,
      tests: [...this.#tests].sort((left, right) =>
        left.projectName.localeCompare(right.projectName)
      ),
    };
    mkdirSync(this.#outputRoot, { recursive: true });
    writeFileSync(
      join(this.#outputRoot, "run-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (status !== result.status) return { status };
  }

  printsToStdio(): boolean {
    return false;
  }
}
