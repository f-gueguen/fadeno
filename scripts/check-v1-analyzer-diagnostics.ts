import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnalyzerFacetValue } from "../packages/framework/src/internal/analyzer-facets.ts";
import {
  ANALYZER_DIAGNOSTIC_NAMESPACE,
  ANALYZER_DIAGNOSTIC_VERSION,
  createAnalyzerDiagnosticBatch,
  deserializeAnalyzerDiagnosticBatch,
  formatAnalyzerDiagnosticBatchHuman,
  prepareAnalyzerCorrectionApplication,
  serializeAnalyzerDiagnosticBatch,
  type AnalyzerDiagnosticBatch,
  type AnalyzerDiagnosticLocation,
} from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import type { AnalyzerGraphComputeContext, AnalyzerGraphNodeDefinition } from "../packages/framework/src/internal/analyzer-graph.ts";
import type { AnalyzerPublicationSnapshot } from "../packages/framework/src/internal/analyzer-publication.ts";
import { AnalyzerSession, type AnalyzerOperationResult } from "../packages/framework/src/internal/analyzer-session.ts";

function accepted(result: AnalyzerOperationResult) {
  if ("code" in result) assert.fail(result.code);
  return result.snapshot;
}

function compute(id: string, artifact: string | null = null) {
  return (context: AnalyzerGraphComputeContext) => {
    if (artifact) context.emitArtifact({ id: artifact, path: `.fadeno/${artifact.slice("artifact:".length)}.json`, value: { id } });
    return { id, owner: context.owner.path, dependencies: context.dependencies.map(({ id }) => id) };
  };
}

function location(
  session: AnalyzerSession,
  path: string,
  range: Readonly<{ start: number; end: number }> | null,
  rangeReason: AnalyzerDiagnosticLocation["rangeReason"],
): AnalyzerDiagnosticLocation {
  const document = session.currentSnapshot.documents.find((candidate) => candidate.path === path);
  assert.ok(document, path);
  return { uri: document.uri, path, range, rangeReason };
}

async function publish(
  session: AnalyzerSession,
  definitions: readonly AnalyzerGraphNodeDefinition[],
  materialize: (graph: AnalyzerPublicationSnapshot["graph"]) => AnalyzerDiagnosticBatch,
): Promise<Readonly<{ snapshot: AnalyzerPublicationSnapshot; batch: AnalyzerDiagnosticBatch }>> {
  let batch: AnalyzerDiagnosticBatch | undefined;
  const result = await session.startPublication({
    definitions,
    requestedFacets: [{ namespace: ANALYZER_DIAGNOSTIC_NAMESPACE }],
    materialize: ({ graph }) => {
      batch = materialize(graph);
      return [{
        namespace: ANALYZER_DIAGNOSTIC_NAMESPACE,
        version: ANALYZER_DIAGNOSTIC_VERSION,
        value: batch as unknown as AnalyzerFacetValue,
      }];
    },
  }).result;
  assert.equal(result.status, "published");
  assert.ok(batch);
  const facet = result.snapshot.facets.find(({ namespace }) => namespace === ANALYZER_DIAGNOSTIC_NAMESPACE);
  assert.deepEqual(facet?.value, batch);
  return { snapshot: result.snapshot, batch };
}

function normalizeBatch(batch: AnalyzerDiagnosticBatch) {
  const normalizeInstance = (value: string) => value.replace(`${batch.identity.operationId}:`, "");
  return {
    version: batch.version,
    identity: {
      workspaceEpoch: batch.identity.workspaceEpoch,
      configurationEpoch: batch.identity.configurationEpoch,
      documentVersions: batch.identity.documentVersions.map(({ version, lifetime }, index) => ({
        path: batch.identity.documents.find(({ uri }) => uri === batch.identity.documentVersions[index]?.uri)?.path,
        version,
        lifetime,
      })),
      documents: batch.identity.documents.map(({ path, length }) => ({ path, length })),
    },
    diagnostics: batch.diagnostics.map((diagnostic) => ({
      instanceId: normalizeInstance(diagnostic.instanceId),
      code: diagnostic.code,
      severity: diagnostic.severity,
      module: diagnostic.module,
      phase: diagnostic.phase,
      parameters: diagnostic.parameters,
      primaryLocation: { path: diagnostic.primaryLocation.path, range: diagnostic.primaryLocation.range, rangeReason: diagnostic.primaryLocation.rangeReason },
      relatedLocations: diagnostic.relatedLocations.map(({ path, range, rangeReason }) => ({ path, range, rangeReason })),
      causedBy: diagnostic.causedBy.map(normalizeInstance),
      correctionFixIds: diagnostic.correctionFixIds,
      internalFailure: diagnostic.internalFailure ? { incidentId: "<incident>" } : null,
      redaction: diagnostic.redaction,
      explanationRef: diagnostic.explanationRef,
    })),
    corrections: batch.corrections.map((correction) => ({
      fixId: correction.fixId,
      parameters: correction.parameters,
      safety: correction.safety,
      preferred: correction.preferred,
      diagnosticInstanceIds: correction.diagnosticInstanceIds.map(normalizeInstance),
      edits: correction.edits.map(({ path, version, lifetime, range, expectedText, text }) => ({ path, version, lifetime, range, expectedText, text })),
    })),
    skippedWork: batch.skippedWork.map(({ id, causedBy }) => ({ id, causedBy: causedBy.map(normalizeInstance) })),
    completeness: batch.completeness,
    redaction: batch.redaction,
    truncated: batch.truncated,
  };
}

function normalizedHuman(batch: AnalyzerDiagnosticBatch): string {
  return formatAnalyzerDiagnosticBatchHuman(batch)
    .replaceAll(batch.identity.operationId, "<operation>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gu, "<incident>");
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-diagnostics-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), new URL("./src/", new URL(`file://${root}/`)), { recursive: true });
  cpSync(new URL("../examples/v1-app/fadeno.config.ts", import.meta.url), join(root, "fadeno.config.ts"));
  const layoutPath = join(root, "src/routes/layout.tsx");
  const pagePath = join(root, "src/routes/page.tsx");
  const handlerPath = join(root, "src/routes/handler.ts");
  const configPath = join(root, "fadeno.config.ts");
  const session = new AnalyzerSession(root);
  accepted(session.open(layoutPath, 0, readFileSync(layoutPath, "utf8")));
  accepted(session.open(pagePath, 0, readFileSync(pagePath, "utf8")));
  accepted(session.open(configPath, 0, readFileSync(configPath, "utf8")));
  const uri = (path: string) => session.currentSnapshot.documents.find((document) => document.path === path)!.uri;
  const baseDefinitions: readonly AnalyzerGraphNodeDefinition[] = [
    {
      id: "route:page", ownerUri: uri("src/routes/page.tsx"), definitionVersion: 1, dependencies: ["route:root"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "page" }, compute: compute("page", "artifact:manifest"),
    },
    {
      id: "route:root", ownerUri: uri("src/routes/layout.tsx"), definitionVersion: 1, dependencies: [],
      module: { namespace: "fadeno.routes", version: 1, transformation: "layout" }, compute: compute("root"),
    },
  ];
  const success = await publish(session, baseDefinitions, (graph) => createAnalyzerDiagnosticBatch({
    graph, documents: session.currentSnapshot.documents, diagnostics: [], corrections: [], skippedWork: [],
  }));
  assert.equal(success.batch.diagnostics.length, 0);

  writeFileSync(handlerPath, "export function GET(): Response { return new Response('conflict'); }\n");
  accepted(session.open(handlerPath, 0, readFileSync(handlerPath, "utf8")));
  const handlerLocation = location(session, "src/routes/handler.ts", null, "filesystem-entry");
  const pageLocation = location(session, "src/routes/page.tsx", null, "filesystem-entry");
  const collisionDefinitions: readonly AnalyzerGraphNodeDefinition[] = [
    ...baseDefinitions,
    {
      id: "route:handler", ownerUri: uri("src/routes/handler.ts"), definitionVersion: 1, dependencies: ["route:root"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "handler" }, compute: compute("handler", "artifact:stale-route-owner"),
    },
  ];
  const collision = await publish(session, collisionDefinitions, (graph) => createAnalyzerDiagnosticBatch({
    graph,
    documents: session.currentSnapshot.documents,
    diagnostics: [
      {
        key: "handler-owner", code: "FADENO_ROUTE_ROUTE_ROLE_OWNER", parameters: { role: "handler", route: "/" },
        primaryLocation: handlerLocation, relatedLocations: [pageLocation], correctionFixIds: ["FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION"],
      },
      {
        key: "page-owner", code: "FADENO_ROUTE_ROUTE_ROLE_OWNER", parameters: { role: "page", route: "/" },
        primaryLocation: pageLocation, relatedLocations: [handlerLocation], correctionFixIds: ["FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION"],
      },
      {
        key: "route-collision", code: "FADENO_ROUTE_ROUTE_ROLE_COLLISION", parameters: { route: "/" },
        primaryLocation: handlerLocation, relatedLocations: [pageLocation], causedByKeys: ["handler-owner", "page-owner"],
        correctionFixIds: ["FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION"],
      },
    ],
    corrections: [{
      fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", parameters: { route: "/" }, safety: "review", preferred: false,
      diagnosticKeys: ["handler-owner", "page-owner", "route-collision"], edits: [],
    }],
    skippedWork: [{ id: "manifest-publication", causedByKeys: ["route-collision"] }],
  }));
  assert.equal(prepareAnalyzerCorrectionApplication(collision.batch, "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }).accepted, false);
  const serializedCollision = serializeAnalyzerDiagnosticBatch(collision.batch);
  const collisionRoundTrip = deserializeAnalyzerDiagnosticBatch(serializedCollision);
  assert.deepEqual(collisionRoundTrip, collision.batch);
  assert.equal(serializeAnalyzerDiagnosticBatch(collisionRoundTrip), serializedCollision);

  const recovery = await publish(session, baseDefinitions, (graph) => createAnalyzerDiagnosticBatch({
    graph, documents: session.currentSnapshot.documents, diagnostics: [], corrections: [], skippedWork: [],
  }));
  assert.equal(recovery.batch.diagnostics.length, 0);
  assert.equal(recovery.snapshot.artifacts.some(({ id }) => id === "artifact:stale-route-owner"), false);
  assert.equal(recovery.snapshot.removedArtifacts.some(({ id }) => id === "artifact:stale-route-owner"), true);
  assert.deepEqual(prepareAnalyzerCorrectionApplication(collision.batch, "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }), { accepted: false, fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", code: "FADENO_ANALYZER_CORRECTION_STALE" });

  const config = session.currentSnapshot.documents.find(({ path }) => path === "fadeno.config.ts")!;
  const configuredRootStart = config.effective.text.indexOf(JSON.stringify("src/routes"));
  assert.notEqual(configuredRootStart, -1);
  accepted(session.change(configPath, config.open!.lifetime, 1, [{
    start: configuredRootStart, end: configuredRootStart + JSON.stringify("src/routes").length, text: JSON.stringify("src/route"),
  }]));
  const changedConfig = session.currentSnapshot.documents.find(({ path }) => path === "fadeno.config.ts")!;
  const wrongRootStart = changedConfig.effective.text.indexOf(JSON.stringify("src/route"));
  const configDefinitions: readonly AnalyzerGraphNodeDefinition[] = [{
    id: "config:root", ownerUri: changedConfig.uri, definitionVersion: 1, dependencies: [],
    module: { namespace: "fadeno.configuration", version: 1, transformation: "ownership" }, compute: compute("config"),
  }];
  const configurationBatch = (graph: AnalyzerPublicationSnapshot["graph"]) => createAnalyzerDiagnosticBatch({
    graph,
    documents: session.currentSnapshot.documents,
    diagnostics: [{
      key: "missing-root", code: "FADENO_CONFIG_ROOT_MISSING", parameters: { configuredRoot: "src/route" },
      primaryLocation: location(session, "fadeno.config.ts", { start: wrongRootStart, end: wrongRootStart + JSON.stringify("src/route").length }, null),
      correctionFixIds: ["FADENO_FIX_CONFIG_ROOT"],
    }],
    corrections: [{
      fixId: "FADENO_FIX_CONFIG_ROOT", parameters: { replacement: "src/routes" }, safety: "automatic", preferred: true,
      diagnosticKeys: ["missing-root"], edits: [{
        uri: changedConfig.uri, path: changedConfig.path, version: changedConfig.open!.version, lifetime: changedConfig.open!.lifetime,
        range: { start: wrongRootStart, end: wrongRootStart + JSON.stringify("src/route").length },
        expectedText: JSON.stringify("src/route"), text: JSON.stringify("src/routes"),
      }],
    }],
    skippedWork: [{ id: "route-analysis", causedByKeys: ["missing-root"] }],
  });
  let configuration = await publish(session, configDefinitions, configurationBatch);
  const incidentId = "123e4567-e89b-42d3-a456-426614174000";
  const internal = createAnalyzerDiagnosticBatch({
    graph: configuration.snapshot.graph,
    documents: session.currentSnapshot.documents,
    diagnostics: [{
      key: "internal-failure", code: "FADENO_ANALYZER_INTERNAL_FAILURE", parameters: { operation: "route-analysis" },
      primaryLocation: configuration.batch.diagnostics[0]!.primaryLocation, internalFailure: { incidentId },
    }],
    corrections: [], skippedWork: [{ id: "route-analysis", causedByKeys: ["internal-failure"] }],
  });
  const canary = "FADENO_SECRET_CANARY";
  assert.throws(() => createAnalyzerDiagnosticBatch({
    graph: configuration.snapshot.graph,
    documents: session.currentSnapshot.documents,
    diagnostics: [{
      key: "internal-failure", code: "FADENO_ANALYZER_INTERNAL_FAILURE",
      parameters: { operation: "route-analysis", details: canary } as any,
      primaryLocation: configuration.batch.diagnostics[0]!.primaryLocation, internalFailure: { incidentId },
    }],
    corrections: [], skippedWork: [],
  }), /FADENO_ANALYZER_DIAGNOSTIC/u);
  const internalSerialized = serializeAnalyzerDiagnosticBatch(internal);
  assert.equal(internalSerialized.includes(canary), false);
  assert.equal(formatAnalyzerDiagnosticBatchHuman(internal).includes(canary), false);
  const invalidInternal = JSON.parse(internalSerialized);
  invalidInternal.batch.diagnostics[0].parameters.details = canary;
  assert.throws(() => deserializeAnalyzerDiagnosticBatch(JSON.stringify(invalidInternal)), /FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION/u);

  const counterfeitSnapshot = {
    ...session.currentSnapshot,
    documents: session.currentSnapshot.documents.map((document) => document.path === "fadeno.config.ts"
      ? {
        ...document,
        effective: {
          ...document.effective,
          text: `${document.effective.text.slice(0, wrongRootStart)}${JSON.stringify("src/wrong")}${document.effective.text.slice(wrongRootStart + JSON.stringify("src/route").length)}`,
        },
      }
      : document),
  };
  assert.deepEqual(prepareAnalyzerCorrectionApplication(configuration.batch, "FADENO_FIX_CONFIG_ROOT", {
    snapshot: counterfeitSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }), { accepted: false, fixId: "FADENO_FIX_CONFIG_ROOT", code: "FADENO_ANALYZER_CORRECTION_STALE" });
  const replacedConfiguration = configuration;
  await publish(session, configDefinitions, (graph) => createAnalyzerDiagnosticBatch({
    graph, documents: session.currentSnapshot.documents, diagnostics: [], corrections: [], skippedWork: [],
  }));
  assert.deepEqual(prepareAnalyzerCorrectionApplication(replacedConfiguration.batch, "FADENO_FIX_CONFIG_ROOT", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }), { accepted: false, fixId: "FADENO_FIX_CONFIG_ROOT", code: "FADENO_ANALYZER_CORRECTION_STALE" });
  configuration = await publish(session, configDefinitions, configurationBatch);
  const application = prepareAnalyzerCorrectionApplication(configuration.batch, "FADENO_FIX_CONFIG_ROOT", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  });
  assert.equal(application.accepted, true);
  assert.equal(application.after.includes(JSON.stringify("src/routes")), true);
  accepted(session.change(configPath, application.lifetime, application.version, application.edits));
  assert.deepEqual(prepareAnalyzerCorrectionApplication(configuration.batch, "FADENO_FIX_CONFIG_ROOT", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }), { accepted: false, fixId: "FADENO_FIX_CONFIG_ROOT", code: "FADENO_ANALYZER_CORRECTION_STALE" });
  assert.deepEqual(prepareAnalyzerCorrectionApplication(collision.batch, "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", {
    snapshot: session.currentSnapshot, configurationEpoch: 0, configurationFingerprint: "0".repeat(64),
    publicationOperationId: session.currentPublicationSnapshot?.operationId ?? null,
  }), { accepted: false, fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION", code: "FADENO_ANALYZER_CORRECTION_STALE" });

  for (const mutate of [
    (value: any) => { value.batch.diagnostics[0].code = "FADENO_UNKNOWN"; },
    (value: any) => { value.batch.diagnostics[0].primaryLocation.rangeReason = null; },
    (value: any) => { value.batch.diagnostics[0].causedBy = ["missing"]; },
    (value: any) => { value.batch.diagnostics[0].causedBy = [value.batch.diagnostics[2].instanceId]; },
    (value: any) => { value.batch.corrections[0].diagnosticInstanceIds = ["missing"]; },
    (value: any) => { value.batch.corrections[0].diagnosticInstanceIds.reverse(); },
    (value: any) => { value.batch.corrections[0].applicability.workspaceEpoch += 1; },
    (value: any) => { value.batch.identity.documentVersions.reverse(); },
    (value: any) => { value.batch.identity.operationId += "x"; },
  ]) {
    const invalid = JSON.parse(serializedCollision);
    mutate(invalid);
    assert.throws(() => deserializeAnalyzerDiagnosticBatch(JSON.stringify(invalid)), /FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION/u);
  }
  const serializedConfiguration = serializeAnalyzerDiagnosticBatch(configuration.batch);
  for (const mutate of [
    (value: any) => { value.batch.diagnostics[0].primaryLocation.range.end = 1_000_000; },
    (value: any) => { value.batch.corrections[0].edits[0].range = { start: 0, end: 11 }; },
    (value: any) => { value.batch.corrections[0].edits[0].version += 1; },
    (value: any) => { value.batch.corrections[0].edits[0].lifetime += 1; },
    (value: any) => { value.batch.corrections[0].edits[0].text = JSON.stringify("unsafe"); },
    (value: any) => { value.batch.corrections[0].edits[0].expectedText = JSON.stringify("unrelated"); },
    (value: any) => { value.batch.corrections[0].edits[0].range.end = 1_000_000; },
    (value: any) => {
      value.batch.corrections[0].parameters.replacement = "../escape";
      value.batch.corrections[0].edits[0].text = JSON.stringify("../escape");
    },
  ]) {
    const invalid = JSON.parse(serializedConfiguration);
    mutate(invalid);
    assert.throws(() => deserializeAnalyzerDiagnosticBatch(JSON.stringify(invalid)), /FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION/u);
  }
  assert.throws(
    () => deserializeAnalyzerDiagnosticBatch(`{"padding":"${"x".repeat(262_144)}"}`),
    /FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION/u,
  );

  const normalized = {
    success: normalizeBatch(success.batch),
    collision: normalizeBatch(collision.batch),
    recovery: {
      diagnostics: recovery.batch.diagnostics,
      corrections: recovery.batch.corrections,
      staleDiagnosticRemoved: true,
      staleArtifactRemoved: recovery.snapshot.removedArtifacts.some(({ id }) => id === "artifact:stale-route-owner"),
    },
    correction: {
      diagnostic: normalizeBatch(configuration.batch),
      before: application.before,
      after: application.after,
      staleRefusal: "FADENO_ANALYZER_CORRECTION_STALE",
    },
    internalFailure: normalizeBatch(internal),
  };
  const normalizedFixture = readFileSync(new URL("../fixtures/v1-analyzer/diagnostics.normalized.json", import.meta.url), "utf8");
  const humanFixture = readFileSync(new URL("../fixtures/v1-analyzer/diagnostics.human.txt", import.meta.url), "utf8");
  assert.equal(normalizedFixture.includes(canary), false);
  assert.equal(humanFixture.includes(canary), false);
  assert.deepEqual(normalized, JSON.parse(normalizedFixture));
  assert.equal(
    normalizedHuman(collision.batch),
    humanFixture,
  );
  console.log("V1 analyzer B5 passed (structured diagnostics, corrections, redaction, recovery)");
} finally {
  rmSync(root, { recursive: true, force: true });
}
