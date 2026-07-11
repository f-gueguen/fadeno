import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { EXTRACTION_PROJECTS } from "../experiments/extraction/contract.ts";
import type { ExtractionProject } from "../experiments/extraction/contract.ts";
import { browserManifestEnvironment } from "../experiments/browser-preflight.ts";
import { EXTRACTION_ACCEPTED_CLASSES } from "../experiments/extraction/fixtures/catalog.ts";
import { EXTRACTION_REJECTION_CLASSES } from "../experiments/extraction/fixtures/catalog.ts";
import {
  EXTRACTION_DIAGNOSTIC_EXPECTATIONS,
  EXTRACTION_IDENTITY_CASES,
} from "../experiments/extraction/qualification-contract.ts";
import {
  emitAcceptedHandler,
  ExtractionCandidate,
} from "../experiments/extraction/candidate.ts";
import { observeOutputSafety } from "../experiments/extraction/qualification-runner.ts";
import {
  decideExtractionOutcome,
  decideExtractionObservations,
  expectedInteractionState,
  verifyExtractionQualificationObservation,
} from "../experiments/extraction/qualification-proof.ts";
import type {
  ExtractionQualificationObservation,
  GeneratedInventory,
} from "../experiments/extraction/qualification-proof.ts";
import { verifyExtractionQualificationReport } from "../experiments/extraction/qualification-report.ts";
import type { ExtractionQualificationReport } from "../experiments/extraction/qualification-report.ts";
import { MORPH_QUALIFICATION_CASES } from "../experiments/morph/fixtures/qualification-corpus.ts";
import { createMorphQualificationScenario } from "../experiments/morph/qualification-scenarios.ts";
import { expectedMorphQualificationState } from "../experiments/morph/qualification-state.ts";
import {
  readJsonDocument,
  validateArtifactRecords,
  validateManifestSemantics,
} from "./lib/experiment-contract.ts";
import {
  createContractValidators,
  loadExperimentRegistry,
  loadReferenceEnvironment,
} from "./lib/experiment-validation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function syntheticScenarioState(state: (typeof EXTRACTION_IDENTITY_CASES)[number]["state"]) {
  const expected = expectedMorphQualificationState(state);
  if (expected) return expected;
  if (state === "dirty-file") return {
    name: "qualification.txt",
    contentType: "text/plain",
    bytes: 18,
    lastModified: 1,
    text: "fadeno-k0-04-file\n",
    sameFile: true,
  };
  if (state === "media-playing") return {
    paused: false,
    currentTime: 0.25,
    readyState: 4,
    playbackRate: 0.5,
  };
  if (state === "media-paused") return {
    paused: true,
    currentTime: 0.25,
    readyState: 4,
    playbackRate: 1,
  };
  throw new Error(`missing synthetic scenario state: ${state}`);
}

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
        status: "passed" as const,
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
        identity: EXTRACTION_IDENTITY_CASES.map((identityCase, index) => {
          const morphFixture = MORPH_QUALIFICATION_CASES.find(
            (item) => item.id === identityCase.id,
          );
          if (!morphFixture) throw new Error(`missing synthetic H1 case: ${identityCase.id}`);
          const scenario = createMorphQualificationScenario(morphFixture);
          const beforeOrder = scenario.operationParentIdentity === "root"
            ? [...scenario.beforeOrder, "handler-trigger"]
            : scenario.beforeOrder;
          const afterOrder = scenario.operationParentIdentity === "root"
            ? [...scenario.afterOrder, "handler-trigger"]
            : scenario.afterOrder;
          const scenarioState = syntheticScenarioState(identityCase.state);
          const scenarioStateAfter = identityCase.state === "document-scroll"
            ? { x: 0, y: 380 }
            : identityCase.state === "element-scroll"
              ? { left: 0, top: 140 }
              : scenarioState;
          return {
          caseId: identityCase.id,
          operation: identityCase.operation,
          ordinal: 101 + index,
          targetSame: true,
          scenarioTargetSame: true,
          reusedScenarioTarget: true,
          scenarioState: identityCase.state,
          scenarioStateBefore: scenarioState,
          scenarioStateAfter,
          scenarioObservationMilliseconds: 1,
          targetIdentity: scenario.fixture.targetIdentity,
          operationParentIdentity: scenario.operationParentIdentity,
          beforeOrder,
          afterOrder,
          handlerReferenceStable: true,
          moduleEvaluations: 1,
          effectDelta: 1,
          after: expectedInteractionState(fixtureId, 101 + index),
          };
        }),
      };
    }),
  };
}

const chromium = observation("chromium");
verifyExtractionQualificationObservation(chromium, inventory);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function observationDecisionWithFailure(fixtureId: string) {
  const observations = new Map(EXTRACTION_PROJECTS.map((project) => {
    const original = clone(observation(project));
    const value = {
      ...original,
      fixtures: original.fixtures.map((fixture) => fixture.fixtureId === fixtureId
        ? { status: "failed" as const, fixtureId: fixture.fixtureId,
          failureStage: "interaction" as const, failure: "seeded" }
        : fixture),
    };
    return [project, value] as const;
  }));
  return decideExtractionObservations(observations, {
    rejectedBoundariesPass: true,
    identityPass: true,
    deterministicGenerationPass: true,
    outputSafetyPass: true,
  }).decision;
}

for (const [name, mutate] of [
  ["missing ordinal", (value: any) => { value.fixtures[0].interactions.pop(); }],
  ["wrong state", (value: any) => { value.fixtures[0].interactions[4].after = { expanded: false, hidden: false }; }],
  ["early handler", (value: any) => { value.fixtures[0].preTriggerRequests.push("/handlers/toggle.js"); }],
  ["module reevaluation", (value: any) => { value.fixtures[0].moduleEvaluations = 2; }],
  ["lost target", (value: any) => { value.fixtures[0].identity[0].targetSame = false; }],
  ["lost scenario state", (value: any) => { value.fixtures[0].identity[0].scenarioStateAfter.focused = false; }],
  ["wrong scenario order", (value: any) => { value.fixtures[0].identity[0].afterOrder.reverse(); }],
  ["wrong scenario identity", (value: any) => { value.fixtures[0].identity[0].scenarioTargetSame = false; }],
  ["unreported reuse", (value: any) => { value.fixtures[0].identity[0].reusedScenarioTarget = false; }],
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
  decideExtractionOutcome({ accepted: all, rejectedBoundariesPass: false, identityPass: true, deterministicGenerationPass: true, outputSafetyPass: true }) !== "pivot" ||
  observationDecisionWithFailure("tabs") !== "narrow" ||
  observationDecisionWithFailure("toggle") !== "pivot"
) throw new Error("K0-06 decision table differs");

const resultsRoot = join(root, "experiments/extraction/results");
const resultEntries = readdirSync(resultsRoot).filter((entry) => entry !== "README.md").sort();
const registryDocument = readJsonDocument(join(root, "experiments/registry.json"));
const extractionRegistry = registryDocument.experiments.find(
  (entry: { id: string }) => entry.id === "extraction",
);
const expectsPinnedResult = extractionRegistry?.status === "qualified";
if (
  (expectsPinnedResult && resultEntries.length !== 1) ||
  (!expectsPinnedResult && resultEntries.length !== 0)
) {
  throw new Error("K0-06 immutable extraction result set differs");
}
if (resultEntries.length === 1) {
  const pinnedRunId = resultEntries[0]!;
  const pinnedRoot = join(resultsRoot, pinnedRunId);
  const verifyPinnedResult = (runRoot: string): void => {
    const manifestPath = join(runRoot, "manifest.json");
    const manifest = readJsonDocument(manifestPath) as any;
    const validators = createContractValidators(root);
    if (!validators.manifest(manifest)) throw new Error("K0-06 result manifest schema differs");
    const reference = loadReferenceEnvironment(root);
    const registry = loadExperimentRegistry(root, validators);
    validateManifestSemantics(manifest, reference, registry);
    validateArtifactRecords(manifest, manifestPath, root);
    const decision = readJsonDocument(join(runRoot, "decision.json"));
    const inventory = readJsonDocument(join(runRoot, "generated/inventory.json")) as
      GeneratedInventory;
    const report = readJsonDocument(join(runRoot, "qualification-report.json")) as
      ExtractionQualificationReport;
    const observations = verifyExtractionQualificationReport(
      report,
      inventory,
      (path) => readFileSync(join(runRoot, path)),
    );
    const derived = decideExtractionObservations(observations, {
      rejectedBoundariesPass: decision.rejectedBoundariesPass === true,
      identityPass: decision.identityPass === true,
      deterministicGenerationPass: decision.deterministicGenerationPass === true,
      outputSafetyPass: decision.outputSafetyPass === true,
    });
    const run = readJsonDocument(join(runRoot, "run.json"));
    const sourceRecord = readJsonDocument(join(runRoot, "source.json"));
    const preflight = readJsonDocument(join(runRoot, "preflight.json"));
    const pinnedDiagnostics = readJsonDocument(join(runRoot, "rejected-diagnostics.json"));
    const contract = readJsonDocument(join(runRoot, "artifacts/qualification-contract.json"));
    const recomputedRoot = mkdtempSync(
      join(realpathSync(tmpdir()), "fadeno-extraction-result-recompute-"),
    );
    let recomputedBoundariesPass = true;
    let recomputedGenerationPass = true;
    const candidate = new ExtractionCandidate();
    try {
      const expectedDiagnostics = EXTRACTION_REJECTION_CLASSES.map((fixtureId) => {
        const diagnostic = candidate.analyze(fixtureId).diagnostic;
        const expected = EXTRACTION_DIAGNOSTIC_EXPECTATIONS[fixtureId];
        if (!diagnostic || !isDeepStrictEqual(
          { id: diagnostic.id, severity: diagnostic.severity, message: diagnostic.message,
            explanation: diagnostic.explanation, correction: diagnostic.correction },
          expected,
        )) recomputedBoundariesPass = false;
        return diagnostic ? { status: "passed", fixtureId, ...diagnostic } : undefined;
      });
      if (!isDeepStrictEqual(pinnedDiagnostics, {
        schemaVersion: 1,
        diagnostics: expectedDiagnostics,
      })) recomputedBoundariesPass = false;
      const firstRoot = join(recomputedRoot, "first");
      const secondRoot = join(recomputedRoot, "second");
      const inventoryByFixture = new Map(inventory.files.map((file) => [file.fixtureId, file]));
      for (const fixtureId of EXTRACTION_ACCEPTED_CLASSES) {
        const analysis = candidate.analyze(fixtureId);
        const first = emitAcceptedHandler(analysis, firstRoot);
        const second = emitAcceptedHandler(analysis, secondRoot);
        const pinned = inventoryByFixture.get(fixtureId);
        if (
          !pinned || first.sha256 !== second.sha256 || first.bytes !== second.bytes ||
          first.handlerIdentity !== second.handlerIdentity ||
          !readFileSync(first.path).equals(readFileSync(second.path)) ||
          first.sha256 !== pinned.sha256 || first.bytes !== pinned.bytes ||
          first.handlerIdentity !== pinned.handlerIdentity ||
          !readFileSync(first.path).equals(readFileSync(join(runRoot, pinned.path)))
        ) recomputedGenerationPass = false;
      }
    } finally {
      candidate[Symbol.dispose]();
    }
    const recomputedOutputSafetyPass = observeOutputSafety(join(recomputedRoot, "safety"));
    rmSync(recomputedRoot, { recursive: true, force: true });
    const measurements = Object.fromEntries(
      manifest.measurements.map((measurement: { name: string; values: unknown[] }) => [
        measurement.name,
        measurement.values,
      ]),
    );
    const expectedMatrix = {
      engines: EXTRACTION_PROJECTS.length,
      acceptedClasses: derived.accepted.length,
      interactionOrdinals: contract.interactionOrdinals,
      identityCases: EXTRACTION_IDENTITY_CASES.length,
      rejectedBoundaries: EXTRACTION_REJECTION_CLASSES.length,
      retries: contract.retries,
    };
    const expectedSummary =
      `The locked private extraction corpus completed with a ${derived.decision.toUpperCase()} decision: ${derived.accepted.length} accepted interaction classes, ${EXTRACTION_REJECTION_CLASSES.length} rejected boundaries, and zero retries.`;
    const manifestWithoutRun = manifest.artifacts.filter(
      (artifact: { path: string }) => artifact.path !== "run.json",
    );
    if (
      manifest.experiment.id !== "extraction" ||
      manifest.source.dirty !== false ||
      manifest.run.id !== pinnedRunId ||
      !pinnedRunId.includes(manifest.source.commit.slice(0, 7)) ||
      manifest.run.status !== "passed" ||
      manifest.conclusion.status !== "pass" ||
      derived.decision !== "go" ||
      !isDeepStrictEqual(derived.accepted, EXTRACTION_ACCEPTED_CLASSES) ||
      decision.decision !== derived.decision ||
      !isDeepStrictEqual(decision.accepted, derived.accepted) ||
      decision.rejectedBoundariesPass !== recomputedBoundariesPass ||
      decision.deterministicGenerationPass !== recomputedGenerationPass ||
      decision.outputSafetyPass !== recomputedOutputSafetyPass ||
      !recomputedBoundariesPass || !recomputedGenerationPass || !recomputedOutputSafetyPass ||
      !isDeepStrictEqual(run.run, manifest.run) ||
      !isDeepStrictEqual(run.source, manifest.source) ||
      !isDeepStrictEqual(sourceRecord, { schemaVersion: 1, ...manifest.source }) ||
      !isDeepStrictEqual(
        manifest.environment,
        browserManifestEnvironment(preflight, reference),
      ) ||
      !isDeepStrictEqual(run.command, manifest.command.argv) ||
      manifest.command.cwd !== "." ||
      run.decision !== derived.decision ||
      !isDeepStrictEqual(run.accepted, derived.accepted) ||
      !isDeepStrictEqual(run.matrix, expectedMatrix) ||
      !isDeepStrictEqual(run.artifacts, manifestWithoutRun) ||
      !isDeepStrictEqual(measurements["accepted-interaction-class-count"], [derived.accepted.length]) ||
      !isDeepStrictEqual(measurements["identity-case-count"], [EXTRACTION_IDENTITY_CASES.length]) ||
      !isDeepStrictEqual(measurements["rejected-boundary-count"], [EXTRACTION_REJECTION_CLASSES.length]) ||
      !isDeepStrictEqual(measurements["retry-count"], [contract.retries]) ||
      manifest.workload.measuredIterations !== contract.interactionOrdinals ||
      manifest.conclusion.summary !== expectedSummary
    ) throw new Error("K0-06 immutable extraction result provenance differs");
  };
  verifyPinnedResult(pinnedRoot);
  const mutationRoot = mkdtempSync(join(
    realpathSync(tmpdir()),
    "fadeno-extraction-result-mutation-",
  ));
  const updateRecord = (
    records: Array<{ path: string; sha256: string; bytes: number }>,
    path: string,
    body: Buffer,
  ): void => {
    const record = records.find((item) => item.path === path);
    if (!record) throw new Error(`K0-06 mutation artifact is absent: ${path}`);
    record.sha256 = createHash("sha256").update(body).digest("hex");
    record.bytes = body.byteLength;
  };
  const rewriteCoordinatedArtifact = (
    runRoot: string,
    path: string,
    body: Buffer,
  ): void => {
    writeFileSync(join(runRoot, path), body);
    const manifest = readJsonDocument(join(runRoot, "manifest.json"));
    const run = readJsonDocument(join(runRoot, "run.json"));
    updateRecord(run.artifacts, path, body);
    updateRecord(manifest.artifacts, path, body);
    const runBody = Buffer.from(`${JSON.stringify(run, null, 2)}\n`);
    writeFileSync(join(runRoot, "run.json"), runBody);
    updateRecord(manifest.artifacts, "run.json", runBody);
    writeFileSync(join(runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  };
  const assertCoordinatedMutationRejected = (
    name: string,
    mutate: (runRoot: string) => void,
  ): void => {
    const runRoot = join(mutationRoot, name);
    cpSync(pinnedRoot, runRoot, { recursive: true });
    mutate(runRoot);
    try {
      verifyPinnedResult(runRoot);
      throw new Error(`K0-06 coordinated ${name} mutation was accepted`);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === `K0-06 coordinated ${name} mutation was accepted`
      ) throw error;
    }
  };
  try {
    assertCoordinatedMutationRejected("diagnostics", (runRoot) => {
      const diagnostics = readJsonDocument(join(runRoot, "rejected-diagnostics.json"));
      diagnostics.diagnostics[0].status = "failed";
      rewriteCoordinatedArtifact(
        runRoot,
        "rejected-diagnostics.json",
        Buffer.from(`${JSON.stringify(diagnostics, null, 2)}\n`),
      );
    });
    assertCoordinatedMutationRejected("generated", (runRoot) => {
      const path = "generated/toggle.js";
      rewriteCoordinatedArtifact(
        runRoot,
        path,
        Buffer.concat([readFileSync(join(runRoot, path)), Buffer.from("// forged\n")]),
      );
    });
    assertCoordinatedMutationRejected("run-summary", (runRoot) => {
      const manifest = readJsonDocument(join(runRoot, "manifest.json"));
      const run = readJsonDocument(join(runRoot, "run.json"));
      run.matrix.identityCases = 999;
      const runBody = Buffer.from(`${JSON.stringify(run, null, 2)}\n`);
      writeFileSync(join(runRoot, "run.json"), runBody);
      updateRecord(manifest.artifacts, "run.json", runBody);
      writeFileSync(join(runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    });
    assertCoordinatedMutationRejected("source", (runRoot) => {
      const source = readJsonDocument(join(runRoot, "source.json"));
      source.commit = "0".repeat(40);
      rewriteCoordinatedArtifact(
        runRoot,
        "source.json",
        Buffer.from(`${JSON.stringify(source, null, 2)}\n`),
      );
    });
    assertCoordinatedMutationRejected("preflight", (runRoot) => {
      const preflight = readJsonDocument(join(runRoot, "preflight.json"));
      preflight.host.cpuModel = "forged";
      rewriteCoordinatedArtifact(
        runRoot,
        "preflight.json",
        Buffer.from(`${JSON.stringify(preflight, null, 2)}\n`),
      );
    });
    assertCoordinatedMutationRejected("run-status", (runRoot) => {
      const manifest = readJsonDocument(join(runRoot, "manifest.json"));
      const run = readJsonDocument(join(runRoot, "run.json"));
      run.run.status = "failed";
      const runBody = Buffer.from(`${JSON.stringify(run, null, 2)}\n`);
      writeFileSync(join(runRoot, "run.json"), runBody);
      updateRecord(manifest.artifacts, "run.json", runBody);
      writeFileSync(join(runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    });
  } finally {
    rmSync(mutationRoot, { recursive: true, force: true });
  }
}

console.log(
  `extraction qualification verifier passed (12 observation, 5 report, 6 decision controls, ${resultEntries.length} immutable result)`,
);
