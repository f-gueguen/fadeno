import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTRACTION_ACCEPTED_CLASSES,
  EXTRACTION_QUALIFICATION_FIXTURES,
  EXTRACTION_REJECTION_CLASSES,
  stableExtractionInventory,
} from "../experiments/extraction/fixtures/catalog.ts";
import { verifyAcceptedObservation } from "../experiments/extraction/accepted-proof.ts";
import {
  runSeededBoundaryPipeline,
  verifySeededBoundaryRejection,
} from "../experiments/extraction/boundary-pipeline.ts";
import { EXTRACTION_PROJECTS } from "../experiments/extraction/contract.ts";
import type {
  ExtractionObservation,
  ExtractionProject,
  ExtractionRunReport,
} from "../experiments/extraction/contract.ts";
import { verifyExtractionRunReport } from "../experiments/extraction/evidence-proof.ts";
import { stableExtractionHarnessSeed } from "../experiments/extraction/seed/catalog.ts";
import { stableExtractionQualificationContract } from "../experiments/extraction/qualification-contract.ts";
import {
  DOCUMENT_HTML,
  DOCUMENT_MODULE,
  HANDLER_MODULE,
  RUNTIME_RESPONSES,
} from "../experiments/extraction/runtime-fixture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(join(root, ".github/workflows/check.yml"), "utf8");
for (const required of [
  "extraction-harness:",
  "uses: ./.github/actions/browser-reference",
  "task: extraction-harness",
  "name: extraction-harness-evidence",
  "path: output/playwright/extraction",
  "if: always()",
]) {
  if (!workflow.includes(required)) {
    throw new Error(`K0-05 extraction workflow wiring missing: ${required}`);
  }
}
const golden = readFileSync(
  join(root, "experiments/extraction/fixtures/inventory.golden.json"),
  "utf8",
);
const seedGolden = readFileSync(
  join(root, "experiments/extraction/seed/inventory.golden.json"),
  "utf8",
);
const qualificationGolden = readFileSync(
  join(root, "experiments/extraction/qualification-contract.golden.json"),
  "utf8",
);

if (stableExtractionInventory() !== golden) {
  throw new Error("K0-05 extraction corpus differs from its checked golden projection");
}
if (stableExtractionHarnessSeed() !== seedGolden) {
  throw new Error("K0-05 executable seed differs from its checked golden graph");
}
if (stableExtractionQualificationContract() !== qualificationGolden) {
  throw new Error("K0-06 extraction qualification contract differs from its golden projection");
}
if (
  EXTRACTION_ACCEPTED_CLASSES.length !== 5 ||
  EXTRACTION_REJECTION_CLASSES.length !== 10 ||
  EXTRACTION_QUALIFICATION_FIXTURES.length !== 15 ||
  new Set(EXTRACTION_QUALIFICATION_FIXTURES.map((fixture) => fixture.id)).size !== 15
) {
  throw new Error("K0-05 extraction corpus cardinality or identity differs");
}

function observationFor(projectName: ExtractionProject): ExtractionObservation {
  return {
  schemaVersion: 2,
  projectName,
  observedBrowser: projectName,
  preTriggerRequests: ["/", "/document.js"],
  firstTriggerRequests: ["/handler.js", "/shared.js"],
  secondTriggerRequests: [],
  responses: Object.fromEntries([...RUNTIME_RESPONSES].map(([path, response]) => [path, {
    ...response,
    sha256: createHash("sha256").update(response.body).digest("hex"),
  }])),
  valueWhileHandlerBlocked: "0",
  valueAfterFirstTrigger: "1",
  valueAfterSecondTrigger: "2",
  noJavaScriptValue: "0",
  noJavaScriptRequests: ["/"],
  };
}

const observation = observationFor("chromium");
verifyAcceptedObservation(observation);
function responseMutation(
  value: ExtractionObservation,
  path: string,
  body: string,
): ExtractionObservation {
  const current = value.responses[path];
  if (!current) throw new Error(`missing seeded response: ${path}`);
  return {
    ...value,
    responses: {
      ...value.responses,
      [path]: { ...current, body, sha256: createHash("sha256").update(body).digest("hex") },
    },
  };
}
for (const [name, mutate] of [
  ["early handler request", (value: ExtractionObservation) => ({ ...value, preTriggerRequests: ["/", "/document.js", "/handler.js"] })],
  ["inlined handler", (value: ExtractionObservation) => responseMutation(value, "/document.js", `${DOCUMENT_MODULE}\nfadeno-handler-only-sentinel`)],
  ["inline hydration", (value: ExtractionObservation) => responseMutation(value, "/", `${DOCUMENT_HTML}\n<script>hydrate()</script>`) ],
  ["browser mismatch", (value: ExtractionObservation) => ({ ...value, observedBrowser: "firefox" as const })],
  ["extra first request", (value: ExtractionObservation) => ({ ...value, firstTriggerRequests: ["/handler.js", "/shared.js", "/fragment.js"] })],
  ["forbidden module", (value: ExtractionObservation) => responseMutation(value, "/handler.js", `${HANDLER_MODULE}\n// server-only`)],
  ["second-click-only", (value: ExtractionObservation) => ({ ...value, valueAfterFirstTrigger: "0" })],
] as const) {
  try {
    verifyAcceptedObservation(mutate(observation) as ExtractionObservation);
    throw new Error(`K0-05 ${name} mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === `K0-05 ${name} mutation was accepted`) throw error;
  }
}

const attachments = new Map<string, Buffer>();
const reportTests = EXTRACTION_PROJECTS.map((projectName) => {
  const body = Buffer.from(`${JSON.stringify(observationFor(projectName), null, 2)}\n`);
  const path = `attachments/${projectName}.json`;
  attachments.set(path, body);
  return {
    projectName,
    title: "seeded-accepted-loading-control",
    status: "passed" as const,
    expectedStatus: "passed",
    retry: 0,
    attachment: {
      name: "accepted-observation",
      contentType: "application/json",
      path,
      sha256: createHash("sha256").update(body).digest("hex"),
    },
  };
});
const report: ExtractionRunReport = { schemaVersion: 1, status: "passed", tests: reportTests };
const readAttachment = (path: string): Buffer => {
  const body = attachments.get(path);
  if (!body) throw new Error(`missing synthetic attachment: ${path}`);
  return body;
};
verifyExtractionRunReport(report, readAttachment);
for (const [name, mutation] of [
  ["missing project", { ...report, tests: report.tests.slice(1) }],
  ["duplicate project", { ...report, tests: [report.tests[0], report.tests[0], report.tests[2]] }],
  ["wrong status", { ...report, tests: report.tests.map((test, index) => index === 0 ? { ...test, status: "failed" as const } : test) }],
  ["wrong attachment path", { ...report, tests: report.tests.map((test, index) => index === 0 ? { ...test, attachment: { ...test.attachment, path: "attachments/fabricated.json" } } : test) }],
] as const) {
  try {
    verifyExtractionRunReport(mutation as ExtractionRunReport, readAttachment);
    throw new Error(`K0-05 ${name} report mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("report mutation was accepted")) throw error;
  }
}
const fabricatedObservation = {
  ...observationFor("chromium"),
  observedBrowser: "firefox" as const,
};
const fabricatedBody = Buffer.from(`${JSON.stringify(fabricatedObservation, null, 2)}\n`);
const fabricatedReport: ExtractionRunReport = {
  ...report,
  tests: report.tests.map((test) => test.projectName === "chromium" ? {
    ...test,
    attachment: {
      ...test.attachment,
      sha256: createHash("sha256").update(fabricatedBody).digest("hex"),
    },
  } : test),
};
try {
  verifyExtractionRunReport(
    fabricatedReport,
    (path) => path === "attachments/chromium.json" ? fabricatedBody : readAttachment(path),
  );
  throw new Error("K0-05 fabricated observation mutation was accepted");
} catch (error: unknown) {
  if (error instanceof Error && error.message.endsWith("mutation was accepted")) throw error;
}

const canary = "fadeno-extraction-test-canary";
let rejectedCallbacks = 0;
const rejectedDiagnostic = runSeededBoundaryPipeline({
  handler: {
    sourceName: "rejected/server-secret.ts",
    source: readFileSync(join(root, "experiments/extraction/fixtures/rejected/server-secret.ts"), "utf8"),
  },
  serverCapability: { secret: canary },
  emitBrowserArtifact() { rejectedCallbacks += 1; },
  startServer() { rejectedCallbacks += 1; },
  startBrowser() { rejectedCallbacks += 1; },
});
if (
  rejectedCallbacks !== 0
) throw new Error("K0-05 rejected pipeline did not stop before browser boundaries");
verifySeededBoundaryRejection(rejectedDiagnostic, canary, {
  writerStarted: false,
  serverStarted: false,
  browserStarted: false,
});
if (!rejectedDiagnostic) throw new Error("K0-05 rejected diagnostic is absent");
for (const [name, mutation] of [
  ["diagnostic source", { ...rejectedDiagnostic, source: "server-secret.ts" }],
  ["diagnostic message", { ...rejectedDiagnostic, message: "boundary rejected" }],
  ["diagnostic range", { ...rejectedDiagnostic, range: { ...rejectedDiagnostic.range, column: 25 } }],
] as const) {
  try {
    verifySeededBoundaryRejection(mutation as typeof rejectedDiagnostic, canary, {
      writerStarted: false,
      serverStarted: false,
      browserStarted: false,
    });
    throw new Error(`K0-05 ${name} mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("mutation was accepted")) throw error;
  }
}
let acceptedCallbacks = 0;
let emitted = "";
const acceptedDiagnostic = runSeededBoundaryPipeline({
  handler: { sourceName: "accepted/control.ts", source: "export const accepted = true;" },
  serverCapability: { secret: canary },
  emitBrowserArtifact(source) { acceptedCallbacks += 1; emitted = source; },
  startServer() { acceptedCallbacks += 1; },
  startBrowser() { acceptedCallbacks += 1; },
});
if (acceptedDiagnostic || acceptedCallbacks !== 3 || !emitted.includes(canary)) {
  throw new Error("K0-05 accepted pipeline did not reach seeded browser boundaries");
}
if (
  EXTRACTION_QUALIFICATION_FIXTURES.some(
    (fixture) =>
      fixture.classification === "accepted" &&
      (!fixture.modules.some((module) => module.role === "handler") ||
        !fixture.edges.some((edge) => edge.kind === "lazy")),
  )
) {
  throw new Error("K0-05 accepted fixture lacks a lazy handler boundary");
}

const mutationRoot = mkdtempSync(join(tmpdir(), "fadeno-extraction-corpus-"));
try {
  cpSync(join(root, "experiments/extraction/fixtures"), mutationRoot, { recursive: true });
  appendFileSync(join(mutationRoot, "accepted/toggle.ts"), "\n// mutation\n");
  if (stableExtractionInventory(mutationRoot) === golden) {
    throw new Error("K0-05 source-byte mutation did not invalidate the golden corpus");
  }
} finally {
  rmSync(mutationRoot, { recursive: true, force: true });
}

console.log("extraction corpus contract passed (5 accepted, 10 rejected)");
