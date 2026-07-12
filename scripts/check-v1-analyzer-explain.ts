import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnalyzerFacetContribution } from "../packages/framework/src/internal/analyzer-facets.ts";
import { createAnalyzerDiagnosticBatch } from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import {
  deserializeAnalyzerExplainResult,
  serializeAnalyzerExplainResult,
} from "../packages/framework/src/internal/analyzer-explain.ts";
import type { AnalyzerGraphComputeContext, AnalyzerGraphNodeDefinition } from "../packages/framework/src/internal/analyzer-graph.ts";
import {
  createRouteExplainContribution,
  deserializeRouteExplainContribution,
  formatRouteExplainHuman,
  serializeRouteExplainContribution,
} from "../packages/framework/src/internal/analyzer-route-explain.ts";
import { AnalyzerSession, type AnalyzerOperationResult } from "../packages/framework/src/internal/analyzer-session.ts";

function accepted(result: AnalyzerOperationResult) {
  if ("code" in result) assert.fail(result.code);
  return result.snapshot;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-explain-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), new URL("./src/", new URL(`file://${root}/`)), { recursive: true });
  const layoutPath = join(root, "src/routes/layout.tsx");
  const pagePath = join(root, "src/routes/page.tsx");
  const session = new AnalyzerSession(root);
  accepted(session.open(layoutPath, 0, readFileSync(layoutPath, "utf8")));
  accepted(session.open(pagePath, 0, readFileSync(pagePath, "utf8")));
  const layout = session.currentSnapshot.documents.find(({ path }) => path === "src/routes/layout.tsx")!;
  const page = session.currentSnapshot.documents.find(({ path }) => path === "src/routes/page.tsx")!;
  let constructionCalls = 0;
  const compute = (id: string) => (context: AnalyzerGraphComputeContext) => {
    constructionCalls += 1;
    return { id, owner: context.owner.path };
  };
  const definitions: readonly AnalyzerGraphNodeDefinition[] = [
    {
      id: "route:page", ownerUri: page.uri, definitionVersion: 1, dependencies: ["route:root"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "page" }, compute: compute("page"),
    },
    {
      id: "route:root", ownerUri: layout.uri, definitionVersion: 1, dependencies: [],
      module: { namespace: "fadeno.routes", version: 1, transformation: "layout" }, compute: compute("root"),
    },
  ];
  let routeContribution: readonly AnalyzerFacetContribution[] = [];
  let collectorCalls = 0;
  const beforePublication = await session.startExplain({
    detail: "semantic", collect: () => { collectorCalls += 1; return routeContribution; },
  }).result;
  assert.equal(beforePublication.status, "refused");
  const serializedBeforePublication = serializeAnalyzerExplainResult(beforePublication);
  assert.equal(
    serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serializedBeforePublication)),
    serializedBeforePublication,
  );
  assert.equal(collectorCalls, 0);

  const published = await session.startPublication({
    definitions,
    requestedFacets: [{ namespace: "fadeno.routes" }],
    materialize: () => [{ namespace: "fadeno.routes", version: 1, value: { status: "ready" } }],
  }).result;
  assert.equal(published.status, "published");
  const publication = session.currentPublicationSnapshot;
  assert.ok(publication);
  routeContribution = [createRouteExplainContribution(publication, null, "semantic")];
  const callsAfterPublication = constructionCalls;

  const disabled = await session.startExplain({
    detail: "disabled", collect: () => { collectorCalls += 1; return routeContribution; },
  } as any).result;
  assert.equal(disabled.status, "disabled");
  const serializedDisabled = serializeAnalyzerExplainResult(disabled);
  assert.equal(serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serializedDisabled)), serializedDisabled);
  assert.equal(collectorCalls, 0);

  const disabledSupersessionGate = deferred<readonly AnalyzerFacetContribution[]>();
  const disabledSuperseded = session.startExplain({
    detail: "deep", activateDeep: true, collect: () => disabledSupersessionGate.promise,
  });
  await Promise.resolve();
  const disablesActive = await session.startExplain({ detail: "disabled" }).result;
  assert.equal(disablesActive.status, "disabled");
  assert.equal((await disabledSuperseded.result).status, "superseded");
  assert.equal(disabledSuperseded.signal.aborted, true);
  disabledSupersessionGate.resolve(routeContribution);

  for (const collect of [
    () => [],
    () => [routeContribution[0]!, routeContribution[0]!],
  ]) {
    const refusedContributionCount = await session.startExplain({ detail: "semantic", collect }).result;
    assert.equal(refusedContributionCount.status, "refused");
  }
  assert.equal(session.currentPublicationSnapshot, publication);
  assert.equal(constructionCalls, callsAfterPublication);

  const semanticFlow = await session.startExplain({
    detail: "semantic",
    collect: ({ publication: current, detail }) => [createRouteExplainContribution(current, null, detail)],
  }).result;
  assert.equal(semanticFlow.status, "complete");
  const serializedSemanticFlow = serializeAnalyzerExplainResult(semanticFlow);
  const deserializedSemanticFlow = deserializeAnalyzerExplainResult(serializedSemanticFlow);
  assert.equal(serializeAnalyzerExplainResult(deserializedSemanticFlow), serializedSemanticFlow);
  assert.throws(() => { (deserializedSemanticFlow.identity.documentVersions as any[]).push({}); }, TypeError);
  if (semanticFlow.status === "complete") {
    const value = semanticFlow.contributions[0]!.value as any;
    assert.equal(value.family, "static-analysis");
    assert.equal(value.detail, "semantic");
    assert.deepEqual(value.records.filter(({ kind }: any) => kind === "decision").map(({ fields }: any) => fields.decision), [
      "publish-static-route-plan",
    ]);
    assert.equal(value.records.some(({ kind }: any) => kind === "forensic"), false);
    assert.equal(value.records.some(({ kind, fields }: any) => kind === "outcome" && fields.status === "static-ready"), true);
  }
  const deepFlow = await session.startExplain({
    detail: "deep",
    activateDeep: true,
    collect: ({ publication: current, detail }) => [createRouteExplainContribution(current, null, detail)],
  }).result;
  assert.equal(deepFlow.status, "complete");
  if (deepFlow.status === "complete") {
    assert.equal((deepFlow.contributions[0]!.value as any).records.some(({ kind }: any) => kind === "forensic"), true);
  }
  const serializedFlow = serializeRouteExplainContribution(routeContribution[0]!);
  assert.equal(serializeRouteExplainContribution(deserializeRouteExplainContribution(serializedFlow)), serializedFlow);
  for (const mutate of [
    (value: any) => { value.contribution.value.records[0].fields.observedRequestOrder = 1; },
    (value: any) => {
      value.contribution.value.records[0].kind = "cause";
      value.contribution.value.records[0].fields = {
        code: "FADENO_EXPLAIN_SECRET_CANARY",
        diagnosticInstanceId: "canary",
      };
    },
    (value: any) => { value.contribution.value.records[0].parentId = "missing"; },
    (value: any) => {
      value.contribution.value.records[0].parentId = value.contribution.value.records[1].id;
      value.contribution.value.records[1].parentId = value.contribution.value.records[0].id;
    },
    (value: any) => {
      value.contribution.value.records[0].causedBy = [value.contribution.value.records[1].id];
      value.contribution.value.records[1].causedBy = [value.contribution.value.records[0].id];
    },
    (value: any) => { value.contribution.value.family = "observed-runtime"; },
    (value: any) => { value.contribution.value.records[0].fields.secret = "FADENO_EXPLAIN_SECRET_CANARY"; },
  ]) {
    const invalid = JSON.parse(serializedFlow);
    mutate(invalid);
    assert.throws(() => deserializeRouteExplainContribution(JSON.stringify(invalid)), /FADENO_ANALYZER_ROUTE_EXPLAIN_SERIALIZATION/u);
  }
  for (const [budget, reason] of [
    [{ records: 1 }, "records"],
    [{ depth: 1 }, "depth"],
    [{ children: 1 }, "children"],
    [{ bytes: 100 }, "bytes"],
  ] as const) {
    const limited = await session.startExplain({
      detail: "semantic", budgets: budget,
      collect: ({ publication: active }) => [createRouteExplainContribution(active, null, "semantic")],
    }).result;
    assert.equal(limited.status, "partial");
    if (limited.status === "partial") {
      assert.equal(limited.truncation, reason);
      const contribution = limited.contributions[0]!;
      const serialized = serializeRouteExplainContribution(contribution);
      assert.equal(serializeRouteExplainContribution(deserializeRouteExplainContribution(serialized)), serialized);
      const serializedResult = serializeAnalyzerExplainResult(limited);
      assert.equal(serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serializedResult)), serializedResult);
      const records = (contribution.value as any).records;
      const retained = new Set(records.map(({ id }: any) => id));
      for (const record of records) {
        if (record.parentId !== null) assert.equal(retained.has(record.parentId), true);
        assert.equal(record.causedBy.every((id: string) => retained.has(id)), true);
      }
    }
  }
  const causalDepthContribution = JSON.parse(JSON.stringify(routeContribution[0])) as AnalyzerFacetContribution;
  const causalRecords = (causalDepthContribution.value as any).records;
  const ownershipPage = causalRecords.find(({ id }: any) => id === "ownership-route-page");
  const ownershipRoot = causalRecords.find(({ id }: any) => id === "ownership-route-root");
  const outcome = causalRecords.find(({ id }: any) => id === "route-outcome");
  ownershipRoot.causedBy = [ownershipPage.id];
  outcome.causedBy = [ownershipRoot.id];
  const causalDepthLimited = await session.startExplain({
    detail: "semantic", budgets: { depth: 2 }, collect: () => [causalDepthContribution],
  }).result;
  assert.equal(causalDepthLimited.status, "partial");
  if (causalDepthLimited.status === "partial") assert.equal(causalDepthLimited.truncation, "depth");

  const mismatchedPublication = JSON.parse(JSON.stringify(routeContribution[0])) as AnalyzerFacetContribution;
  (mismatchedPublication.value as any).publicationGeneration += 1;
  assert.equal((await session.startExplain({
    detail: "semantic", collect: () => [mismatchedPublication],
  }).result).status, "refused");
  const durationLimited = await session.startExplain({
    detail: "semantic", budgets: { durationMs: 1 },
    collect: () => new Promise((resolve) => setTimeout(() => resolve(routeContribution), 20)),
  }).result;
  assert.equal(durationLimited.status, "partial");
  if (durationLimited.status === "partial") {
    assert.equal(durationLimited.truncation, "duration");
    const serialized = serializeAnalyzerExplainResult(durationLimited);
    assert.equal(serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serialized)), serialized);
  }
  let durationSignal: AbortSignal | undefined;
  const cooperativeDuration = await session.startExplain({
    detail: "semantic", budgets: { durationMs: 1 },
    collect: ({ signal }) => {
      durationSignal = signal;
      return new Promise((resolve) => setTimeout(() => resolve(routeContribution), 20));
    },
  }).result;
  assert.equal(cooperativeDuration.status, "partial");
  assert.equal(durationSignal?.aborted, true);
  const synchronousDuration = await session.startExplain({
    detail: "semantic", budgets: { durationMs: 1 },
    collect: () => {
      const start = performance.now();
      while (performance.now() - start < 5) { /* trusted module work is measured even when synchronous */ }
      return routeContribution;
    },
  }).result;
  assert.equal(synchronousDuration.status, "partial");
  if (synchronousDuration.status === "partial") assert.equal(synchronousDuration.truncation, "duration");
  assert.equal(constructionCalls, callsAfterPublication);
  assert.equal(session.currentPublicationSnapshot, publication);

  for (const request of [
    { detail: "deep", collect: () => { collectorCalls += 1; return routeContribution; } },
    { detail: "semantic", activateDeep: true, collect: () => { collectorCalls += 1; return routeContribution; } },
    { detail: "semantic", budgets: { bytes: 0 }, collect: () => { collectorCalls += 1; return routeContribution; } },
    { detail: "deep", activateDeep: true, budgets: { depth: 17 }, collect: () => { collectorCalls += 1; return routeContribution; } },
  ] as const) {
    assert.equal((await session.startExplain(request as any).result).status, "refused");
  }
  assert.equal(collectorCalls, 0);

  const complete = await session.startExplain({
    detail: "semantic",
    collect: ({ publication: current, detail, budgets }) => {
      collectorCalls += 1;
      assert.equal(current, publication);
      assert.equal(detail, "semantic");
      assert.equal(budgets.depth, 8);
      return routeContribution;
    },
  }).result;
  assert.equal(complete.status, "complete");
  assert.equal(complete.identity.publicationOperationId, publication.operationId);
  assert.equal(complete.identity.publicationGeneration, publication.publicationGeneration);
  assert.deepEqual(complete.identity.requestedFacets, [{ namespace: "fadeno.routes.explain" }]);
  assert.deepEqual(complete.identity.documentVersions, publication.documentVersions);
  assert.equal(complete.identity.sessionId, publication.sessionId);
  assert.deepEqual(complete.identity.ownership, publication.ownership);
  assert.deepEqual(complete.contributions, routeContribution);
  assert.equal(session.currentPublicationSnapshot, publication);
  assert.equal(constructionCalls, callsAfterPublication);

  let cancelledCollectorCalls = 0;
  const cancelled = session.startExplain({
    detail: "semantic", collect: () => { cancelledCollectorCalls += 1; return routeContribution; },
  });
  cancelled.cancel();
  const cancelledResult = await cancelled.result;
  assert.equal(cancelledResult.status, "cancelled");
  if (cancelledResult.status === "cancelled") {
    assert.equal(cancelledResult.completeness, "interrupted");
    assert.equal(cancelledResult.interruption, "cancelled");
    assert.deepEqual(cancelledResult.contributions, []);
    const serialized = serializeAnalyzerExplainResult(cancelledResult);
    assert.equal(serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serialized)), serialized);
  }
  assert.equal(cancelledCollectorCalls, 0);

  const runningGate = deferred<readonly AnalyzerFacetContribution[]>();
  const running = session.startExplain({ detail: "semantic", collect: () => runningGate.promise });
  await Promise.resolve();
  running.cancel();
  assert.equal((await running.result).status, "cancelled");
  runningGate.resolve(routeContribution);

  const obsoleteGate = deferred<readonly AnalyzerFacetContribution[]>();
  const obsolete = session.startExplain({ detail: "semantic", collect: () => obsoleteGate.promise });
  await Promise.resolve();
  const current = session.startExplain({
    detail: "deep", activateDeep: true,
    collect: ({ publication: active }) => [createRouteExplainContribution(active, null, "deep")],
  });
  const obsoleteResult = await obsolete.result;
  assert.equal(obsoleteResult.status, "superseded");
  if (obsoleteResult.status === "superseded") assert.equal(obsoleteResult.interruption, "superseded");
  assert.equal((await current.result).status, "complete");
  obsoleteGate.resolve(routeContribution);

  const staleDocumentGate = deferred<readonly AnalyzerFacetContribution[]>();
  const staleDocument = session.startExplain({ detail: "semantic", collect: () => staleDocumentGate.promise });
  await Promise.resolve();
  accepted(session.change(pagePath, page.open!.lifetime, 1, [{
    start: page.effective.text.length, end: page.effective.text.length, text: "\n/* explain stale */\n",
  }]));
  const staleDocumentResult = await staleDocument.result;
  assert.equal(staleDocumentResult.status, "stale");
  if (staleDocumentResult.status === "stale") assert.equal(staleDocumentResult.interruption, "stale");
  staleDocumentGate.resolve(routeContribution);

  const republished = await session.startPublication({
    definitions,
    requestedFacets: [{ namespace: "fadeno.routes" }],
    materialize: () => [{ namespace: "fadeno.routes", version: 1, value: { status: "ready" } }],
  }).result;
  assert.equal(republished.status, "published");
  const stalePublicationGate = deferred<readonly AnalyzerFacetContribution[]>();
  const stalePublication = session.startExplain({ detail: "semantic", collect: () => stalePublicationGate.promise });
  await Promise.resolve();
  const replacement = session.startPublication({
    definitions,
    requestedFacets: [{ namespace: "fadeno.routes" }],
    materialize: () => [{ namespace: "fadeno.routes", version: 1, value: { status: "replaced" } }],
  });
  assert.equal((await stalePublication.result).status, "stale");
  assert.equal((await replacement.result).status, "published");
  stalePublicationGate.resolve(routeContribution);

  const collisionPublication = session.currentPublicationSnapshot!;
  const currentPage = session.currentSnapshot.documents.find(({ path }) => path === "src/routes/page.tsx")!;
  const currentLayout = session.currentSnapshot.documents.find(({ path }) => path === "src/routes/layout.tsx")!;
  const collisionDiagnostics = createAnalyzerDiagnosticBatch({
    graph: collisionPublication.graph,
    documents: session.currentSnapshot.documents,
    diagnostics: [{
      key: "route-collision", code: "FADENO_ROUTE_ROUTE_ROLE_COLLISION", parameters: { route: "/" },
      primaryLocation: { uri: currentPage.uri, path: currentPage.path, range: null, rangeReason: "filesystem-entry" },
      relatedLocations: [{ uri: currentLayout.uri, path: currentLayout.path, range: null, rangeReason: "filesystem-entry" }],
    }],
    corrections: [], skippedWork: [{ id: "manifest-publication", causedByKeys: ["route-collision"] }],
  });
  for (const mutate of [
    (value: any) => { value.identity.sessionId = "different-session"; },
    (value: any) => { value.identity.documentVersions[0].version += 1; },
    (value: any) => { value.identity.ownership.root = "file:///different-root/"; },
    (value: any) => { value.identity.ownership.configurationFingerprint = "f".repeat(64); },
  ]) {
    const mismatchedDiagnostics = JSON.parse(JSON.stringify(collisionDiagnostics));
    mutate(mismatchedDiagnostics);
    assert.throws(
      () => createRouteExplainContribution(collisionPublication, mismatchedDiagnostics, "semantic"),
      /FADENO_ANALYZER_ROUTE_EXPLAIN_DIAGNOSTICS/u,
    );
  }
  const collisionFlow = await session.startExplain({
    detail: "semantic",
    collect: ({ publication: active }) => [createRouteExplainContribution(active, collisionDiagnostics, "semantic")],
  }).result;
  assert.equal(collisionFlow.status, "complete");
  if (collisionFlow.status === "complete") {
    const records = (collisionFlow.contributions[0]!.value as any).records;
    assert.equal(records.some(({ kind, fields }: any) => kind === "cause" && fields.code === "FADENO_ROUTE_ROUTE_ROLE_COLLISION"), true);
    assert.equal(records.some(({ kind, fields }: any) => kind === "skipped" && fields.workId === "manifest-publication"), true);
    assert.equal(records.some(({ kind, fields }: any) => kind === "outcome" && fields.status === "static-refused"), true);
  }
  const recoveryFlow = await session.startExplain({
    detail: "semantic",
    collect: ({ publication: active }) => [createRouteExplainContribution(active, null, "semantic")],
  }).result;
  assert.equal(recoveryFlow.status, "complete");
  const summarize = (result: typeof collisionFlow) => {
    assert.equal(result.status, "complete");
    if (result.status !== "complete") return null;
    const records = (result.contributions[0]!.value as any).records;
    return {
      decision: records.find(({ kind }: any) => kind === "decision")?.fields.decision,
      ownership: records.filter(({ kind }: any) => kind === "ownership").map(({ fields }: any) => ({ nodeId: fields.nodeId, ownerPath: fields.ownerPath })),
      skipped: records.filter(({ kind }: any) => kind === "skipped").map(({ fields }: any) => fields.workId),
      diagnosticCodes: records.find(({ kind }: any) => kind === "outcome")?.fields.diagnosticCodes,
      outcome: records.find(({ kind }: any) => kind === "outcome")?.fields.status,
    };
  };
  const flowFixture = readFileSync(new URL("../fixtures/v1-analyzer/explain-flow.normalized.json", import.meta.url), "utf8");
  assert.equal(flowFixture.includes("FADENO_EXPLAIN_SECRET_CANARY"), false);
  assert.deepEqual({
    success: summarize(semanticFlow),
    collision: summarize(collisionFlow),
    recovery: summarize(recoveryFlow),
  }, JSON.parse(flowFixture));
  assert.equal([
    "SUCCESS",
    formatRouteExplainHuman(semanticFlow.status === "complete" ? semanticFlow.contributions[0]! : routeContribution[0]!).trimEnd(),
    "",
    "COLLISION",
    formatRouteExplainHuman(collisionFlow.status === "complete" ? collisionFlow.contributions[0]! : routeContribution[0]!).trimEnd(),
    "",
    "RECOVERY",
    formatRouteExplainHuman(recoveryFlow.status === "complete" ? recoveryFlow.contributions[0]! : routeContribution[0]!).trimEnd(),
    "",
  ].join("\n"), readFileSync(new URL("../fixtures/v1-analyzer/explain-flow.human.txt", import.meta.url), "utf8"));

  const failed = await session.startExplain({ detail: "semantic", collect: () => Promise.reject(new Error("private")) }).result;
  assert.equal(failed.status, "refused");
  const serializedFailed = serializeAnalyzerExplainResult(failed);
  assert.equal(serializeAnalyzerExplainResult(deserializeAnalyzerExplainResult(serializedFailed)), serializedFailed);
  const synchronousFailure = await session.startExplain({
    detail: "semantic", collect: () => { throw new Error("private synchronous failure"); },
  }).result;
  assert.equal(synchronousFailure.status, "refused");
  for (const mutate of [
    (value: any) => { value.result.identity.requestedFacets = []; },
    (value: any) => { value.result.identity.documentVersions[0].version = -1; },
    (value: any) => { value.result.identity.documentVersions[0].lifetime = 0; },
    (value: any) => { value.result.identity.sessionId = ""; },
    (value: any) => { value.result.identity.ownership.configurationFingerprint = "secret"; },
    (value: any) => { value.result.completeness = "partial"; },
    (value: any) => { value.result.contributions[0].value.publicationGeneration += 1; },
    (value: any) => { value.result.observedRuntime = true; },
  ]) {
    const invalid = JSON.parse(serializedSemanticFlow);
    mutate(invalid);
    assert.throws(() => deserializeAnalyzerExplainResult(JSON.stringify(invalid)), /FADENO_ANALYZER_EXPLAIN_SERIALIZATION/u);
  }
  assert.equal(session.currentPublicationSnapshot?.facets[0]?.value && true, true);
  console.log("V1 analyzer B6 lifecycle passed (disabled, activation, cancellation, supersession, freshness)");
} finally {
  rmSync(root, { recursive: true, force: true });
}
