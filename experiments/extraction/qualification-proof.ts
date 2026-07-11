import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { scanImports } from "./import-scan.ts";
import {
  EXTRACTION_ACCEPTED_CLASSES,
} from "./fixtures/catalog.ts";
import {
  EXTRACTION_IDENTITY_CASES,
} from "./qualification-contract.ts";
import type { ExtractionProject } from "./contract.ts";

export type InteractionState = Readonly<Record<string, string | number | boolean>>;

export type ExtractionQualificationObservation = Readonly<{
  schemaVersion: 1;
  projectName: ExtractionProject;
  observedBrowser: ExtractionProject;
  fixtures: readonly Readonly<{
    fixtureId: (typeof EXTRACTION_ACCEPTED_CLASSES)[number];
    preTriggerRequests: readonly string[];
    firstTriggerRequests: readonly string[];
    laterRequests: readonly string[];
    disk: Readonly<{ path: string; sha256: string; bytes: number }>;
    response: Readonly<{
      path: string;
      body: string;
      contentType: string;
      sha256: string;
      bytes: number;
    }>;
    handlerIdentity: string;
    moduleEvaluations: number;
    handlerReferenceStable: boolean;
    interactions: readonly Readonly<{
      ordinal: number;
      before: InteractionState;
      after: InteractionState;
      effects: number;
    }>[];
    identity: readonly Readonly<{
      caseId: string;
      operation: string;
      ordinal: number;
      targetSame: boolean;
      handlerReferenceStable: boolean;
      moduleEvaluations: number;
      effectDelta: number;
      after: InteractionState;
    }>[];
  }>[];
}>;

export type GeneratedInventory = Readonly<{
  schemaVersion: 1;
  files: readonly Readonly<{
    fixtureId: string;
    path: string;
    sha256: string;
    bytes: number;
    handlerIdentity: string;
  }>[];
}>;

function counterValue(ordinal: number): number {
  const steps = [1, 2, -1, 3];
  let value = 0;
  for (let index = 0; index < ordinal; index += 1) value += steps[index % steps.length] ?? 0;
  return value;
}

export function expectedInteractionState(
  fixtureId: (typeof EXTRACTION_ACCEPTED_CLASSES)[number],
  ordinal: number,
): InteractionState {
  switch (fixtureId) {
    case "toggle":
    case "menu":
      return { expanded: ordinal % 2 === 1, hidden: ordinal % 2 === 0 };
    case "disclosure":
      return { open: ordinal % 2 === 1 };
    case "tabs":
      return {
        selected: ordinal % 2 === 1 ? "panel-b" : "panel-a",
        panelAHidden: ordinal % 2 === 1,
        panelBHidden: ordinal % 2 === 0,
      };
    case "local-counter":
      return { value: counterValue(ordinal) };
  }
}

export function verifyExtractionQualificationObservation(
  observation: ExtractionQualificationObservation,
  inventory: GeneratedInventory,
): void {
  if (
    observation.schemaVersion !== 1 ||
    observation.projectName !== observation.observedBrowser ||
    observation.fixtures.length !== EXTRACTION_ACCEPTED_CLASSES.length ||
    !isDeepStrictEqual(
      observation.fixtures.map((fixture) => fixture.fixtureId),
      EXTRACTION_ACCEPTED_CLASSES,
    )
  ) throw new Error("FADENO_EXTRACTION_QUALIFICATION_SHAPE");

  const inventoryByFixture = new Map(inventory.files.map((file) => [file.fixtureId, file]));
  for (const fixture of observation.fixtures) {
    const generated = inventoryByFixture.get(fixture.fixtureId);
    const handlerPath = `/handlers/${fixture.fixtureId}.js`;
    if (
      !generated ||
      fixture.disk.path !== generated.path ||
      fixture.disk.sha256 !== generated.sha256 ||
      fixture.disk.bytes !== generated.bytes ||
      fixture.handlerIdentity !== generated.handlerIdentity ||
      fixture.response.path !== handlerPath ||
      fixture.response.contentType !== "text/javascript" ||
      fixture.response.sha256 !== fixture.disk.sha256 ||
      fixture.response.bytes !== fixture.disk.bytes ||
      createHash("sha256").update(fixture.response.body).digest("hex") !==
        fixture.response.sha256 ||
      scanImports(fixture.response.body).length !== 0 ||
      /(?:fragment|hydrate|component-runtime|server-only)/u.test(fixture.response.body) ||
      !isDeepStrictEqual(fixture.preTriggerRequests, ["/", "/document.js"]) ||
      !isDeepStrictEqual(fixture.firstTriggerRequests, [handlerPath]) ||
      fixture.laterRequests.length !== 0 ||
      fixture.moduleEvaluations !== 1 ||
      !fixture.handlerReferenceStable ||
      fixture.interactions.length !== 100 ||
      fixture.identity.length !== EXTRACTION_IDENTITY_CASES.length
    ) throw new Error(`FADENO_EXTRACTION_QUALIFICATION_FIXTURE: ${fixture.fixtureId}`);

    for (let index = 0; index < fixture.interactions.length; index += 1) {
      const record = fixture.interactions[index]!;
      const ordinal = index + 1;
      if (
        record.ordinal !== ordinal ||
        record.effects !== ordinal ||
        !isDeepStrictEqual(record.before, expectedInteractionState(fixture.fixtureId, ordinal - 1)) ||
        !isDeepStrictEqual(record.after, expectedInteractionState(fixture.fixtureId, ordinal))
      ) throw new Error(`FADENO_EXTRACTION_QUALIFICATION_ORDINAL: ${fixture.fixtureId}:${ordinal}`);
    }
    for (let index = 0; index < fixture.identity.length; index += 1) {
      const record = fixture.identity[index]!;
      const expected = EXTRACTION_IDENTITY_CASES[index]!;
      const ordinal = 101 + index;
      if (
        record.caseId !== expected.id ||
        record.operation !== expected.operation ||
        record.ordinal !== ordinal ||
        !record.targetSame ||
        !record.handlerReferenceStable ||
        record.moduleEvaluations !== 1 ||
        record.effectDelta !== 1 ||
        !isDeepStrictEqual(record.after, expectedInteractionState(fixture.fixtureId, ordinal))
      ) throw new Error(`FADENO_EXTRACTION_QUALIFICATION_IDENTITY: ${fixture.fixtureId}:${expected.id}`);
    }
  }
}
