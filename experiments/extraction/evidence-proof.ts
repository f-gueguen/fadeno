import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { verifyAcceptedObservation } from "./accepted-proof.ts";
import { EXTRACTION_PROJECTS } from "./contract.ts";
import type {
  ExtractionObservation,
  ExtractionRunReport,
} from "./contract.ts";

export function verifyExtractionRunReport(
  report: ExtractionRunReport,
  readAttachment: (path: string) => Buffer,
): void {
  const tests = [...report.tests].sort((left, right) =>
    left.projectName.localeCompare(right.projectName)
  );
  if (
    report.schemaVersion !== 1 ||
    report.status !== "passed" ||
    tests.length !== EXTRACTION_PROJECTS.length ||
    !isDeepStrictEqual(
      tests.map((test) => test.projectName),
      [...EXTRACTION_PROJECTS].sort(),
    )
  ) {
    throw new Error("FADENO_EXTRACTION_RUN_REPORT");
  }

  for (const test of tests) {
    const expectedPath = `attachments/${test.projectName}.json`;
    if (
      test.title !== "seeded-accepted-loading-control" ||
      test.status !== "passed" ||
      test.expectedStatus !== "passed" ||
      test.retry !== 0 ||
      test.attachment.name !== "accepted-observation" ||
      test.attachment.contentType !== "application/json" ||
      test.attachment.path !== expectedPath
    ) {
      throw new Error("FADENO_EXTRACTION_RUN_TEST");
    }
    const body = readAttachment(expectedPath);
    if (createHash("sha256").update(body).digest("hex") !== test.attachment.sha256) {
      throw new Error("FADENO_EXTRACTION_RUN_ATTACHMENT");
    }
    const observation = JSON.parse(body.toString("utf8")) as ExtractionObservation;
    verifyAcceptedObservation(observation);
    if (
      observation.projectName !== test.projectName ||
      observation.observedBrowser !== test.projectName
    ) {
      throw new Error("FADENO_EXTRACTION_RUN_BROWSER");
    }
  }
}
