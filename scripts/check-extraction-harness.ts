import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTRACTION_ACCEPTED_CLASSES,
  EXTRACTION_FIXTURES,
  EXTRACTION_REJECTION_CLASSES,
  stableExtractionInventory,
} from "../experiments/extraction/fixtures/catalog.ts";
import { verifyAcceptedObservation } from "../experiments/extraction/accepted-proof.ts";
import type { ExtractionObservation } from "../experiments/extraction/contract.ts";
import {
  DOCUMENT_MODULE,
  HANDLER_MODULE,
  SHARED_MODULE,
} from "../experiments/extraction/runtime-fixture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const golden = readFileSync(
  join(root, "experiments/extraction/fixtures/inventory.golden.json"),
  "utf8",
);

if (stableExtractionInventory() !== golden) {
  throw new Error("K0-05 extraction corpus differs from its checked golden projection");
}
if (
  EXTRACTION_ACCEPTED_CLASSES.length !== 5 ||
  EXTRACTION_REJECTION_CLASSES.length !== 10 ||
  EXTRACTION_FIXTURES.length !== 15 ||
  new Set(EXTRACTION_FIXTURES.map((fixture) => fixture.id)).size !== 15
) {
  throw new Error("K0-05 extraction corpus cardinality or identity differs");
}

const observation: ExtractionObservation = {
  schemaVersion: 1,
  engine: "chromium",
  preTriggerRequests: ["/", "/document.js"],
  firstTriggerRequests: ["/handler.js", "/shared.js"],
  secondTriggerRequests: [],
  responseSources: {
    "/document.js": DOCUMENT_MODULE,
    "/handler.js": HANDLER_MODULE,
    "/shared.js": SHARED_MODULE,
  },
  valueWhileHandlerBlocked: "0",
  valueAfterFirstTrigger: "1",
  valueAfterSecondTrigger: "2",
  noJavaScriptValue: "0",
  noJavaScriptRequests: ["/"],
};
verifyAcceptedObservation(observation);
for (const [name, mutate] of [
  ["early handler request", (value: ExtractionObservation) => ({ ...value, preTriggerRequests: ["/", "/document.js", "/handler.js"] })],
  ["inlined handler", (value: ExtractionObservation) => ({ ...value, responseSources: { ...value.responseSources, "/document.js": `${DOCUMENT_MODULE}\nfadeno-handler-only-sentinel` } })],
  ["extra first request", (value: ExtractionObservation) => ({ ...value, firstTriggerRequests: ["/handler.js", "/shared.js", "/fragment.js"] })],
  ["forbidden module", (value: ExtractionObservation) => ({ ...value, responseSources: { ...value.responseSources, "/handler.js": `${HANDLER_MODULE}\n// server-only` } })],
  ["second-click-only", (value: ExtractionObservation) => ({ ...value, valueAfterFirstTrigger: "0" })],
] as const) {
  try {
    verifyAcceptedObservation(mutate(observation) as ExtractionObservation);
    throw new Error(`K0-05 ${name} mutation was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === `K0-05 ${name} mutation was accepted`) throw error;
  }
}
if (
  EXTRACTION_FIXTURES.some(
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
