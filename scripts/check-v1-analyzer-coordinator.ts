import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrivateAnalyzerOperationCoordinator } from "../packages/framework/src/internal/analyzer-coordinator.ts";
import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return Object.freeze({ promise, resolve });
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

const firstGate = deferred();
const first = coordinator.start("analysis", () => observed("first", async () => {
  await firstGate.promise;
  return "first-result";
}));
const second = coordinator.start("explanation", () => observed("second", () => "second-result"));

assert.equal(Object.isFrozen(first), true);
assert.equal(first.sequence, 1);
assert.equal(second.sequence, 2);
assert.equal(first.kind, "analysis");
assert.equal(second.kind, "explanation");
assert.match(first.requestId, /^[0-9a-f-]{36}:request-1$/u);
assert.equal(second.requestId, first.requestId.replace(/request-1$/u, "request-2"));
await Promise.resolve();
assert.deepEqual(trace, ["start:first"]);
assert.equal(active, 1);
firstGate.resolve();
assert.equal(await first.result, "first-result");
assert.equal(await second.result, "second-result");
assert.deepEqual(trace, ["start:first", "finish:first", "start:second", "finish:second"]);

const failed = coordinator.start("analysis", () => observed("failed", () => {
  throw new TypeError("FADENO_TEST_RETAINED_FAILURE");
}));
const recovered = coordinator.start("analysis", () => observed("recovered", () => "recovered-result"));
await assert.rejects(failed.result, /FADENO_TEST_RETAINED_FAILURE/u);
assert.equal(await recovered.result, "recovered-result");
assert.equal(failed.sequence, 3);
assert.equal(recovered.sequence, 4);

const closeGate = deferred();
const finalGate = deferred();
const draining = coordinator.start("analysis", () => observed("draining", async () => {
  await closeGate.promise;
  return "drained";
}));
const rejectedWhileDraining = coordinator.start("explanation", () => observed("rejected", async () => {
  await finalGate.promise;
  throw new TypeError("FADENO_TEST_DRAINED_FAILURE");
}));
const closing = coordinator.close();
let closingSettled = false;
void closing.then(() => { closingSettled = true; });
const rejectedAssertion = assert.rejects(rejectedWhileDraining.result, /FADENO_TEST_DRAINED_FAILURE/u);
assert.equal(coordinator.state, "closing");
assert.equal(coordinator.close(), closing);
assert.throws(
  () => coordinator.start("analysis", () => "late"),
  /FADENO_ANALYZER_PROJECT_CLOSED/u,
);
await Promise.resolve();
assert.equal(trace.at(-1), "start:draining");
closeGate.resolve();
assert.equal(await draining.result, "drained");
await Promise.resolve();
assert.equal(trace.at(-1), "start:rejected");
assert.equal(closingSettled, false);
assert.equal(coordinator.state, "closing");
finalGate.resolve();
await rejectedAssertion;
await closing;
assert.equal(closingSettled, true);
assert.equal(coordinator.state, "closed");
assert.equal(active, 0);
assert.equal(maximumActive, 1);
assert.deepEqual(trace.slice(-4), ["start:draining", "finish:draining", "start:rejected", "finish:rejected"]);

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-retained-project-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(root);

  const firstAnalysisHandle = analyzer.analyze();
  const secondAnalysisHandle = analyzer.analyze();
  assert.equal(Object.isFrozen(firstAnalysisHandle), true);
  assert.equal(firstAnalysisHandle.sequence, 1);
  assert.equal(secondAnalysisHandle.sequence, 2);
  const [firstAnalysis, secondAnalysis] = await Promise.all([
    firstAnalysisHandle.result,
    secondAnalysisHandle.result,
  ]);
  assert.equal(firstAnalysis.publication.sessionId, secondAnalysis.publication.sessionId);
  assert.notEqual(firstAnalysis.publication.operationId, secondAnalysis.publication.operationId);
  assert.throws(() => firstAnalysis.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);

  const admittedExplanation = secondAnalysis.explain("semantic");
  const thirdAnalysisHandle = analyzer.analyze();
  assert.equal(thirdAnalysisHandle.sequence > secondAnalysisHandle.sequence, true);
  assert.throws(() => secondAnalysis.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);
  await assert.rejects(secondAnalysis.explain("semantic"), /FADENO_ANALYZER_PROJECT_STALE/u);
  const explanation = await admittedExplanation;
  assert.equal(explanation.status, "complete");
  const thirdAnalysis = await thirdAnalysisHandle.result;

  const drainingFirst = analyzer.analyze();
  const drainingSecond = analyzer.analyze();
  const projectClosing = analyzer.close();
  assert.equal(analyzer.close(), projectClosing);
  assert.throws(() => analyzer.analyze(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  assert.throws(() => thirdAnalysis.apply(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await assert.rejects(thirdAnalysis.explain("semantic"), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  const [drainedFirst, drainedSecond] = await Promise.all([
    drainingFirst.result,
    drainingSecond.result,
  ]);
  await projectClosing;
  assert.equal(drainedFirst.publication.sessionId, firstAnalysis.publication.sessionId);
  assert.equal(drainedSecond.publication.sessionId, firstAnalysis.publication.sessionId);
  assert.throws(() => drainedSecond.apply(), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  await assert.rejects(drainedSecond.explain("semantic"), /FADENO_ANALYZER_PROJECT_CLOSED/u);
  assert.equal(existsSync(join(root, ".fadeno")), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 retained project coordinator passed (FIFO, identity, failure drain, freshness, close)");
