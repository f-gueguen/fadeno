import { createHash } from "node:crypto";

import { EXTRACTION_PROJECTS } from "../experiments/extraction/contract.ts";
import type { ExtractionProject } from "../experiments/extraction/contract.ts";
import { EXTRACTION_ACCEPTED_CLASSES } from "../experiments/extraction/fixtures/catalog.ts";
import { EXTRACTION_IDENTITY_CASES } from "../experiments/extraction/qualification-contract.ts";
import {
  decideExtractionOutcome,
  expectedInteractionState,
  verifyExtractionQualificationObservation,
} from "../experiments/extraction/qualification-proof.ts";
import type {
  ExtractionQualificationObservation,
  GeneratedInventory,
} from "../experiments/extraction/qualification-proof.ts";
import { verifyExtractionQualificationReport } from "../experiments/extraction/qualification-report.ts";
import type { ExtractionQualificationReport } from "../experiments/extraction/qualification-report.ts";

const moduleBodies = new Map(
  EXTRACTION_ACCEPTED_CLASSES.map((fixtureId) => [
    fixtureId,
    `const handler = () => {};\nexport { handler };\nexport const handlerIdentity = "identity-${fixtureId}";\n`,
  ]),
);

const inventory: GeneratedInventory = {
  schemaVersion: 1,
  files: EXTRACTION_ACCEPTED_CLASSES.map((fixtureId) => {
    const body = moduleBodies.get(fixtureId)!;
    return {
      fixtureId,
      path: `generated/${fixtureId}.js`,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
      handlerIdentity: `identity-${fixtureId}`,
    };
  }),
};

function observation(project: ExtractionProject): ExtractionQualificationObservation {
  const inventoryByFixture = new Map(inventory.files.map((file) => [file.fixtureId, file]));
  return {
    schemaVersion: 1,
    projectName: project,
    observedBrowser: project,
    fixtures: EXTRACTION_ACCEPTED_CLASSES.map((fixtureId) => {
      const generated = inventoryByFixture.get(fixtureId)!;
      const body = moduleBodies.get(fixtureId)!;
      return {
        fixtureId,
        preTriggerRequests: ["/", "/document.js"],
        firstTriggerRequests: [`/handlers/${fixtureId}.js`],
        laterRequests: [],
        disk: { path: generated.path, sha256: generated.sha256, bytes: generated.bytes },
        response: {
          path: `/handlers/${fixtureId}.js`,
          body,
          contentType: "text/javascript",
          sha256: generated.sha256,
          bytes: generated.bytes,
        },
        handlerIdentity: generated.handlerIdentity,
        moduleEvaluations: 1,
        handlerReferenceStable: true,
        interactions: Array.from({ length: 100 }, (_, index) => ({
          ordinal: index + 1,
          before: expectedInteractionState(fixtureId, index),
          after: expectedInteractionState(fixtureId, index + 1),
          effects: index + 1,
        })),
        identity: EXTRACTION_IDENTITY_CASES.map((identityCase, index) => ({
          caseId: identityCase.id,
          operation: identityCase.operation,
          ordinal: 101 + index,
          targetSame: true,
          scenarioTargetSame: true,
          reusedScenarioTarget: true,
          scenarioState: identityCase.state,
          scenarioStatePass: true,
          beforeOrder: ["before"],
          afterOrder: ["after"],
          handlerReferenceStable: true,
          moduleEvaluations: 1,
          effectDelta: 1,
          after: expectedInteractionState(fixtureId, 101 + index),
        })),
      };
    }),
  };
}

const chromium = observation("chromium");
verifyExtractionQualificationObservation(chromium, inventory);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

for (const [name, mutate] of [
  ["missing ordinal", (value: any) => { value.fixtures[0].interactions.pop(); }],
  ["wrong state", (value: any) => { value.fixtures[0].interactions[4].after = { expanded: false, hidden: false }; }],
  ["early handler", (value: any) => { value.fixtures[0].preTriggerRequests.push("/handlers/toggle.js"); }],
  ["module reevaluation", (value: any) => { value.fixtures[0].moduleEvaluations = 2; }],
  ["lost target", (value: any) => { value.fixtures[0].identity[0].targetSame = false; }],
  ["lost scenario state", (value: any) => { value.fixtures[0].identity[0].scenarioStatePass = false; }],
  ["repeat request", (value: any) => { value.fixtures[0].laterRequests.push("/handlers/toggle.js"); }],
  ["response divergence", (value: any) => { value.fixtures[0].response.body += "// divergent\n"; }],
  ["browser mismatch", (value: any) => { value.observedBrowser = "firefox"; }],
] as const) {
  const mutated = clone(chromium) as any;
  mutate(mutated);
  try {
    verifyExtractionQualificationObservation(mutated, inventory);
    throw new Error(`K0-06 ${name} mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("mutation was accepted")) throw error;
  }
}

const attachments = new Map<string, Buffer>();
const report: ExtractionQualificationReport = {
  schemaVersion: 1,
  status: "passed",
  tests: EXTRACTION_PROJECTS.map((projectName) => {
    const body = Buffer.from(`${JSON.stringify(observation(projectName), null, 2)}\n`);
    const path = `qualification-observations/${projectName}.json`;
    attachments.set(path, body);
    return {
      projectName,
      title: "locked-extraction-qualification",
      status: "passed",
      expectedStatus: "passed",
      retry: 0,
      attachment: {
        name: "qualification-observation",
        contentType: "application/json",
        path,
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    };
  }),
};
const readAttachment = (path: string): Buffer => {
  const body = attachments.get(path);
  if (!body) throw new Error(`missing qualification attachment: ${path}`);
  return body;
};
verifyExtractionQualificationReport(report, inventory, readAttachment);
for (const [name, mutation] of [
  ["missing project", { ...report, tests: report.tests.slice(1) }],
  ["duplicate project", { ...report, tests: [report.tests[0]!, report.tests[0]!, report.tests[2]!] }],
  ["failed status", { ...report, status: "failed" as const }],
  ["retry", { ...report, tests: report.tests.map((test, index) => index === 0 ? { ...test, retry: 1 } : test) }],
  ["wrong path", { ...report, tests: report.tests.map((test, index) => index === 0 ? { ...test, attachment: { ...test.attachment, path: "qualification-observations/wrong.json" } } : test) }],
] as const) {
  try {
    verifyExtractionQualificationReport(mutation as ExtractionQualificationReport, inventory, readAttachment);
    throw new Error(`K0-06 ${name} report mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("report mutation was accepted")) throw error;
  }
}

const all = [...EXTRACTION_ACCEPTED_CLASSES];
if (
  decideExtractionOutcome({ accepted: all, rejectedBoundariesPass: true, identityPass: true, deterministicGenerationPass: true, outputSafetyPass: true }) !== "go" ||
  decideExtractionOutcome({ accepted: ["toggle", "disclosure", "menu", "local-counter"], rejectedBoundariesPass: true, identityPass: true, deterministicGenerationPass: true, outputSafetyPass: true }) !== "narrow" ||
  decideExtractionOutcome({ accepted: ["toggle", "disclosure", "tabs", "menu"], rejectedBoundariesPass: true, identityPass: true, deterministicGenerationPass: true, outputSafetyPass: true }) !== "pivot" ||
  decideExtractionOutcome({ accepted: all, rejectedBoundariesPass: false, identityPass: true, deterministicGenerationPass: true, outputSafetyPass: true }) !== "pivot"
) throw new Error("K0-06 decision table differs");

console.log("extraction qualification verifier passed (9 observation, 5 report, 4 decision mutations)");
