import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { EXTRACTION_PROJECTS } from "./contract.ts";
import type { ExtractionProject } from "./contract.ts";
import {
  verifyExtractionQualificationObservation,
} from "./qualification-proof.ts";
import type {
  ExtractionQualificationObservation,
  GeneratedInventory,
} from "./qualification-proof.ts";

export type ExtractionQualificationReport = Readonly<{
  schemaVersion: 1;
  status: "passed" | "failed" | "timedout" | "interrupted";
  tests: readonly Readonly<{
    projectName: string;
    title: string;
    status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    expectedStatus: string;
    retry: number;
    attachment: Readonly<{
      name: string;
      contentType: string;
      path: string;
      sha256: string;
    }>;
  }>[];
}>;

export function verifyExtractionQualificationReport(
  report: ExtractionQualificationReport,
  inventory: GeneratedInventory,
  readAttachment: (path: string) => Buffer,
): Map<ExtractionProject, ExtractionQualificationObservation> {
  const tests = [...report.tests].sort((left, right) =>
    left.projectName.localeCompare(right.projectName)
  );
  if (
    report.schemaVersion !== 1 ||
    report.status !== "passed" ||
    tests.length !== EXTRACTION_PROJECTS.length ||
    !isDeepStrictEqual(tests.map((test) => test.projectName), [...EXTRACTION_PROJECTS].sort())
  ) throw new Error("FADENO_EXTRACTION_QUALIFICATION_REPORT");

  const observations = new Map<ExtractionProject, ExtractionQualificationObservation>();
  for (const test of tests) {
    const project = test.projectName as ExtractionProject;
    const expectedPath = `qualification-observations/${project}.json`;
    if (
      !EXTRACTION_PROJECTS.includes(project) ||
      test.title !== "locked-extraction-qualification" ||
      test.status !== "passed" ||
      test.expectedStatus !== "passed" ||
      test.retry !== 0 ||
      test.attachment.name !== "qualification-observation" ||
      test.attachment.contentType !== "application/json" ||
      test.attachment.path !== expectedPath
    ) throw new Error("FADENO_EXTRACTION_QUALIFICATION_TEST");
    const body = readAttachment(expectedPath);
    if (createHash("sha256").update(body).digest("hex") !== test.attachment.sha256) {
      throw new Error("FADENO_EXTRACTION_QUALIFICATION_ATTACHMENT");
    }
    const observation = JSON.parse(body.toString("utf8")) as ExtractionQualificationObservation;
    verifyExtractionQualificationObservation(observation, inventory);
    if (observation.projectName !== project || observation.observedBrowser !== project) {
      throw new Error("FADENO_EXTRACTION_QUALIFICATION_BROWSER");
    }
    observations.set(project, observation);
  }
  return observations;
}
