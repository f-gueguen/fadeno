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

export const EXTRACTION_ROOT_EXPORTS = Object.freeze({
  toggle: "toggleRoot",
  disclosure: "disclosureRoot",
  tabs: "tabsRoot",
  menu: "menuRoot",
  "local-counter": "localCounterRoot",
  "server-secret": "serverSecretRoot",
  "server-module": "serverModuleRoot",
  "opaque-capability": "opaqueCapabilityRoot",
  "class-instance": "classInstanceRoot",
  "cyclic-data": "cyclicDataRoot",
  "dynamic-import": "dynamicImportRoot",
  "ambient-switch": "ambientSwitchRoot",
  "async-lifetime": "asyncLifetimeRoot",
  "oversized-capture": "oversizedCaptureRoot",
  "non-deterministic-closure": "nonDeterministicClosureRoot",
});

const diagnostic = (
  id: string,
  message: string,
  correction: string,
) => Object.freeze({
  id,
  severity: "error",
  message,
  explanation: `docs/diagnostics/extraction.md#${id.toLowerCase().replaceAll("_", "-")}`,
  correction,
});

export const EXTRACTION_DIAGNOSTIC_EXPECTATIONS = Object.freeze({
  "server-secret": diagnostic("FADENO_K0_EXTRACT_SERVER_IMPORT", "A browser handler cannot reach a server-only import.", "Move secret access behind a resource or action."),
  "server-module": diagnostic("FADENO_K0_EXTRACT_SERVER_IMPORT", "A browser handler cannot reach a server-only import.", "Move database access behind a resource or action."),
  "opaque-capability": diagnostic("FADENO_K0_EXTRACT_OPAQUE_CAPTURE", "A browser handler cannot capture an opaque capability.", "Create the capability inside an explicit island."),
  "class-instance": diagnostic("FADENO_K0_EXTRACT_CLASS_CAPTURE", "A browser handler cannot capture a class instance.", "Capture plain serializable data or use an explicit island."),
  "cyclic-data": diagnostic("FADENO_K0_EXTRACT_CYCLIC_CAPTURE", "A browser handler cannot capture cyclic data.", "Break the cycle and capture bounded plain data."),
  "dynamic-import": diagnostic("FADENO_K0_EXTRACT_DYNAMIC_IMPORT", "A browser handler cannot use a non-literal dynamic import.", "Use a statically declared browser dependency."),
  "ambient-switch": diagnostic("FADENO_K0_EXTRACT_AMBIENT_CAPTURE", "A shared dependency cannot switch on an ambient environment global.", "Split server and browser modules at a visible source boundary."),
  "async-lifetime": diagnostic("FADENO_K0_EXTRACT_ASYNC_LIFETIME", "An extracted handler cannot start an unbounded async lifetime.", "Use an explicit island with teardown ownership."),
  "oversized-capture": diagnostic("FADENO_K0_EXTRACT_CAPTURE_SIZE", "A browser handler capture exceeds the 65536-byte experiment limit.", "Pass a smaller plain-data value or use an explicit island."),
  "non-deterministic-closure": diagnostic("FADENO_K0_EXTRACT_NON_DETERMINISTIC_CAPTURE", "A browser handler cannot capture a non-deterministic initializer.", "Compute the value in an explicit state home."),
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
    rootExports: EXTRACTION_ROOT_EXPORTS,
    identityCases: EXTRACTION_IDENTITY_CASES,
    roots: {
      path: "fixtures/qualification/roots.ts",
      sha256: createHash("sha256").update(roots).digest("hex"),
    },
    interactionOrdinals: 100,
    retries: 0,
  })}\n`;
}
