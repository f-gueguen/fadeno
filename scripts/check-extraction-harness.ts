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
