import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import type { ExtractionQualificationReport } from "./qualification-report.ts";

type TestRecord = ExtractionQualificationReport["tests"][number];

export default class ExtractionQualificationReporter implements Reporter {
  readonly #outputRoot: string;
  readonly #tests: TestRecord[] = [];
  #failed = false;

  constructor() {
    const outputRoot = process.env.FADENO_EXTRACTION_QUALIFICATION_OUTPUT;
    if (!outputRoot) throw new Error("FADENO_EXTRACTION_QUALIFICATION_OUTPUT is required");
    this.#outputRoot = outputRoot;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      const projectName = test.parent.project()?.name ?? "";
      const attachments = result.attachments.filter(
        (attachment) => attachment.name === "qualification-observation",
      );
      const source = attachments.length === 1 ? attachments[0] : undefined;
      const body = source?.body ?? (source?.path ? readFileSync(source.path) : undefined);
      if (!source || !body) throw new Error("qualification observation is absent");
      const relativePath = `qualification-observations/${projectName}.json`;
      mkdirSync(join(this.#outputRoot, "qualification-observations"), { recursive: true });
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
      this.#failed = true;
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | void> {
    const status = this.#failed ? "failed" : result.status;
    const report: ExtractionQualificationReport = {
      schemaVersion: 1,
      status,
      tests: [...this.#tests].sort((left, right) =>
        left.projectName.localeCompare(right.projectName)
      ),
    };
    mkdirSync(this.#outputRoot, { recursive: true });
    writeFileSync(
      join(this.#outputRoot, "qualification-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (status !== result.status) return { status };
  }

  printsToStdio(): boolean {
    return false;
  }
}
