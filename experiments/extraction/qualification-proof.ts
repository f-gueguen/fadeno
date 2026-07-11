import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { scanImports } from "./import-scan.ts";
import { MORPH_QUALIFICATION_CASES } from "../morph/fixtures/qualification-corpus.ts";
import { createMorphQualificationScenario } from "../morph/qualification-scenarios.ts";
import { morphQualificationStatePreserved } from "../morph/qualification-state.ts";
import {
  EXTRACTION_ACCEPTED_CLASSES,
} from "./fixtures/catalog.ts";
import {
  EXTRACTION_IDENTITY_CASES,
} from "./qualification-contract.ts";
import type { ExtractionProject } from "./contract.ts";

export type InteractionState = Readonly<Record<string, string | number | boolean>>;

export type PassedExtractionQualificationFixture = Readonly<{
  status: "passed";
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
      scenarioTargetSame: boolean;
      reusedScenarioTarget: boolean;
      scenarioState: string;
      scenarioStateBefore: Readonly<Record<string, unknown>>;
      scenarioStateAfter: Readonly<Record<string, unknown>>;
      scenarioObservationMilliseconds: number;
      targetIdentity: string;
      operationParentIdentity: string;
      beforeOrder: readonly string[];
      afterOrder: readonly string[];
      handlerReferenceStable: boolean;
      moduleEvaluations: number;
      effectDelta: number;
      after: InteractionState;
    }>[];
}>;
export type FailedExtractionQualificationFixture = Readonly<{
  status: "failed";
  fixtureId: (typeof EXTRACTION_ACCEPTED_CLASSES)[number];
  failureStage: "interaction" | "identity";
  failure: string;
}>;

export type ExtractionQualificationObservation = Readonly<{
  schemaVersion: 1;
  projectName: ExtractionProject;
  observedBrowser: ExtractionProject;
  fixtures: readonly (
    | PassedExtractionQualificationFixture
    | FailedExtractionQualificationFixture
  )[];
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

export type ExtractionDecision = "go" | "narrow" | "pivot";

export function decideExtractionOutcome(input: Readonly<{
  accepted: readonly string[];
  rejectedBoundariesPass: boolean;
  identityPass: boolean;
  deterministicGenerationPass: boolean;
  outputSafetyPass: boolean;
}>): ExtractionDecision {
  if (
    !input.rejectedBoundariesPass ||
    !input.identityPass ||
    !input.deterministicGenerationPass ||
    !input.outputSafetyPass
  ) return "pivot";
  if (isDeepStrictEqual([...input.accepted].sort(), [...EXTRACTION_ACCEPTED_CLASSES].sort())) {
    return "go";
  }
  const narrow = ["toggle", "disclosure", "menu", "local-counter"].sort();
  return isDeepStrictEqual([...input.accepted].sort(), narrow) ? "narrow" : "pivot";
}

export function decideExtractionObservations(
  observations: ReadonlyMap<ExtractionProject, ExtractionQualificationObservation>,
  boundaries: Readonly<{
    rejectedBoundariesPass: boolean;
    identityPass: boolean;
    deterministicGenerationPass: boolean;
    outputSafetyPass: boolean;
  }>,
): Readonly<{ decision: ExtractionDecision; accepted: readonly string[] }> {
  const accepted = EXTRACTION_ACCEPTED_CLASSES.filter((fixtureId) =>
    [...observations.values()].every((observation) =>
      observation.fixtures.some((fixture) =>
        fixture.fixtureId === fixtureId && fixture.status === "passed"
      )
    )
  );
  return {
    accepted,
    decision: decideExtractionOutcome({ accepted, ...boundaries }),
  };
}

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
    if (fixture.status === "failed") {
      if (
        !["interaction", "identity"].includes(fixture.failureStage) ||
        fixture.failure.trim() === ""
      ) {
        throw new Error(`FADENO_EXTRACTION_QUALIFICATION_FAILURE: ${fixture.fixtureId}`);
      }
      continue;
    }
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
      const morphFixture = MORPH_QUALIFICATION_CASES.find((item) => item.id === expected.id);
      if (!morphFixture) {
        throw new Error(`FADENO_EXTRACTION_QUALIFICATION_H1_CASE: ${expected.id}`);
      }
      const scenario = createMorphQualificationScenario(morphFixture);
      const expectedBeforeOrder = scenario.operationParentIdentity === "root"
        ? [...scenario.beforeOrder, "handler-trigger"]
        : scenario.beforeOrder;
      const expectedAfterOrder = scenario.operationParentIdentity === "root"
        ? [...scenario.afterOrder, "handler-trigger"]
        : scenario.afterOrder;
      const ordinal = 101 + index;
      const expectedStatePass = ![
        "document-scroll",
        "element-scroll",
      ].includes(scenario.fixture.state);
      if (
        record.caseId !== expected.id ||
        record.operation !== expected.operation ||
        record.ordinal !== ordinal ||
        !record.targetSame ||
        !record.scenarioTargetSame ||
        !record.reusedScenarioTarget ||
        record.scenarioState !== expected.state ||
        record.targetIdentity !== scenario.fixture.targetIdentity ||
        record.operationParentIdentity !== scenario.operationParentIdentity ||
        !isDeepStrictEqual(record.beforeOrder, expectedBeforeOrder) ||
        !isDeepStrictEqual(record.afterOrder, expectedAfterOrder) ||
        !Number.isFinite(record.scenarioObservationMilliseconds) ||
        record.scenarioObservationMilliseconds < 0 ||
        morphQualificationStatePreserved(
          scenario.fixture.state,
          record.scenarioStateBefore,
          record.scenarioStateAfter,
          record.scenarioObservationMilliseconds,
        ) !== expectedStatePass ||
        !record.handlerReferenceStable ||
        record.moduleEvaluations !== 1 ||
        record.effectDelta !== 1 ||
        !isDeepStrictEqual(record.after, expectedInteractionState(fixture.fixtureId, ordinal))
      ) throw new Error(`FADENO_EXTRACTION_QUALIFICATION_IDENTITY: ${fixture.fixtureId}:${expected.id}`);
    }
  }
}
