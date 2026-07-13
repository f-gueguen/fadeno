import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PrivateAnalyzerOperationCoordinator,
  PrivateAnalyzerOperationInterrupted,
  type PrivateAnalyzerOperationHandle,
} from "../packages/framework/src/internal/analyzer-coordinator.ts";
import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";

function deferred<T = void>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

function interrupted<T>(
  handle: PrivateAnalyzerOperationHandle<T>,
  code: "FADENO_ANALYZER_PROJECT_CANCELLED" | "FADENO_ANALYZER_PROJECT_SUPERSEDED",
): Promise<void> {
  return assert.rejects(handle.result, (error) => {
    assert.ok(error instanceof PrivateAnalyzerOperationInterrupted);
    assert.equal(error.code, code);
    assert.equal(error.requestId, handle.requestId);
    return true;
  });
}

const coordinator = new PrivateAnalyzerOperationCoordinator();
const trace: string[] = [];
let active = 0;
let maximumActive = 0;

async function observed<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
  trace.push(`start:${name}`);
  active += 1;
  maximumActive = Math.max(maximumActive, active);
  try {
    return await operation();
  } finally {
    active -= 1;
    trace.push(`finish:${name}`);
  }
}

let burstBatch: Readonly<{ firstRequestId: string; latestRequestId: string; size: number }> | null = null;
const burstFirst = coordinator.start("analysis", () => observed("burst-first", () => "obsolete-first"));
const burstFirstInterrupted = interrupted(burstFirst, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
const burstMiddle = coordinator.start("analysis", () => observed("burst-middle", () => "obsolete-middle"));
const burstMiddleInterrupted = interrupted(burstMiddle, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
const burstNewest = coordinator.start("analysis", (_requestId, context) => observed("burst-newest", () => {
  burstBatch = context.batch;
  return "burst-current";
}));
await Promise.all([burstFirstInterrupted, burstMiddleInterrupted]);
assert.equal(await burstNewest.result, "burst-current");
assert.deepEqual(burstBatch, {
  firstRequestId: burstFirst.requestId,
  latestRequestId: burstNewest.requestId,
  size: 3,
});
assert.equal(Object.isFrozen(burstBatch), true);
assert.deepEqual(trace, ["start:burst-newest", "finish:burst-newest"]);

const largeBurstCoordinator = new PrivateAnalyzerOperationCoordinator();
const largeBurstInterruptions: Promise<void>[] = [];
let largeBurstPrevious: PrivateAnalyzerOperationHandle<number> | null = null;
let largeBurstCalls = 0;
let largeBurstSize = 0;
for (let index = 0; index < 256; index += 1) {
  const next = largeBurstCoordinator.start("analysis", (_requestId, context) => {
    largeBurstCalls += 1;
    largeBurstSize = context.batch.size;
    return index;
  });
  if (largeBurstPrevious) {
    largeBurstInterruptions.push(interrupted(largeBurstPrevious, "FADENO_ANALYZER_PROJECT_SUPERSEDED"));
  }
  largeBurstPrevious = next;
}
await Promise.all(largeBurstInterruptions);
assert.equal(await largeBurstPrevious!.result, 255);
assert.equal(largeBurstCalls, 1);
assert.equal(largeBurstSize, 256);
await largeBurstCoordinator.close();

const activeStarted = deferred();
const activeGate = deferred();
let activeSignal: AbortSignal | null = null;
const obsoleteActive = coordinator.start("analysis", (_requestId, context) => observed("obsolete-active", async () => {
  activeSignal = context.signal;
  activeStarted.resolve();
  await activeGate.promise;
  return "obsolete-active-result";
}));
await activeStarted.promise;
const obsoleteActiveInterrupted = interrupted(obsoleteActive, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
const queuedMiddle = coordinator.start("analysis", () => observed("queued-middle", () => "queued-middle-result"));
const queuedMiddleInterrupted = interrupted(queuedMiddle, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
let newestGeneration = 0;
const newest = coordinator.start("analysis", (_requestId, context) => observed("newest", () => {
  newestGeneration = context.generation;
  return "newest-result";
}));
assert.equal(activeSignal!.aborted, true, "new admission did not synchronously signal active analysis");
await queuedMiddleInterrupted;
activeGate.resolve();
await obsoleteActiveInterrupted;
assert.equal(await newest.result, "newest-result");
assert.equal(newestGeneration > 0, true);
assert.deepEqual(trace.slice(-4), ["start:obsolete-active", "finish:obsolete-active", "start:newest", "finish:newest"]);

const cancelledStarted = deferred();
const cancelledGate = deferred();
let cancelledSignal: AbortSignal | null = null;
const cancelled = coordinator.start("analysis", (_requestId, context) => observed("cancelled", async () => {
  cancelledSignal = context.signal;
  cancelledStarted.resolve();
  await cancelledGate.promise;
  return "cancelled-result";
}));
await cancelledStarted.promise;
const cancelledInterrupted = interrupted(cancelled, "FADENO_ANALYZER_PROJECT_CANCELLED");
cancelled.cancel();
assert.equal(cancelledSignal!.aborted, true);
const afterCancellation = coordinator.start("analysis", () => observed("after-cancellation", () => "recovered"));
cancelledGate.resolve();
await cancelledInterrupted;
assert.equal(await afterCancellation.result, "recovered");

const failed = coordinator.start("analysis", () => observed("failed", () => {
  throw new TypeError("FADENO_TEST_RETAINED_FAILURE");
}));
await assert.rejects(failed.result, /FADENO_TEST_RETAINED_FAILURE/u);
const afterFailure = coordinator.start("analysis", () => observed("after-failure", () => "failure-recovered"));
assert.equal(await afterFailure.result, "failure-recovered");

let handoff: PrivateAnalyzerOperationHandle<string> | null = null;
const handoffSource = coordinator.start("explanation", () => observed("handoff-source", () => "handoff-source-result"));
void handoffSource.result.then(() => {
  handoff = coordinator.start("explanation", () => observed("handoff-admitted", () => "handoff-result"));
});
assert.equal(await handoffSource.result, "handoff-source-result");
await Promise.resolve();
const handoffHandle = handoff as PrivateAnalyzerOperationHandle<string> | null;
assert.ok(handoffHandle, "result handoff did not admit follow-up work");
assert.equal(await handoffHandle.result, "handoff-result");

const closeGate = deferred();
const drainingStarted = deferred();
const finalFailureStarted = deferred();
const finalFailureGate = deferred();
const draining = coordinator.start("analysis", () => observed("draining", async () => {
  drainingStarted.resolve();
  await closeGate.promise;
  return "drained";
}));
await drainingStarted.promise;
const finalFailure = coordinator.start("explanation", () => observed("final-failure", async () => {
  finalFailureStarted.resolve();
  await finalFailureGate.promise;
  throw new TypeError("FADENO_TEST_FINAL_DRAIN_FAILURE");
}));
const finalFailureAssertion = assert.rejects(finalFailure.result, /FADENO_TEST_FINAL_DRAIN_FAILURE/u);
const closing = coordinator.close();
let closingSettled = false;
void closing.then(() => { closingSettled = true; });
assert.equal(coordinator.state, "closing");
assert.equal(coordinator.close(), closing);
assert.throws(() => coordinator.start("analysis", () => "late"), /FADENO_ANALYZER_PROJECT_CLOSED/u);
await Promise.resolve();
assert.equal(closingSettled, false);
closeGate.resolve();
assert.equal(await draining.result, "drained");
await finalFailureStarted.promise;
assert.equal(closingSettled, false, "close resolved before the final admitted failure settled");
finalFailureGate.resolve();
await finalFailureAssertion;
await closing;
assert.equal(coordinator.state, "closed");
assert.equal(active, 0);
assert.equal(maximumActive, 1);

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-retained-project-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(root);

  const firstAnalysisHandle = analyzer.analyze();
  const firstAnalysisInterrupted = interrupted(firstAnalysisHandle, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const middleAnalysisHandle = analyzer.analyze();
  const middleAnalysisInterrupted = interrupted(middleAnalysisHandle, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const currentAnalysisHandle = analyzer.analyze();
  await Promise.all([firstAnalysisInterrupted, middleAnalysisInterrupted]);
  const currentAnalysis = await currentAnalysisHandle.result;
  assert.equal(Object.isFrozen(currentAnalysisHandle), true);
  assert.equal(currentAnalysis.publication.publicationGeneration, 1, "obsolete burst advanced publication");

  const admittedExplanation = currentAnalysis.explain("semantic");
  const laterAnalysisHandle = analyzer.analyze();
  assert.throws(() => currentAnalysis.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);
  await assert.rejects(currentAnalysis.explain("semantic"), /FADENO_ANALYZER_PROJECT_STALE/u);
  const explanation = await admittedExplanation;
  assert.equal(explanation.status, "complete");
  const laterAnalysis = await laterAnalysisHandle.result;
  assert.equal(laterAnalysis.publication.publicationGeneration, 2);

  const firstBurstPath = join(root, "src/routes/burst-first");
  const middleBurstPath = join(root, "src/routes/burst-middle");
  const finalBurstPath = join(root, "src/routes/burst-final");
  mkdirSync(firstBurstPath, { recursive: true });
  writeFileSync(join(firstBurstPath, "page.tsx"), "export default function Page(): string { return 'first'; }\n");
  const projectBurstFirst = analyzer.analyze();
  const projectBurstFirstInterrupted = interrupted(projectBurstFirst, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  rmSync(firstBurstPath, { recursive: true });
  mkdirSync(middleBurstPath, { recursive: true });
  writeFileSync(join(middleBurstPath, "page.tsx"), "export default function Page(): string { return 'middle'; }\n");
  const projectBurstMiddle = analyzer.analyze();
  const projectBurstMiddleInterrupted = interrupted(projectBurstMiddle, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  rmSync(middleBurstPath, { recursive: true });
  mkdirSync(finalBurstPath, { recursive: true });
  writeFileSync(join(finalBurstPath, "page.tsx"), "export default function Page(): string { return 'final'; }\n");
  const projectBurstFinal = analyzer.analyze();
  await Promise.all([projectBurstFirstInterrupted, projectBurstMiddleInterrupted]);
  const projectBurstAnalysis = await projectBurstFinal.result;
  const projectBurstRoutes = projectBurstAnalysis.routePlan!.manifest.routes.map(({ id }) => id);
  assert.equal(projectBurstAnalysis.publication.publicationGeneration, 3);
  assert.equal(projectBurstRoutes.includes("/burst-first"), false);
  assert.equal(projectBurstRoutes.includes("/burst-middle"), false);
  assert.equal(projectBurstRoutes.includes("/burst-final"), true);

  const activeObsolete = analyzer.analyze();
  await Promise.resolve();
  const activeObsoleteInterrupted = interrupted(activeObsolete, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const activeNewest = analyzer.analyze();
  await activeObsoleteInterrupted;
  const activeNewestAnalysis = await activeNewest.result;
  assert.equal(activeNewestAnalysis.publication.publicationGeneration, 4, "active obsolete analysis advanced publication");

  const cancelledAnalysis = analyzer.analyze();
  await Promise.resolve();
  const cancelledAnalysisInterrupted = interrupted(cancelledAnalysis, "FADENO_ANALYZER_PROJECT_CANCELLED");
  cancelledAnalysis.cancel();
  await cancelledAnalysisInterrupted;
  const recoveredAnalysis = await analyzer.analyze().result;
  assert.equal(recoveredAnalysis.publication.publicationGeneration, 5, "cancelled analysis advanced publication");

  const drainingFirst = analyzer.analyze();
  const drainingSecondInterrupted = interrupted(drainingFirst, "FADENO_ANALYZER_PROJECT_SUPERSEDED");
  const drainingSecond = analyzer.analyze();
  const projectClosing = analyzer.close();
  assert.equal(analyzer.close(), projectClosing);
  assert.throws(() => analyzer.analyze(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  assert.throws(() => recoveredAnalysis.apply(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await assert.rejects(recoveredAnalysis.explain("semantic"), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await drainingSecondInterrupted;
  const drained = await drainingSecond.result;
  await projectClosing;
  assert.equal(drained.publication.sessionId, currentAnalysis.publication.sessionId);
  assert.throws(() => drained.apply(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await assert.rejects(drained.explain("semantic"), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  assert.equal(existsSync(join(root, ".fadeno")), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 retained project batching passed (burst, cancellation, supersession, wakeup, close)");
