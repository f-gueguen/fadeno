import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnalyzerFacetContribution } from "../packages/framework/src/internal/analyzer-facets.ts";
import type { AnalyzerGraphComputeContext, AnalyzerGraphNodeDefinition } from "../packages/framework/src/internal/analyzer-graph.ts";
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

function compute(id: string, artifactIds: readonly string[]) {
  return (context: AnalyzerGraphComputeContext) => {
    for (const artifactId of artifactIds) {
      context.emitArtifact({
        id: artifactId,
        path: `.fadeno/${artifactId.slice("artifact:".length)}.json`,
        value: { id, owner: context.owner.path },
      });
    }
    return { id, dependencyValues: context.dependencies.map(({ value }) => value) };
  };
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-publication-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), new URL("./", new URL(`file://${root}/`)), { recursive: true });
  const rootPath = join(root, "routes/layout.tsx");
  const pagePath = join(root, "routes/admin/dashboard/page.tsx");
  const session = new AnalyzerSession(root);
  accepted(session.open(rootPath, 0, readFileSync(rootPath, "utf8")));
  accepted(session.open(pagePath, 0, readFileSync(pagePath, "utf8")));
  const rootUri = session.currentSnapshot.documents.find(({ path }) => path === "routes/layout.tsx")!.uri;
  const pageUri = session.currentSnapshot.documents.find(({ path }) => path === "routes/admin/dashboard/page.tsx")!.uri;
  const rootCompute = compute("root", ["artifact:root"]);
  const pageCompute = compute("page", ["artifact:page"]);
  const definitions: readonly AnalyzerGraphNodeDefinition[] = [
    {
      id: "route:page", ownerUri: pageUri, definitionVersion: 1, dependencies: ["route:root"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "page" }, compute: pageCompute,
    },
    {
      id: "route:root", ownerUri: rootUri, definitionVersion: 1, dependencies: [],
      module: { namespace: "fadeno.routes", version: 1, transformation: "layout" }, compute: rootCompute,
    },
  ];
  const requestedFacets = [{ namespace: "fadeno.diagnostics" }, { namespace: "fadeno.routes" }] as const;
  const successContributions: readonly AnalyzerFacetContribution[] = [
    { namespace: "fadeno.diagnostics", version: 1, value: { records: [] } },
    { namespace: "fadeno.routes", version: 1, value: { status: "ready" } },
  ];
  const initialHandle = session.startPublication({
    definitions,
    requestedFacets,
    materialize: () => successContributions,
  });
  const initial = await initialHandle.result;
  assert.equal(initial.status, "published");
  const initialSnapshot = initial.snapshot;
  assert.equal(session.currentPublicationSnapshot, initialSnapshot);
  assert.equal(initialSnapshot.publicationGeneration, 1);
  assert.deepEqual(initialSnapshot.requestedFacets.map(({ namespace }) => namespace), [
    "fadeno.diagnostics", "fadeno.graph", "fadeno.routes",
  ]);
  assert.deepEqual(initialSnapshot.artifacts.map(({ id }) => id), ["artifact:page", "artifact:root"]);

  const errorCompute = compute("page-error", ["artifact:page", "artifact:stale-diagnostic-output"]);
  const errorDefinitions = definitions.map((definition) => definition.id === "route:page"
    ? { ...definition, definitionVersion: 2, compute: errorCompute }
    : definition);
  const errorGate = deferred<readonly AnalyzerFacetContribution[]>();
  const errorHandle = session.startPublication({
    definitions: errorDefinitions,
    requestedFacets,
    materialize: () => errorGate.promise,
  });
  await Promise.resolve();
  assert.equal(session.currentPublicationSnapshot, initialSnapshot, "partial generation became visible");
  errorGate.resolve([
    { namespace: "fadeno.diagnostics", version: 1, value: { records: [{ code: "FADENO_SAMPLE_ERROR" }] } },
    { namespace: "fadeno.routes", version: 1, value: { status: "blocked" } },
  ]);
  const errored = await errorHandle.result;
  assert.equal(errored.status, "published");
  assert.equal(errored.snapshot.publicationGeneration, 2);
  assert.equal(errored.snapshot.artifacts.some(({ id }) => id === "artifact:stale-diagnostic-output"), true);

  const recoveryHandle = session.startPublication({ definitions, requestedFacets, materialize: () => successContributions });
  const recovery = await recoveryHandle.result;
  assert.equal(recovery.status, "published");
  assert.equal(recovery.snapshot.publicationGeneration, 3);
  assert.deepEqual(recovery.snapshot.facets.find(({ namespace }) => namespace === "fadeno.diagnostics")?.value, { records: [] });
  assert.equal(recovery.snapshot.artifacts.some(({ id }) => id === "artifact:stale-diagnostic-output"), false);
  assert.deepEqual(recovery.snapshot.removedArtifacts, [{
    id: "artifact:stale-diagnostic-output",
    path: ".fadeno/stale-diagnostic-output.json",
    ownerNodeId: "route:page",
  }]);

  const cancelledGate = deferred<readonly AnalyzerFacetContribution[]>();
  const cancelledHandle = session.startPublication({
    definitions,
    requestedFacets,
    materialize: () => cancelledGate.promise,
  });
  cancelledHandle.cancel();
  const cancelled = await cancelledHandle.result;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelledHandle.signal.aborted, true);
  assert.equal(session.currentPublicationSnapshot, recovery.snapshot);

  const obsoleteGate = deferred<readonly AnalyzerFacetContribution[]>();
  const obsoleteHandle = session.startPublication({ definitions, requestedFacets, materialize: () => obsoleteGate.promise });
  const currentHandle = session.startPublication({ definitions, requestedFacets, materialize: () => successContributions });
  const obsolete = await obsoleteHandle.result;
  const current = await currentHandle.result;
  assert.equal(obsolete.status, "superseded");
  assert.equal(current.status, "published");
  assert.equal(session.currentPublicationSnapshot, current.snapshot);
  assert.equal(current.snapshot.publicationGeneration, 4);

  const staleGate = deferred<readonly AnalyzerFacetContribution[]>();
  const staleHandle = session.startPublication({ definitions, requestedFacets, materialize: () => staleGate.promise });
  const rootDocument = session.currentSnapshot.documents.find(({ uri }) => uri === rootUri)!;
  accepted(session.change(rootPath, rootDocument.open!.lifetime, 1, [
    { start: rootDocument.effective.text.length, end: rootDocument.effective.text.length, text: "\n/* stale */\n" },
  ]));
  const stale = await staleHandle.result;
  assert.equal(stale.status, "stale");
  assert.equal(session.currentPublicationSnapshot, current.snapshot);

  const configurationGate = deferred<readonly AnalyzerFacetContribution[]>();
  const configurationHandle = session.startPublication({ definitions, requestedFacets, materialize: () => configurationGate.promise });
  accepted(session.reloadConfiguration("b".repeat(64)));
  assert.equal((await configurationHandle.result).status, "stale");
  assert.equal(session.currentPublicationSnapshot, current.snapshot);

  const reserved = await session.startPublication({
    definitions,
    requestedFacets: [{ namespace: "fadeno.graph" }],
    materialize: () => [],
  }).result;
  assert.equal(reserved.status, "refused");
  const unrequested = await session.startPublication({
    definitions,
    requestedFacets: [{ namespace: "fadeno.routes" }],
    materialize: () => [{ namespace: "fadeno.diagnostics", version: 1, value: { records: [] } }],
  }).result;
  assert.equal(unrequested.status, "refused");
  assert.equal(session.currentPublicationSnapshot, current.snapshot);

  const normalize = (snapshot: typeof errored.snapshot) => ({
    error: {
      generation: snapshot.publicationGeneration,
      facets: snapshot.facets,
      artifacts: snapshot.artifacts.map(({ id, path, ownerNodeId }) => ({ id, path, ownerNodeId })),
    },
    recovery: {
      generation: recovery.snapshot.publicationGeneration,
      facets: recovery.snapshot.facets,
      artifacts: recovery.snapshot.artifacts.map(({ id, path, ownerNodeId }) => ({ id, path, ownerNodeId })),
      removedArtifacts: recovery.snapshot.removedArtifacts,
    },
  });
  const fixture = normalize(errored.snapshot);
  const expected = JSON.parse(readFileSync(new URL("../fixtures/v1-analyzer/publication-recovery.normalized.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, expected);
  console.log("V1 analyzer B4 passed (atomic replacement, recovery, cancellation, supersession, stale suppression)");
} finally {
  rmSync(root, { recursive: true, force: true });
}
