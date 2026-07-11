import { isDeepStrictEqual } from "node:util";

import { MORPH_PROJECTS } from "./contract.ts";
import type { MorphProject } from "./contract.ts";
import {
  MORPH_QUALIFICATION_CASES,
  MORPH_QUALIFICATION_PROFILES,
} from "./fixtures/qualification-corpus.ts";
import type {
  MorphQualificationCase,
  QualificationState,
  StructuralOperation,
} from "./fixtures/qualification-corpus.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

export type QualificationSnapshot = Readonly<{
  serverClass: string;
  order: readonly string[];
  rootOriginal: boolean;
  targetOriginal: boolean;
  originalTargetConnected: boolean;
  currentTargetConnected: boolean;
  ancestorsOriginal: boolean;
  expandoPreserved: boolean;
  listenerHits: number;
  sameFileObject: boolean | null;
  islandLifecycleStable: boolean | null;
  topLayerStable: boolean | null;
  state: Readonly<Record<string, unknown>>;
}>;

export type QualificationRecord = Readonly<{
  schemaVersion: 1;
  profile: MorphQualificationProfile;
  engine: MorphProject;
  caseId: string;
  state: QualificationState;
  operation: StructuralOperation | "intentional-replacement";
  ordinal: number;
  key: string;
  completed: true;
  candidateRoundTripMilliseconds: number;
  observationWindowMilliseconds: number;
  documentElementCount: number;
  candidate: Readonly<{
    rootIdentity: string;
    reusedIdentities: readonly string[];
    replacedIdentities: readonly string[];
  }>;
  before: QualificationSnapshot;
  after: QualificationSnapshot;
  instrumentation: Readonly<{
    setterCalls: readonly string[];
    methodCalls: readonly string[];
    events: readonly string[];
    blockedRequests: readonly string[];
    pageErrors: readonly string[];
    unhandledRejections: readonly string[];
  }>;
}>;

export class MorphQualificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MorphQualificationError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MorphQualificationError(code, message);
}

function exactKeys(value: unknown, expected: readonly string[], label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("FADENO_MORPH_QUALIFICATION_SHAPE", `${label}: expected object`);
  }
  const actual = Object.keys(value);
  const expectedSet = new Set(expected);
  if (
    actual.length !== expected.length ||
    expectedSet.size !== expected.length ||
    actual.some((key) => !expectedSet.has(key))
  ) {
    fail("FADENO_MORPH_QUALIFICATION_SHAPE", `${label}: keys differ`);
  }
}

const QUALIFICATION_RECORD_KEYS = [
  "schemaVersion",
  "profile",
  "engine",
  "caseId",
  "state",
  "operation",
  "ordinal",
  "key",
  "completed",
  "candidateRoundTripMilliseconds",
  "observationWindowMilliseconds",
  "documentElementCount",
  "candidate",
  "before",
  "after",
  "instrumentation",
] as const;
const QUALIFICATION_SNAPSHOT_KEYS = [
  "serverClass",
  "order",
  "rootOriginal",
  "targetOriginal",
  "originalTargetConnected",
  "currentTargetConnected",
  "ancestorsOriginal",
  "expandoPreserved",
  "listenerHits",
  "sameFileObject",
  "islandLifecycleStable",
  "topLayerStable",
  "state",
] as const;
const QUALIFICATION_INSTRUMENTATION_KEYS = [
  "setterCalls",
  "methodCalls",
  "events",
  "blockedRequests",
  "pageErrors",
  "unhandledRejections",
] as const;

export type QualificationFailureOperation = Readonly<{
  profile: MorphQualificationProfile;
  engine: MorphProject;
  caseId: string;
  state: QualificationState;
  operation: StructuralOperation | "intentional-replacement";
  ordinal: number;
  failure: string;
}>;

export type QualificationFailureEvidence = Readonly<{
  operation: QualificationFailureOperation;
  observation: QualificationRecord;
}>;

export type QualificationFailureClassification = Readonly<{
  key: string;
  categories: readonly string[];
}>;

export function verifyQualificationFailureAlignment(
  operation: unknown,
  observation: unknown,
  profile: MorphQualificationProfile,
  engine: MorphProject,
): void {
  exactKeys(
    operation,
    ["profile", "engine", "caseId", "state", "operation", "ordinal", "failure"],
    `${engine}.failure-operation`,
  );
  exactKeys(observation, QUALIFICATION_RECORD_KEYS, `${engine}.failure-before-after`);
  const failure = operation as QualificationFailureOperation;
  const record = observation as QualificationRecord;
  const fixture = MORPH_QUALIFICATION_CASES.find(
    (candidate) => candidate.id === failure.caseId,
  );
  if (
    failure.profile !== profile ||
    failure.engine !== engine ||
    typeof failure.caseId !== "string" ||
    typeof failure.state !== "string" ||
    typeof failure.operation !== "string" ||
    !Number.isInteger(failure.ordinal) ||
    failure.ordinal < 1 ||
    typeof failure.failure !== "string" ||
    failure.failure.length === 0 ||
    !fixture ||
    failure.state !== fixture.state ||
    failure.operation !== fixture.operation ||
    failure.ordinal > qualificationRepetitions(profile) ||
    record.schemaVersion !== 1 ||
    record.profile !== failure.profile ||
    record.engine !== failure.engine ||
    record.caseId !== failure.caseId ||
    record.state !== failure.state ||
    record.operation !== failure.operation ||
    record.ordinal !== failure.ordinal ||
    record.key !== `${engine}/${record.caseId}/${record.ordinal}` ||
    record.completed !== true
  ) {
    fail("FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", `${engine}: failure context is misaligned`);
  }
  exactKeys(record.candidate, ["rootIdentity", "reusedIdentities", "replacedIdentities"], `${engine}.failure-candidate`);
  exactKeys(record.before, QUALIFICATION_SNAPSHOT_KEYS, `${engine}.failure-before`);
  exactKeys(record.after, QUALIFICATION_SNAPSHOT_KEYS, `${engine}.failure-after`);
  exactKeys(
    record.instrumentation,
    QUALIFICATION_INSTRUMENTATION_KEYS,
    `${engine}.failure-instrumentation`,
  );
  if (
    !Number.isFinite(record.candidateRoundTripMilliseconds) ||
    record.candidateRoundTripMilliseconds < 0 ||
    !Number.isFinite(record.observationWindowMilliseconds) ||
    record.observationWindowMilliseconds < record.candidateRoundTripMilliseconds ||
    !Number.isInteger(record.documentElementCount) ||
    record.documentElementCount < 4
  ) {
    fail("FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", `${engine}: failure metrics differ`);
  }
}

const OBSERVED_FAILURE_CODES = new Set([
  "FADENO_MORPH_QUALIFICATION_CANDIDATE",
  "FADENO_MORPH_QUALIFICATION_CONTINUITY",
  "FADENO_MORPH_QUALIFICATION_FILE",
  "FADENO_MORPH_QUALIFICATION_ISLAND",
  "FADENO_MORPH_QUALIFICATION_OPERATION",
  "FADENO_MORPH_QUALIFICATION_REPLACEMENT",
  "FADENO_MORPH_QUALIFICATION_STATE",
  "FADENO_MORPH_QUALIFICATION_TOP_LAYER",
  "FADENO_MORPH_QUALIFICATION_TRANSIENT",
]);

function observedFailureCode(record: QualificationRecord, profile: MorphQualificationProfile): string {
  try {
    assertRecord(record, profile);
  } catch (error: unknown) {
    if (error instanceof MorphQualificationError && OBSERVED_FAILURE_CODES.has(error.code)) {
      return error.code;
    }
    throw error;
  }
  fail(
    "FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE",
    `${record.key}: passing observation was declared failed`,
  );
}

export function classifyQualificationFailure(
  record: QualificationRecord,
  profile: MorphQualificationProfile,
): QualificationFailureClassification {
  const code = observedFailureCode(record, profile);
  if (record.state === "document-scroll" || record.state === "element-scroll") {
    const expectedEvent = record.state === "document-scroll" ? "window-scroll" : "scroll";
    const normalized = structuredClone(record) as QualificationRecord;
    (normalized.after as { state: Readonly<Record<string, unknown>> }).state = normalized.before.state;
    (normalized.instrumentation as { events: readonly string[] }).events = [];
    if (
      !isDeepStrictEqual(record.after.state, record.before.state) &&
      isDeepStrictEqual(record.instrumentation.events, [expectedEvent])
    ) {
      try {
        assertRecord(normalized, profile);
        return { key: record.key, categories: ["scroll-position", "scroll-event"] };
      } catch {
        // Fall through to the independently derived general predicate below.
      }
    }
  }
  return { key: record.key, categories: [code] };
}

function expectedState(state: QualificationState): Readonly<Record<string, unknown>> | null {
  switch (state) {
    case "focused-input-selection":
      return { value: "client-dirty", focused: true, selectionStart: 2, selectionEnd: 8 };
    case "focused-textarea-selection":
      return { value: "client-dirty", focused: true, selectionStart: 1, selectionEnd: 7 };
    case "focused-contenteditable-caret":
      return {
        text: "editable-value",
        focused: true,
        anchorInTarget: true,
        focusInTarget: true,
        anchorOffset: 4,
        focusOffset: 4,
        collapsed: true,
      };
    case "dirty-text":
      return { value: "client-dirty" };
    case "dirty-checkbox":
      return { checked: true };
    case "dirty-radio":
      return { checkedA: true, checkedB: false };
    case "dirty-select":
      return { value: "b", selectedIndex: 1 };
    case "dirty-file":
      return null;
    case "details-open":
      return { open: true };
    case "dialog-modal":
      return { open: true, modal: true };
    case "dialog-nonmodal":
      return { open: true, modal: false };
    case "popover-open":
      return { open: true };
    case "media-playing":
      return null;
    case "media-paused":
      return null;
    case "document-scroll":
      return { x: 0, y: 400 };
    case "element-scroll":
      return { left: 0, top: 120 };
    case "island-identity":
      return { connectedCount: 1, disconnectedCount: 0 };
    case "intentional-replacement":
      return null;
  }
}

function assertMediaState(
  state: QualificationState,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  label: string,
  observationWindowMilliseconds: number,
): void {
  exactKeys(before, ["paused", "currentTime", "readyState", "playbackRate"], `${label}.before.state`);
  exactKeys(after, ["paused", "currentTime", "readyState", "playbackRate"], `${label}.after.state`);
  const beforeTime = before.currentTime;
  const afterTime = after.currentTime;
  if (
    typeof beforeTime !== "number" ||
    typeof afterTime !== "number" ||
    typeof before.playbackRate !== "number" ||
    typeof after.playbackRate !== "number" ||
    typeof before.readyState !== "number" ||
    typeof after.readyState !== "number" ||
    before.readyState < 2 ||
    after.readyState < 2
  ) {
    fail("FADENO_MORPH_QUALIFICATION_STATE", `${label}: media state is invalid`);
  }
  if (state === "media-playing") {
    if (
      before.paused !== false ||
      after.paused !== false ||
      before.playbackRate !== 0.5 ||
      after.playbackRate !== 0.5 ||
      beforeTime <= 0.02 ||
      afterTime < beforeTime - 0.01 ||
      afterTime > beforeTime + observationWindowMilliseconds / 1_000 * 0.5 + 0.1
    ) {
      fail("FADENO_MORPH_QUALIFICATION_STATE", `${label}: playing media continuity differs`);
    }
  } else if (
    before.paused !== true ||
    after.paused !== true ||
    before.playbackRate !== 1 ||
    after.playbackRate !== 1 ||
    Math.abs(beforeTime - 0.25) > 0.002 ||
    Math.abs(afterTime - beforeTime) > 0.002
  ) {
    fail("FADENO_MORPH_QUALIFICATION_STATE", `${label}: paused media continuity differs`);
  }
}

function assertFileState(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  label: string,
): void {
  const keys = ["name", "contentType", "bytes", "lastModified", "text"];
  exactKeys(before, keys, `${label}.before.state`);
  exactKeys(after, keys, `${label}.after.state`);
  if (
    before.name !== "qualification.txt" ||
    before.contentType !== "text/plain" ||
    before.bytes !== 18 ||
    before.text !== "fadeno-k0-04-file\n" ||
    typeof before.lastModified !== "number" ||
    before.lastModified <= 0 ||
    !isDeepStrictEqual(after, before)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_FILE", `${label}: selected file state differs`);
  }
}

function assertStructuralOperation(
  record: QualificationRecord,
  fixture: MorphQualificationCase,
  label: string,
): void {
  const before = record.before.order;
  const after = record.after.order;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  if (
    before.length === 0 ||
    after.length === 0 ||
    before.length !== beforeSet.size ||
    after.length !== afterSet.size ||
    before.some((identity) => identity.length === 0) ||
    after.some((identity) => identity.length === 0)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: structural identities are invalid`);
  }
  if (record.operation === "insert-keyed") {
    const inserted = after.filter((identity) => !beforeSet.has(identity));
    if (!isDeepStrictEqual(inserted, ["inserted-peer"]) || before.some((id) => !afterSet.has(id))) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: insertion proof differs`);
    }
    if (
      fixture.structuralStress === "insert-inside-scroll-container-before-content"
        ? !isDeepStrictEqual(before, ["scroll-content"]) ||
          !isDeepStrictEqual(after, ["inserted-peer", "scroll-content"])
        : before.indexOf(fixture.targetIdentity) < 0 ||
          after[0] !== "inserted-peer" ||
          after.indexOf(fixture.targetIdentity) !== before.indexOf(fixture.targetIdentity) + 1
    ) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: insertion stress differs`);
    }
  } else if (record.operation === "remove-keyed") {
    const removed = before.filter((identity) => !afterSet.has(identity));
    if (!isDeepStrictEqual(removed, ["removed-peer"]) || after.some((id) => !beforeSet.has(id))) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: removal proof differs`);
    }
    if (
      before[0] !== "removed-peer" ||
      before.indexOf(fixture.targetIdentity) !== after.indexOf(fixture.targetIdentity) + 1
    ) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: removal stress differs`);
    }
  } else if (record.operation === "reorder-keyed") {
    if (
      isDeepStrictEqual(before, after) ||
      before.length !== after.length ||
      before.some((id) => !afterSet.has(id))
    ) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: reorder proof differs`);
    }
    if (before[0] !== "peer-a" || after[0] !== fixture.targetIdentity) {
      fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: target reorder stress differs`);
    }
  } else if (!isDeepStrictEqual(before, after)) {
    fail("FADENO_MORPH_QUALIFICATION_OPERATION", `${label}: replacement order differs`);
  }
}

function assertRecord(record: QualificationRecord, profile: MorphQualificationProfile): void {
  const fixture = MORPH_QUALIFICATION_CASES.find((candidate) => candidate.id === record.caseId);
  if (!fixture) fail("FADENO_MORPH_QUALIFICATION_CASE", `${record.caseId}: unknown case`);
  const label = `${record.engine}/${record.caseId}/${record.ordinal}`;
  exactKeys(
    record,
    QUALIFICATION_RECORD_KEYS,
    label,
  );
  if (
    record.schemaVersion !== 1 ||
    record.profile !== profile ||
    record.state !== fixture.state ||
    record.operation !== fixture.operation ||
    record.key !== `${record.engine}/${record.caseId}/${record.ordinal}` ||
    record.completed !== true ||
    !Number.isFinite(record.candidateRoundTripMilliseconds) ||
    record.candidateRoundTripMilliseconds < 0 ||
    !Number.isFinite(record.observationWindowMilliseconds) ||
    record.observationWindowMilliseconds < record.candidateRoundTripMilliseconds ||
    !Number.isInteger(record.documentElementCount) ||
    record.documentElementCount < 4
  ) {
    fail("FADENO_MORPH_QUALIFICATION_RECORD", `${label}: record metadata differs`);
  }
  exactKeys(record.candidate, ["rootIdentity", "reusedIdentities", "replacedIdentities"], `${label}.candidate`);
  if (
    record.candidate.rootIdentity !== "root" ||
    !record.candidate.reusedIdentities.includes("root") ||
    new Set(record.candidate.reusedIdentities).size !== record.candidate.reusedIdentities.length ||
    new Set(record.candidate.replacedIdentities).size !== record.candidate.replacedIdentities.length
  ) {
    fail("FADENO_MORPH_QUALIFICATION_CANDIDATE", `${label}: candidate identity proof differs`);
  }
  exactKeys(
    record.before,
    QUALIFICATION_SNAPSHOT_KEYS,
    `${label}.before`,
  );
  exactKeys(record.after, Object.keys(record.before), `${label}.after`);
  exactKeys(
    record.instrumentation,
    QUALIFICATION_INSTRUMENTATION_KEYS,
    `${label}.instrumentation`,
  );
  for (const [name, values] of Object.entries(record.instrumentation)) {
    if (!Array.isArray(values) || values.length !== 0) {
      fail("FADENO_MORPH_QUALIFICATION_TRANSIENT", `${label}: ${name} is not empty`);
    }
  }
  if (
    record.before.serverClass !== "before" ||
    record.after.serverClass !== "after" ||
    record.before.rootOriginal !== true ||
    record.after.rootOriginal !== true ||
    record.before.targetOriginal !== true ||
    record.before.originalTargetConnected !== true ||
    record.before.currentTargetConnected !== true ||
    record.before.ancestorsOriginal !== true ||
    record.before.expandoPreserved !== true ||
    record.before.listenerHits !== 0
  ) {
    fail("FADENO_MORPH_QUALIFICATION_CONTINUITY", `${label}: initial continuity differs`);
  }

  const replacement = record.state === "intentional-replacement";
  if (replacement) {
    if (
      record.after.targetOriginal !== false ||
      record.after.originalTargetConnected !== false ||
      record.after.currentTargetConnected !== true ||
      record.after.expandoPreserved !== false ||
      record.after.listenerHits !== 0 ||
      !isDeepStrictEqual(record.before.state, { text: "before" }) ||
      !isDeepStrictEqual(record.after.state, { text: "after" }) ||
      !isDeepStrictEqual(record.candidate.replacedIdentities, [fixture.targetIdentity]) ||
      record.candidate.reusedIdentities.includes(fixture.targetIdentity)
    ) {
      fail("FADENO_MORPH_QUALIFICATION_REPLACEMENT", `${label}: replacement proof differs`);
    }
  } else {
    if (
      record.after.targetOriginal !== true ||
      record.after.originalTargetConnected !== true ||
      record.after.currentTargetConnected !== true ||
      record.after.ancestorsOriginal !== true ||
      record.after.expandoPreserved !== true ||
      record.after.listenerHits !== 1 ||
      !record.candidate.reusedIdentities.includes(fixture.targetIdentity) ||
      record.candidate.replacedIdentities.length !== 0
    ) {
      fail("FADENO_MORPH_QUALIFICATION_CONTINUITY", `${label}: retained identity proof differs`);
    }
    if (record.state === "media-playing" || record.state === "media-paused") {
      assertMediaState(
        record.state,
        record.before.state,
        record.after.state,
        label,
        record.observationWindowMilliseconds,
      );
    } else if (record.state === "dirty-file") {
      assertFileState(record.before.state, record.after.state, label);
    } else {
      const expected = expectedState(record.state);
      if (
        !expected ||
        !isDeepStrictEqual(record.before.state, expected) ||
        !isDeepStrictEqual(record.after.state, expected)
      ) {
        fail("FADENO_MORPH_QUALIFICATION_STATE", `${label}: exact state differs`);
      }
    }
  }
  if (
    record.state === "dirty-file" &&
    (record.before.sameFileObject !== true || record.after.sameFileObject !== true)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_FILE", `${label}: File object identity differs`);
  }
  if (
    record.state !== "dirty-file" &&
    (record.before.sameFileObject !== null || record.after.sameFileObject !== null)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_FILE", `${label}: unexpected file proof`);
  }
  if (
    record.state === "island-identity" &&
    (record.before.islandLifecycleStable !== true || record.after.islandLifecycleStable !== true)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_ISLAND", `${label}: island lifecycle differs`);
  }
  if (
    record.state !== "island-identity" &&
    (record.before.islandLifecycleStable !== null || record.after.islandLifecycleStable !== null)
  ) {
    fail("FADENO_MORPH_QUALIFICATION_ISLAND", `${label}: unexpected island proof`);
  }
  const topLayerState = ["dialog-modal", "dialog-nonmodal", "popover-open"].includes(record.state);
  if (
    topLayerState
      ? record.before.topLayerStable !== true || record.after.topLayerStable !== true
      : record.before.topLayerStable !== null || record.after.topLayerStable !== null
  ) {
    fail("FADENO_MORPH_QUALIFICATION_TOP_LAYER", `${label}: top-layer proof differs`);
  }
  assertStructuralOperation(record, fixture, label);
}

export function verifyQualificationDiagnosticRecord(
  record: QualificationRecord,
  profile: MorphQualificationProfile,
  engine: MorphProject,
): void {
  if (record.engine !== engine) {
    fail("FADENO_MORPH_QUALIFICATION_ENGINE", `${record.key}: engine differs`);
  }
  assertRecord(record, profile);
}

export function qualificationRepetitions(profile: MorphQualificationProfile): number {
  const entry = MORPH_QUALIFICATION_PROFILES.find((candidate) => candidate.id === profile);
  if (!entry) fail("FADENO_MORPH_QUALIFICATION_PROFILE", `unknown profile: ${profile}`);
  return entry.repetitions;
}

export function verifyQualificationRecords(
  records: readonly QualificationRecord[],
  profile: MorphQualificationProfile,
  engine: MorphProject,
): Readonly<{
  profile: MorphQualificationProfile;
  engine: MorphProject;
  cases: number;
  repetitions: number;
  records: number;
  intentionalReplacements: number;
  candidateRoundTripMilliseconds: readonly number[];
  documentElementCounts: readonly number[];
}> {
  if (!MORPH_PROJECTS.includes(engine)) {
    fail("FADENO_MORPH_QUALIFICATION_ENGINE", `unknown engine: ${engine}`);
  }
  const repetitions = qualificationRepetitions(profile);
  const expectedKeys: string[] = [];
  for (const fixture of MORPH_QUALIFICATION_CASES) {
    for (let ordinal = 1; ordinal <= repetitions; ordinal += 1) {
      expectedKeys.push(`${engine}/${fixture.id}/${ordinal}`);
    }
  }
  if (records.length !== expectedKeys.length) {
    fail(
      "FADENO_MORPH_QUALIFICATION_MATRIX",
      `${engine}: expected ${expectedKeys.length} records, received ${records.length}`,
    );
  }
  const actualKeys = records.map((record) => record.key);
  if (!isDeepStrictEqual(actualKeys, expectedKeys) || new Set(actualKeys).size !== actualKeys.length) {
    fail("FADENO_MORPH_QUALIFICATION_MATRIX", `${engine}: record matrix differs`);
  }
  for (const record of records) {
    if (record.engine !== engine) {
      fail("FADENO_MORPH_QUALIFICATION_ENGINE", `${record.key}: engine differs`);
    }
    assertRecord(record, profile);
  }
  return {
    profile,
    engine,
    cases: MORPH_QUALIFICATION_CASES.length,
    repetitions,
    records: records.length,
    intentionalReplacements: records.filter(
      (record) => record.state === "intentional-replacement",
    ).length,
    candidateRoundTripMilliseconds: records.map(
      (record) => record.candidateRoundTripMilliseconds,
    ),
    documentElementCounts: records.map((record) => record.documentElementCount),
  };
}

export function verifyQualificationOutcome(
  records: readonly QualificationRecord[],
  failures: readonly QualificationFailureEvidence[],
  profile: MorphQualificationProfile,
  engine: MorphProject,
): Readonly<{
  profile: MorphQualificationProfile;
  engine: MorphProject;
  expectedRecords: number;
  completedRecords: number;
  passedRecords: number;
  failedRecords: number;
  failureKeys: readonly string[];
  failures: readonly QualificationFailureClassification[];
  intentionalReplacements: number;
  candidateRoundTripMilliseconds: readonly number[];
  documentElementCounts: readonly number[];
}> {
  if (!MORPH_PROJECTS.includes(engine)) {
    fail("FADENO_MORPH_QUALIFICATION_ENGINE", `unknown engine: ${engine}`);
  }
  const repetitions = qualificationRepetitions(profile);
  const expectedKeys = MORPH_QUALIFICATION_CASES.flatMap((fixture) =>
    Array.from(
      { length: repetitions },
      (_, index) => `${engine}/${fixture.id}/${index + 1}`,
    )
  );
  const observations = [...records, ...failures.map((failure) => failure.observation)];
  const byKey = new Map(observations.map((record) => [record.key, record]));
  const failureKeySet = new Set(failures.map((failure) => failure.observation.key));
  const expectedPassedKeys = expectedKeys.filter((key) => !failureKeySet.has(key));
  const expectedFailureKeys = expectedKeys.filter((key) => failureKeySet.has(key));
  if (
    observations.length !== expectedKeys.length ||
    byKey.size !== observations.length ||
    expectedKeys.some((key) => !byKey.has(key)) ||
    !isDeepStrictEqual(records.map((record) => record.key), expectedPassedKeys) ||
    !isDeepStrictEqual(
      failures.map((failure) => failure.observation.key),
      expectedFailureKeys,
    )
  ) {
    fail("FADENO_MORPH_QUALIFICATION_MATRIX", `${engine}: completed matrix differs`);
  }
  for (const record of records) {
    if (record.engine !== engine) {
      fail("FADENO_MORPH_QUALIFICATION_ENGINE", `${record.key}: engine differs`);
    }
    assertRecord(record, profile);
  }
  for (const failure of failures) {
    verifyQualificationFailureAlignment(
      failure.operation,
      failure.observation,
      profile,
      engine,
    );
  }
  const failureKeys = failures.map((failure) => failure.observation.key);
  const classifications = failures.map((failure) =>
    classifyQualificationFailure(failure.observation, profile)
  );
  return {
    profile,
    engine,
    expectedRecords: expectedKeys.length,
    completedRecords: observations.length,
    passedRecords: records.length,
    failedRecords: failures.length,
    failureKeys,
    failures: classifications,
    intentionalReplacements: observations.filter(
      (record) =>
        record.state === "intentional-replacement" &&
        isDeepStrictEqual(record.candidate.replacedIdentities, ["replacement-target"]),
    ).length,
    candidateRoundTripMilliseconds: observations.map(
      (record) => record.candidateRoundTripMilliseconds,
    ),
    documentElementCounts: observations.map((record) => record.documentElementCount),
  };
}
