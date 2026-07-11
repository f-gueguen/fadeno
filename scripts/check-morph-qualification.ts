import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { MORPH_PROJECTS } from "../experiments/morph/contract.ts";
import type { MorphProject } from "../experiments/morph/contract.ts";
import { MorphHarnessError } from "../experiments/morph/harness-report.ts";
import {
  verifyQualificationDecisionSignature,
  verifyQualificationDiagnosticSelection,
} from "../experiments/morph/qualification-decision.ts";
import type {
  QualificationDecisionSignature,
} from "../experiments/morph/qualification-decision.ts";
import {
  MORPH_QUALIFICATION_CASES,
} from "../experiments/morph/fixtures/qualification-corpus.ts";
import type { QualificationState } from "../experiments/morph/fixtures/qualification-corpus.ts";
import {
  MorphQualificationError,
  verifyQualificationFailureAlignment,
  verifyQualificationOutcome,
} from "../experiments/morph/qualification-proof.ts";
import type {
  QualificationFailureEvidence,
  QualificationRecord,
  QualificationSnapshot,
} from "../experiments/morph/qualification-proof.ts";
import { verifyQualificationReport } from "../experiments/morph/qualification-report.ts";
import type {
  QualificationFailedEvidence,
  QualificationReportOutcome,
} from "../experiments/morph/qualification-report.ts";
import { assertCleanMorphSource } from "../experiments/morph/qualification-runner.ts";
import {
  createMorphQualificationScenario,
} from "../experiments/morph/qualification-scenarios.ts";
import {
  createSyntheticPng,
  createSyntheticTraceZip,
} from "./lib/synthetic-browser-artifacts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];

function recordFailure(message: string): void {
  failures.push(message);
}

function stateValue(
  state: QualificationState,
  phase: "before" | "after",
): Readonly<Record<string, unknown>> {
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
      return {
        name: "qualification.txt",
        contentType: "text/plain",
        bytes: 18,
        lastModified: 1_700_000_000_000,
        text: "fadeno-k0-04-file\n",
      };
    case "details-open":
      return { open: true };
    case "dialog-modal":
      return { open: true, modal: true };
    case "dialog-nonmodal":
      return { open: true, modal: false };
    case "popover-open":
      return { open: true };
    case "media-playing":
      return {
        paused: false,
        currentTime: phase === "before" ? 0.1 : 0.11,
        readyState: 4,
        playbackRate: 0.5,
      };
    case "media-paused":
      return { paused: true, currentTime: 0.25, readyState: 4, playbackRate: 1 };
    case "document-scroll":
      return { x: 0, y: 400 };
    case "element-scroll":
      return { left: 0, top: 120 };
    case "island-identity":
      return { connectedCount: 1, disconnectedCount: 0 };
    case "intentional-replacement":
      return { text: phase === "before" ? "before" : "after" };
  }
}

function snapshot(
  state: QualificationState,
  phase: "before" | "after",
  order: readonly string[],
): QualificationSnapshot {
  const replacement = state === "intentional-replacement" && phase === "after";
  const file = state === "dirty-file";
  const island = state === "island-identity";
  const topLayer = ["dialog-modal", "dialog-nonmodal", "popover-open"].includes(state);
  return {
    serverClass: phase,
    order,
    rootOriginal: true,
    targetOriginal: !replacement,
    originalTargetConnected: !replacement,
    currentTargetConnected: true,
    ancestorsOriginal: !replacement,
    expandoPreserved: !replacement,
    listenerHits: phase === "after" && !replacement ? 1 : 0,
    sameFileObject: file ? true : null,
    islandLifecycleStable: island ? true : null,
    topLayerStable: topLayer ? true : null,
    state: stateValue(state, phase),
  };
}

function syntheticRecords(engine: MorphProject): QualificationRecord[] {
  const records: QualificationRecord[] = [];
  for (const fixture of MORPH_QUALIFICATION_CASES) {
    const scenario = createMorphQualificationScenario(fixture);
    for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
      const replacement = fixture.state === "intentional-replacement";
      records.push({
        schemaVersion: 1,
        profile: "ci",
        engine,
        caseId: fixture.id,
        state: fixture.state,
        operation: fixture.operation,
        ordinal,
        key: `${engine}/${fixture.id}/${ordinal}`,
        completed: true,
        candidateRoundTripMilliseconds: 1,
        observationWindowMilliseconds: 2,
        documentElementCount: 10,
        candidate: {
          rootIdentity: "root",
          reusedIdentities: replacement ? ["root"] : ["root", fixture.targetIdentity],
          replacedIdentities: replacement ? [fixture.targetIdentity] : [],
        },
        before: snapshot(fixture.state, "before", scenario.beforeOrder),
        after: snapshot(fixture.state, "after", scenario.afterOrder),
        instrumentation: {
          setterCalls: [],
          methodCalls: [],
          events: [],
          blockedRequests: [],
          pageErrors: [],
          unhandledRejections: [],
        },
      });
    }
  }
  return records;
}

function mutableRecord(records: unknown[], index = 0): Record<string, unknown> {
  const record = records[index];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`missing mutable record ${index}`);
  }
  return record as Record<string, unknown>;
}

function mutableChild(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = parent[key];
  if (!child || typeof child !== "object" || Array.isArray(child)) {
    throw new Error(`missing mutable child ${key}`);
  }
  return child as Record<string, unknown>;
}

function expectQualificationError(
  name: string,
  code: string,
  action: () => void,
): void {
  try {
    action();
    recordFailure(`${name}: expected ${code}`);
  } catch (error: unknown) {
    if (!(error instanceof MorphQualificationError) || error.code !== code) {
      recordFailure(
        `${name}: expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function expectHarnessError(
  name: string,
  code: string,
  action: () => void,
): void {
  try {
    action();
    recordFailure(`${name}: expected ${code}`);
  } catch (error: unknown) {
    if (!(error instanceof MorphHarnessError) || error.code !== code) {
      recordFailure(
        `${name}: expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const baseRecords = syntheticRecords("chromium");
verifyQualificationOutcome(baseRecords, [], "ci", "chromium");
const passingFailureRecord = baseRecords.find((record) => record.state === "document-scroll");
if (!passingFailureRecord) throw new Error("missing synthetic failure record");
const failureRecord = structuredClone(passingFailureRecord) as QualificationRecord;
(failureRecord.after.state as { y: number }).y = 380;
(failureRecord.instrumentation.events as string[]).push("window-scroll");
const failureOperation = {
  profile: failureRecord.profile,
  engine: failureRecord.engine,
  caseId: failureRecord.caseId,
  state: failureRecord.state,
  operation: failureRecord.operation,
  ordinal: failureRecord.ordinal,
  failure: "synthetic failure",
};
verifyQualificationFailureAlignment(failureOperation, failureRecord, "ci", "chromium");
const failedMatrixRecords = baseRecords.filter((record) => record.key !== failureRecord.key);
const failedMatrix: QualificationFailureEvidence[] = [{
  operation: failureOperation,
  observation: failureRecord,
}];
verifyQualificationOutcome(failedMatrixRecords, failedMatrix, "ci", "chromium");
expectQualificationError("passing record declared failed", "FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", () => {
  verifyQualificationOutcome(
    baseRecords.filter((record) => record.key !== passingFailureRecord.key),
    [{ operation: failureOperation, observation: passingFailureRecord }],
    "ci",
    "chromium",
  );
});
expectQualificationError("missing failed cell", "FADENO_MORPH_QUALIFICATION_MATRIX", () => {
  verifyQualificationOutcome(failedMatrixRecords, [], "ci", "chromium");
});
expectQualificationError("duplicate failed cell", "FADENO_MORPH_QUALIFICATION_MATRIX", () => {
  verifyQualificationOutcome(failedMatrixRecords, [...failedMatrix, ...failedMatrix], "ci", "chromium");
});
expectQualificationError("reordered passed outcome", "FADENO_MORPH_QUALIFICATION_MATRIX", () => {
  verifyQualificationOutcome([...failedMatrixRecords].reverse(), failedMatrix, "ci", "chromium");
});

function syntheticFailedEvidence(engine: MorphProject): Readonly<{
  evidence: QualificationFailedEvidence;
  records: readonly QualificationRecord[];
  failures: readonly QualificationFailureEvidence[];
}> {
  const all = syntheticRecords(engine);
  const failed: QualificationFailureEvidence[] = all
    .filter((record) => record.state === "document-scroll" || record.state === "element-scroll")
    .map((record) => {
      const observation = structuredClone(record) as QualificationRecord;
      if (observation.state === "document-scroll") {
        (observation.after.state as { y: number }).y = 380;
        (observation.instrumentation.events as string[]).push("window-scroll");
      } else {
        (observation.after.state as { top: number }).top = 140;
        (observation.instrumentation.events as string[]).push("scroll");
      }
      return {
        operation: {
          profile: observation.profile,
          engine,
          caseId: observation.caseId,
          state: observation.state,
          operation: observation.operation,
          ordinal: observation.ordinal,
          failure: "synthetic scroll failure",
        },
        observation,
      };
    });
  const failureKeys = new Set(failed.map((item) => item.observation.key));
  const passed = all.filter((record) => !failureKeys.has(record.key));
  return {
    records: passed,
    failures: failed,
    evidence: {
      engine,
      recordsPath: `${engine}-records.json`,
      failuresPath: `${engine}-failures.json`,
      summaryPath: `${engine}-summary.json`,
      diagnosticFailurePath: `${engine}-diagnostic.json`,
      screenshotPath: `${engine}.png`,
      tracePath: `${engine}.zip`,
      errorContextPath: `${engine}.md`,
      summary: verifyQualificationOutcome(passed, failed, "ci", engine),
    },
  };
}

const decisionSignature: QualificationDecisionSignature = {
  schemaVersion: 1,
  diagnosticCase: "element-scroll-insert",
  failureCases: [
    {
      caseId: "document-scroll-reorder",
      categories: ["scroll-position", "scroll-event"],
    },
    {
      caseId: "element-scroll-insert",
      categories: ["scroll-position", "scroll-event"],
    },
  ],
};
const decisionOutcome: QualificationReportOutcome = {
  status: "failed",
  passed: [],
  failed: MORPH_PROJECTS.map((engine) => syntheticFailedEvidence(engine).evidence),
};
verifyQualificationDecisionSignature(decisionSignature, decisionOutcome, "ci");
const selectedDiagnostic = syntheticFailedEvidence("chromium").failures.find(
  (failure) =>
    failure.observation.caseId === decisionSignature.diagnosticCase &&
    failure.observation.ordinal === 20,
);
if (!selectedDiagnostic) throw new Error("missing synthetic selected diagnostic");
verifyQualificationDiagnosticSelection(selectedDiagnostic, "ci");
expectHarnessError("swapped accepted diagnostic", "FADENO_MORPH_DECISION_SIGNATURE", () => {
  const swapped = syntheticFailedEvidence("chromium").failures.find(
    (failure) =>
      failure.observation.caseId === "document-scroll-reorder" &&
      failure.observation.ordinal === 20,
  );
  if (!swapped) throw new Error("missing synthetic swapped diagnostic");
  verifyQualificationDiagnosticSelection(swapped, "ci");
});
expectHarnessError("unexpected accepted failure category", "FADENO_MORPH_DECISION_SIGNATURE", () => {
  verifyQualificationDecisionSignature(
    {
      ...decisionSignature,
      failureCases: decisionSignature.failureCases.map((entry, index) =>
        index === 0 ? { ...entry, categories: [...entry.categories, "other"] } : entry
      ),
    },
    decisionOutcome,
    "ci",
  );
});
for (const [name, mutation] of [
  ["mismatched failure case", { caseId: "other-case" }],
  ["mismatched failure ordinal", { ordinal: 2 }],
] as const) {
  expectQualificationError(name, "FADENO_MORPH_QUALIFICATION_FAILURE_EVIDENCE", () => {
    verifyQualificationFailureAlignment(
      { ...failureOperation, ...mutation },
      failureRecord,
      "ci",
      "chromium",
    );
  });
}

const sourceRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-source-"));
try {
  const git = (args: readonly string[]): void => {
    const result = spawnSync("git", [...args], { cwd: sourceRoot, encoding: "utf8" });
    if (result.status !== 0 || result.error) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
    }
  };
  git(["init", "--quiet"]);
  git(["config", "user.name", "Fadeno Contract"]);
  git(["config", "user.email", "contract@fadeno.invalid"]);
  writeFileSync(join(sourceRoot, "source.txt"), "clean\n");
  git(["add", "source.txt"]);
  git(["commit", "--quiet", "-m", "source fixture"]);
  const sourceCommit = assertCleanMorphSource(sourceRoot);
  writeFileSync(join(sourceRoot, "source.txt"), "changed\n");
  expectHarnessError("dirty source after execution", "FADENO_MORPH_SOURCE_DIRTY", () => {
    assertCleanMorphSource(sourceRoot, sourceCommit);
  });
  writeFileSync(join(sourceRoot, "source.txt"), "clean\n");
  expectHarnessError("changed source commit", "FADENO_MORPH_SOURCE_CHANGED", () => {
    assertCleanMorphSource(sourceRoot, "0000000000000000000000000000000000000000");
  });
} finally {
  rmSync(sourceRoot, { recursive: true, force: true });
}

const recordMutations: ReadonlyArray<Readonly<{
  name: string;
  code: string;
  mutate(records: unknown[]): void;
}>> = [
  {
    name: "missing matrix cell",
    code: "FADENO_MORPH_QUALIFICATION_MATRIX",
    mutate: (records) => { records.pop(); },
  },
  {
    name: "duplicate matrix cell",
    code: "FADENO_MORPH_QUALIFICATION_MATRIX",
    mutate: (records) => { mutableRecord(records, 1).key = mutableRecord(records).key; },
  },
  {
    name: "reordered matrix",
    code: "FADENO_MORPH_QUALIFICATION_MATRIX",
    mutate: (records) => { records.reverse(); },
  },
  {
    name: "wrong engine",
    code: "FADENO_MORPH_QUALIFICATION_ENGINE",
    mutate: (records) => { mutableRecord(records).engine = "firefox"; },
  },
  {
    name: "wrong profile",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).profile = "qualification"; },
  },
  {
    name: "wrong state",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).state = "dirty-file"; },
  },
  {
    name: "wrong operation",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).operation = "remove-keyed"; },
  },
  {
    name: "incomplete cell",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).completed = false; },
  },
  {
    name: "negative timing",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).candidateRoundTripMilliseconds = -1; },
  },
  {
    name: "empty document",
    code: "FADENO_MORPH_QUALIFICATION_RECORD",
    mutate: (records) => { mutableRecord(records).documentElementCount = 0; },
  },
  {
    name: "wrong candidate root",
    code: "FADENO_MORPH_QUALIFICATION_CANDIDATE",
    mutate: (records) => { mutableChild(mutableRecord(records), "candidate").rootIdentity = "other"; },
  },
  {
    name: "duplicate reused identity",
    code: "FADENO_MORPH_QUALIFICATION_CANDIDATE",
    mutate: (records) => { mutableChild(mutableRecord(records), "candidate").reusedIdentities = ["root", "root"]; },
  },
  ...[
    ["setterCalls", "value"],
    ["methodCalls", "focus"],
    ["events", "input"],
    ["blockedRequests", "https://example.invalid"],
    ["pageErrors", "runtime"],
    ["unhandledRejections", "rejection"],
  ].map(([field, value]) => ({
    name: `hidden ${field}`,
    code: "FADENO_MORPH_QUALIFICATION_TRANSIENT",
    mutate: (records: unknown[]) => {
      mutableChild(mutableRecord(records), "instrumentation")[field ?? ""] = [value];
    },
  })),
  {
    name: "root replacement",
    code: "FADENO_MORPH_QUALIFICATION_CONTINUITY",
    mutate: (records) => { mutableChild(mutableRecord(records), "after").rootOriginal = false; },
  },
  {
    name: "target replacement",
    code: "FADENO_MORPH_QUALIFICATION_CONTINUITY",
    mutate: (records) => { mutableChild(mutableRecord(records), "after").targetOriginal = false; },
  },
  {
    name: "ancestor replacement",
    code: "FADENO_MORPH_QUALIFICATION_CONTINUITY",
    mutate: (records) => { mutableChild(mutableRecord(records), "after").ancestorsOriginal = false; },
  },
  {
    name: "lost expando",
    code: "FADENO_MORPH_QUALIFICATION_CONTINUITY",
    mutate: (records) => { mutableChild(mutableRecord(records), "after").expandoPreserved = false; },
  },
  {
    name: "lost listener",
    code: "FADENO_MORPH_QUALIFICATION_CONTINUITY",
    mutate: (records) => { mutableChild(mutableRecord(records), "after").listenerHits = 0; },
  },
  {
    name: "dirty value restored",
    code: "FADENO_MORPH_QUALIFICATION_STATE",
    mutate: (records) => { mutableChild(mutableChild(mutableRecord(records), "after"), "state").value = "server-default"; },
  },
  {
    name: "missing insertion",
    code: "FADENO_MORPH_QUALIFICATION_OPERATION",
    mutate: (records) => {
      mutableChild(mutableRecord(records), "after").order = mutableChild(mutableRecord(records), "before").order;
    },
  },
  {
    name: "empty structural order",
    code: "FADENO_MORPH_QUALIFICATION_OPERATION",
    mutate: (records) => {
      const index = records.findIndex(
        (record) => mutableRecord([record]).state === "intentional-replacement",
      );
      mutableChild(mutableRecord(records, index), "before").order = [];
      mutableChild(mutableRecord(records, index), "after").order = [];
    },
  },
  {
    name: "file object replaced",
    code: "FADENO_MORPH_QUALIFICATION_FILE",
    mutate: (records) => {
      const index = records.findIndex((record) => mutableRecord([record]).state === "dirty-file");
      mutableChild(mutableRecord(records, index), "after").sameFileObject = false;
    },
  },
  {
    name: "file bytes changed",
    code: "FADENO_MORPH_QUALIFICATION_FILE",
    mutate: (records) => {
      const index = records.findIndex((record) => mutableRecord([record]).state === "dirty-file");
      mutableChild(mutableChild(mutableRecord(records, index), "after"), "state").bytes = 0;
    },
  },
  {
    name: "island lifecycle changed",
    code: "FADENO_MORPH_QUALIFICATION_ISLAND",
    mutate: (records) => {
      const index = records.findIndex((record) => mutableRecord([record]).state === "island-identity");
      mutableChild(mutableRecord(records, index), "after").islandLifecycleStable = false;
    },
  },
  {
    name: "top layer changed",
    code: "FADENO_MORPH_QUALIFICATION_TOP_LAYER",
    mutate: (records) => {
      const index = records.findIndex((record) => mutableRecord([record]).state === "dialog-modal");
      mutableChild(mutableRecord(records, index), "after").topLayerStable = false;
    },
  },
  {
    name: "media reset",
    code: "FADENO_MORPH_QUALIFICATION_STATE",
    mutate: (records) => {
      const index = records.findIndex((record) => mutableRecord([record]).state === "media-playing");
      mutableChild(mutableChild(mutableRecord(records, index), "after"), "state").currentTime = 0;
    },
  },
  {
    name: "declared replacement reused",
    code: "FADENO_MORPH_QUALIFICATION_REPLACEMENT",
    mutate: (records) => {
      const index = records.findIndex(
        (record) => mutableRecord([record]).state === "intentional-replacement",
      );
      mutableChild(mutableRecord(records, index), "after").targetOriginal = true;
    },
  },
];

for (const mutation of recordMutations) {
  const records = structuredClone(baseRecords) as unknown[];
  mutation.mutate(records);
  expectQualificationError(mutation.name, mutation.code, () => {
    verifyQualificationOutcome(records as QualificationRecord[], [], "ci", "chromium");
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const reportRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-qualification-"));
try {
  const results = MORPH_PROJECTS.flatMap((engine) => {
    const records = syntheticRecords(engine);
    const failures: QualificationFailureEvidence[] = [];
    const summary = verifyQualificationOutcome(records, failures, "ci", engine);
    const directory = join(reportRoot, engine);
    mkdirSync(directory);
    const recordsPath = join(directory, "records.json");
    const failuresPath = join(directory, "failures.json");
    const summaryPath = join(directory, "summary.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    const diagnostic = records.find(
      (record) => record.caseId === "element-scroll-insert" && record.ordinal === 20,
    );
    if (!diagnostic) throw new Error(`missing passing diagnostic ${engine}`);
    writeJson(recordsPath, records);
    writeJson(failuresPath, failures);
    writeJson(summaryPath, summary);
    writeJson(diagnosticPath, diagnostic);
    const attachment = (name: string, path: string) => ({
      name,
      contentType: "application/json",
      path: relative(reportRoot, path),
      bytes: statSync(path).size,
    });
    return [
      {
        project: engine,
        title: "qualification-matrix-ci",
        status: "passed",
        expectedStatus: "passed",
        errors: [],
        attachments: [
          attachment("qualification-records", recordsPath),
          attachment("qualification-failures", failuresPath),
          attachment("qualification-summary", summaryPath),
        ],
      },
      {
        project: engine,
        title: "qualification-diagnostic-ci",
        status: "passed",
        expectedStatus: "passed",
        errors: [],
        attachments: [attachment("diagnostic-record", diagnosticPath)],
      },
    ];
  });
  const reportPath = join(reportRoot, "report.json");
  writeJson(reportPath, { schemaVersion: 1, status: "passed", results });
  verifyQualificationReport(reportPath, { profile: "ci", outputRoot: reportRoot });

  const portableRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-qualification-portable-"));
  try {
    const copy = join(portableRoot, "evidence");
    cpSync(reportRoot, copy, { recursive: true });
    verifyQualificationReport(join(copy, "report.json"), { profile: "ci", outputRoot: copy });
  } finally {
    rmSync(portableRoot, { recursive: true, force: true });
  }

  const failedRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-qualification-failed-"));
  try {
    const failedResults = MORPH_PROJECTS.flatMap((engine, index) => {
      const matrix = syntheticFailedEvidence(engine);
      const directory = join(failedRoot, engine);
      mkdirSync(directory);
      const documents = [
        ["qualification-records", "application/json", "records.json", matrix.records],
        ["qualification-failures", "application/json", "failures.json", matrix.failures],
        ["qualification-summary", "application/json", "summary.json", matrix.evidence.summary],
      ] as const;
      const attachmentPaths = documents.map(([name, contentType, filename, document]) => {
        const path = join(directory, filename);
        writeJson(path, document);
        return { name, contentType, path };
      });
      const screenshot = join(directory, "screenshot.png");
      const errorContext = join(directory, "error-context.md");
      const trace = join(directory, "trace.zip");
      const diagnosticPath = join(directory, "diagnostic-failure.json");
      const diagnostic = matrix.failures.find(
        (failure) =>
          failure.observation.caseId === "element-scroll-insert" &&
          failure.observation.ordinal === 20,
      );
      if (!diagnostic) throw new Error(`missing failed diagnostic ${engine}`);
      writeJson(diagnosticPath, diagnostic);
      writeFileSync(screenshot, createSyntheticPng(40 + index * 40));
      writeFileSync(errorContext, "# qualification-diagnostic-ci\n\nSynthetic failed matrix.\n");
      const bound = [
        { name: "diagnostic-failure", contentType: "application/json", data: readFileSync(diagnosticPath) },
        { name: "screenshot", contentType: "image/png", data: readFileSync(screenshot) },
        { name: "error-context", contentType: "text/markdown", data: readFileSync(errorContext) },
      ];
      writeFileSync(
        trace,
        createSyntheticTraceZip(
          engine,
          "qualification-diagnostic-ci",
          "FADENO_MORPH_QUALIFICATION_FAILURE: synthetic",
          bound,
        ),
      );
      const diagnosticPaths = [
        { name: "diagnostic-failure", contentType: "application/json", path: diagnosticPath },
        { name: "screenshot", contentType: "image/png", path: screenshot },
        { name: "error-context", contentType: "text/markdown", path: errorContext },
        { name: "trace", contentType: "application/zip", path: trace },
      ];
      const portable = ({ name, contentType, path }: { name: string; contentType: string; path: string }) => ({
        name,
        contentType,
        path: relative(failedRoot, path),
        bytes: statSync(path).size,
      });
      return [
        {
          project: engine,
          title: "qualification-matrix-ci",
          status: "passed",
          expectedStatus: "passed",
          errors: [],
          attachments: attachmentPaths.map(portable),
        },
        {
          project: engine,
          title: "qualification-diagnostic-ci",
          status: "failed",
          expectedStatus: "passed",
          errors: ["Error: FADENO_MORPH_QUALIFICATION_FAILURE: synthetic"],
          attachments: diagnosticPaths.map(portable),
        },
      ];
    });
    const failedReport = join(failedRoot, "report.json");
    writeJson(failedReport, { schemaVersion: 1, status: "failed", results: failedResults });
    const verifiedFailure = verifyQualificationReport(failedReport, {
      profile: "ci",
      outputRoot: failedRoot,
    });
    if (verifiedFailure.status !== "failed" || verifiedFailure.failed.length !== 3) {
      recordFailure("complete failed report: verified outcome differs");
    }
    const firstResult = failedResults.find(
      (result) => result.title === "qualification-diagnostic-ci",
    );
    const firstScreenshot = firstResult?.attachments.find(
      (attachment) => attachment.name === "screenshot",
    );
    if (!firstResult || !firstScreenshot) throw new Error("missing synthetic failed screenshot");
    const swappedScreenshot = join(failedRoot, firstScreenshot.path);
    writeFileSync(swappedScreenshot, createSyntheticPng(200));
    firstScreenshot.bytes = statSync(swappedScreenshot).size;
    writeJson(failedReport, { schemaVersion: 1, status: "failed", results: failedResults });
    expectHarnessError("unbound qualification screenshot", "FADENO_MORPH_TRACE_ATTACHMENT", () => {
      verifyQualificationReport(failedReport, { profile: "ci", outputRoot: failedRoot });
    });
  } finally {
    rmSync(failedRoot, { recursive: true, force: true });
  }

  const reportMutations: ReadonlyArray<Readonly<{
    name: string;
    code: string;
    mutate(caseRoot: string, report: Record<string, unknown>): void;
  }>> = [
    {
      name: "missing project result",
      code: "FADENO_MORPH_QUALIFICATION_EXECUTION_COUNT",
      mutate: (_caseRoot, report) => {
        const current = report.results as unknown[];
        report.results = current.slice(0, 2);
      },
    },
    {
      name: "mixed failure is inspected",
      code: "FADENO_MORPH_QUALIFICATION_DIAGNOSTIC",
      mutate: (_caseRoot, report) => {
        report.status = "failed";
        const result = (report.results as Array<Record<string, unknown>>).at(-1);
        if (!result) return;
        result.status = "failed";
        result.errors = ["Error: FADENO_MORPH_QUALIFICATION_FAILURE: synthetic"];
      },
    },
    {
      name: "wrong attachment content type",
      code: "FADENO_MORPH_ATTACHMENT_CONTENT_TYPE",
      mutate: (_caseRoot, report) => {
        const result = (report.results as Array<Record<string, unknown>>)[0];
        const attachment = (result?.attachments as Array<Record<string, unknown>>)[0];
        if (attachment) attachment.contentType = "text/plain";
      },
    },
    {
      name: "duplicate attachment path",
      code: "FADENO_MORPH_QUALIFICATION_ATTACHMENT_DUPLICATE",
      mutate: (_caseRoot, report) => {
        const current = report.results as Array<Record<string, unknown>>;
        const first = (current[0]?.attachments as Array<Record<string, unknown>>)[0];
        const second = (current[2]?.attachments as Array<Record<string, unknown>>)[0];
        if (first && second) {
          second.path = first.path;
          second.bytes = first.bytes;
        }
      },
    },
    {
      name: "escaping attachment path",
      code: "FADENO_MORPH_ATTACHMENT_PATH",
      mutate: (_caseRoot, report) => {
        const result = (report.results as Array<Record<string, unknown>>)[0];
        const attachment = (result?.attachments as Array<Record<string, unknown>>)[0];
        if (attachment) attachment.path = "../escape.json";
      },
    },
    {
      name: "fabricated summary",
      code: "FADENO_MORPH_QUALIFICATION_SUMMARY",
      mutate: (caseRoot, report) => {
        const result = (report.results as Array<Record<string, unknown>>)[0];
        const attachment = (result?.attachments as Array<Record<string, unknown>>).find(
          (item) => item.name === "qualification-summary",
        );
        if (!attachment || typeof attachment.path !== "string") return;
        const path = join(caseRoot, attachment.path);
        const summary = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        summary.completedRecords = 1;
        writeJson(path, summary);
        attachment.bytes = statSync(path).size;
      },
    },
  ];
  for (const mutation of reportMutations) {
    const caseRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-qualification-case-"));
    try {
      cpSync(reportRoot, caseRoot, { recursive: true });
      const caseReportPath = join(caseRoot, "report.json");
      const report = JSON.parse(readFileSync(caseReportPath, "utf8")) as Record<string, unknown>;
      mutation.mutate(caseRoot, report);
      writeJson(caseReportPath, report);
      try {
        verifyQualificationReport(caseReportPath, { profile: "ci", outputRoot: caseRoot });
        recordFailure(`${mutation.name}: expected ${mutation.code}`);
      } catch (error: unknown) {
        if (!(error instanceof MorphHarnessError) || error.code !== mutation.code) {
          recordFailure(
            `${mutation.name}: expected ${mutation.code}, received ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      rmSync(caseRoot, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(reportRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `morph qualification verifier passed (${recordMutations.length} record mutations, 2 failure alignment mutations, 6 report mutations)`,
);
