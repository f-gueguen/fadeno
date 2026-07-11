import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MORPH_QUALIFICATION_CASES } from "../morph/fixtures/qualification-corpus.ts";
import {
  EXTRACTION_ACCEPTED_CLASSES,
  EXTRACTION_REJECTION_CLASSES,
} from "./fixtures/catalog.ts";

export const EXTRACTION_CORE_NARROW_CLASSES = [
  "toggle",
  "disclosure",
  "menu",
  "local-counter",
] as const;

export const EXTRACTION_DECISION_POLICY = Object.freeze({
  go: "all-five-accepted-and-all-boundaries-pass",
  narrow: "only-tabs-fails-and-the-four-core-classes-and-all-boundaries-pass",
  pivot: "any-core-identity-boundary-determinism-or-safety-failure",
});

export const EXTRACTION_IDENTITY_CASES = MORPH_QUALIFICATION_CASES
  .filter((fixture) => fixture.id !== "intentional-replacement-control")
  .map((fixture) => Object.freeze({
    id: fixture.id,
    operation: fixture.operation,
    state: fixture.state,
  }));

export const EXTRACTION_DIAGNOSTIC_EXPECTATIONS = Object.freeze({
  "server-secret": "FADENO_K0_EXTRACT_SERVER_IMPORT",
  "server-module": "FADENO_K0_EXTRACT_SERVER_IMPORT",
  "opaque-capability": "FADENO_K0_EXTRACT_OPAQUE_CAPTURE",
  "class-instance": "FADENO_K0_EXTRACT_CLASS_CAPTURE",
  "cyclic-data": "FADENO_K0_EXTRACT_CYCLIC_CAPTURE",
  "dynamic-import": "FADENO_K0_EXTRACT_DYNAMIC_IMPORT",
  "ambient-switch": "FADENO_K0_EXTRACT_AMBIENT_CAPTURE",
  "async-lifetime": "FADENO_K0_EXTRACT_ASYNC_LIFETIME",
  "oversized-capture": "FADENO_K0_EXTRACT_CAPTURE_SIZE",
  "non-deterministic-closure": "FADENO_K0_EXTRACT_NON_DETERMINISTIC_CAPTURE",
});

const root = dirname(fileURLToPath(import.meta.url));

export function stableExtractionQualificationContract(): string {
  const rootsPath = join(root, "fixtures/qualification/roots.ts");
  const roots = readFileSync(rootsPath);
  if (
    EXTRACTION_ACCEPTED_CLASSES.length !== 5 ||
    EXTRACTION_REJECTION_CLASSES.length !== 10 ||
    EXTRACTION_IDENTITY_CASES.length !== 17 ||
    Object.keys(EXTRACTION_DIAGNOSTIC_EXPECTATIONS).length !== 10
  ) {
    throw new Error("FADENO_EXTRACTION_QUALIFICATION_CARDINALITY");
  }
  return `${JSON.stringify({
    schemaVersion: 1,
    visibility: "private-qualification-contract",
    acceptedClasses: EXTRACTION_ACCEPTED_CLASSES,
    coreNarrowClasses: EXTRACTION_CORE_NARROW_CLASSES,
    rejectedClasses: EXTRACTION_REJECTION_CLASSES,
    decisionPolicy: EXTRACTION_DECISION_POLICY,
    diagnostics: EXTRACTION_DIAGNOSTIC_EXPECTATIONS,
    identityCases: EXTRACTION_IDENTITY_CASES,
    roots: {
      path: "fixtures/qualification/roots.ts",
      sha256: createHash("sha256").update(roots).digest("hex"),
    },
    interactionOrdinals: 100,
    retries: 0,
  })}\n`;
}
