import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ANALYZER_GRAPH_LIMITS,
  deserializeAnalyzerGraphSnapshot,
  serializeAnalyzerGraphSnapshot,
  type AnalyzerGraphComputeContext,
  type AnalyzerGraphNodeDefinition,
  type AnalyzerGraphOperationResult,
  type AnalyzerGraphSnapshot,
} from "../packages/framework/src/internal/analyzer-graph.ts";
import {
  AnalyzerSession,
  type AnalyzerOperationResult,
} from "../packages/framework/src/internal/analyzer-session.ts";

const canonicalSource = new URL("../examples/v1-app/src/", import.meta.url);
const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-graph-"));
const operationIds = new Set<string>();
let currentGraph: AnalyzerGraphSnapshot;

function recordOperation(result: { readonly operationId: string }): void {
  assert.ok(!operationIds.has(result.operationId), `duplicate operation ID ${result.operationId}`);
  operationIds.add(result.operationId);
  assert.equal(Object.isFrozen(result), true);
}

function acceptDocument(result: AnalyzerOperationResult) {
  recordOperation(result);
  if ("code" in result) assert.fail(result.code);
  return result.snapshot;
}

function refuseDocument(session: AnalyzerSession, action: () => AnalyzerOperationResult, code: string): void {
  const before = session.currentSnapshot;
  const result = action();
  recordOperation(result);
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  assert.equal(session.currentSnapshot, before);
}

function acceptGraph(result: AnalyzerGraphOperationResult): AnalyzerGraphSnapshot {
  recordOperation(result);
  if ("code" in result) assert.fail(result.code);
  return result.snapshot;
}

function refuseGraph(
  session: AnalyzerSession,
  action: () => AnalyzerGraphOperationResult,
  code: string,
): void {
  const beforeDocument = session.currentSnapshot;
  const beforeGraph = session.currentGraphSnapshot;
  assert.equal(beforeGraph, currentGraph);
  const result = action();
  recordOperation(result);
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  assert.equal(result.currentEpoch, beforeDocument.workspaceEpoch);
  assert.equal(result.currentGeneration, beforeGraph.generation);
  assert.equal(session.currentSnapshot, beforeDocument);
  assert.equal(session.currentGraphSnapshot, beforeGraph);
}

function digest(context: AnalyzerGraphComputeContext): string {
  return createHash("sha256")
    .update(context.owner.text)
    .update(JSON.stringify(context.dependencies.map(({ id, value }) => ({ id, value }))))
    .digest("hex");
}

function compute(id: string, artifact?: Readonly<{ id: string; path: string }>) {
  return (context: AnalyzerGraphComputeContext) => {
    const value = { id, digest: digest(context) };
    if (artifact) context.emitArtifact({ ...artifact, value });
    return value;
  };
}

try {
  cpSync(canonicalSource, new URL("./", pathToFileURL(`${root}/`)), { recursive: true });
  const paths = {
    root: join(root, "routes/layout.tsx"),
    admin: join(root, "routes/admin/layout.tsx"),
    page: join(root, "routes/admin/dashboard/page.tsx"),
    manifest: join(root, "server.ts"),
  } as const;
  const session = new AnalyzerSession(root);
  for (const path of Object.values(paths)) acceptDocument(session.open(path, 0, readFileSync(path, "utf8")));
  const documentPaths: Record<keyof typeof paths, string> = {
    root: "routes/layout.tsx",
    admin: "routes/admin/layout.tsx",
    page: "routes/admin/dashboard/page.tsx",
    manifest: "server.ts",
  };
  const uris = Object.fromEntries(Object.entries(documentPaths).map(([key, path]) => {
    const document = session.currentSnapshot.documents.find((candidate) => candidate.path === path);
    assert.ok(document, `missing analyzer owner ${path}`);
    return [key, document.uri];
  })) as Record<keyof typeof paths, string>;

  const computeRoot = compute("root", { id: "artifact:root-declaration", path: ".fadeno/root.d.ts" });
  const computeAdmin = compute("admin");
  const computePage = compute("page", { id: "artifact:dashboard-route", path: ".fadeno/dashboard.route.json" });
  const computeManifest = compute("manifest", { id: "artifact:route-manifest", path: ".fadeno/routes.manifest.json" });
  const definitions: readonly AnalyzerGraphNodeDefinition[] = [
    {
      id: "route:manifest", ownerUri: uris.manifest, definitionVersion: 1, dependencies: ["route:dashboard"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "manifest" }, compute: computeManifest,
    },
    {
      id: "route:dashboard", ownerUri: uris.page, definitionVersion: 1, dependencies: ["route:admin-layout"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "page" }, compute: computePage,
    },
    {
      id: "route:admin-layout", ownerUri: uris.admin, definitionVersion: 1, dependencies: ["route:root-layout"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "layout" }, compute: computeAdmin,
    },
    {
      id: "route:root-layout", ownerUri: uris.root, definitionVersion: 1, dependencies: [],
      module: { namespace: "fadeno.routes", version: 1, transformation: "layout" }, compute: computeRoot,
    },
  ];

  currentGraph = acceptGraph(session.analyzeGraph(definitions));
  assert.equal(session.currentGraphSnapshot, currentGraph);
  assert.deepEqual(currentGraph.requestedFacets, [{ namespace: "fadeno.graph" }]);
  assert.deepEqual(currentGraph.workOrder, ["route:root-layout", "route:admin-layout", "route:dashboard", "route:manifest"]);
  assert.equal(currentGraph.results.every(({ generation }) => generation === 1), true);
  assert.equal(currentGraph.results.find(({ id }) => id === "route:manifest")?.provenance.relatedOrigins.length, 3);
  assert.equal(currentGraph.results.find(({ id }) => id === "route:manifest")?.artifacts[0]?.provenance.artifactToSources.length, 4);
  assert.equal(Object.isFrozen(currentGraph.results[0]?.provenance.primaryOrigin.range), true);
  const initialDigests = new Map(currentGraph.results.map(({ id, value }) => [id, JSON.stringify(value)]));

  const rootDocument = session.currentSnapshot.documents.find(({ uri }) => uri === uris.root)!;
  const rootVersion = rootDocument.open!;
  acceptDocument(session.change(paths.root, rootVersion.lifetime, 1, [
    { start: rootDocument.effective.text.length, end: rootDocument.effective.text.length, text: "\n/* B3_EDIT */\n" },
  ]));
  const rootEdit = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = rootEdit;
  assert.deepEqual(rootEdit.affected, ["route:root-layout", "route:admin-layout", "route:dashboard", "route:manifest"]);
  assert.deepEqual(rootEdit.invalidations.map(({ nodeId, reasons }) => [nodeId, reasons]), [
    ["route:root-layout", [{ kind: "document", ownerUri: uris.root }]],
    ["route:admin-layout", [{ kind: "dependency", dependencyId: "route:root-layout" }]],
    ["route:dashboard", [{ kind: "dependency", dependencyId: "route:admin-layout" }]],
    ["route:manifest", [{ kind: "dependency", dependencyId: "route:dashboard" }]],
  ]);
  for (const result of rootEdit.results) {
    assert.equal(result.generation, 2);
    assert.notEqual(JSON.stringify(result.value), initialDigests.get(result.id), `${result.id} did not refresh`);
  }
  const rootEditSerialized = serializeAnalyzerGraphSnapshot(rootEdit);
  const rootEditRoundTrip = deserializeAnalyzerGraphSnapshot(rootEditSerialized);
  assert.deepEqual(rootEditRoundTrip, rootEdit);
  assert.equal(serializeAnalyzerGraphSnapshot(rootEditRoundTrip), rootEditSerialized);
  assert.equal(Object.isFrozen(rootEditRoundTrip.results[0]?.provenance.relatedOrigins), true);
  const malformedGraph = JSON.parse(rootEditSerialized) as {
    snapshot: { results: Array<{ artifacts: Array<{ provenance: { generatedArtifactOwnership: { ownerNodeId: string } } }> }> };
  };
  const resultWithArtifact = malformedGraph.snapshot.results.find(({ artifacts }) => artifacts.length > 0)!;
  resultWithArtifact.artifacts[0]!.provenance.generatedArtifactOwnership.ownerNodeId = "route:wrong-owner";
  assert.throws(
    () => deserializeAnalyzerGraphSnapshot(JSON.stringify(malformedGraph)),
    /FADENO_ANALYZER_GRAPH_SERIALIZATION/u,
  );
  const serializationMutations: readonly ((value: any) => void)[] = [
    (value) => { value.snapshot.invalidations[0].reasons[0].ownerUri = {}; },
    (value) => { value.snapshot.invalidations[1].reasons[0].dependencyId = {}; },
    (value) => { value.snapshot.invalidations[0].reasons = [{ kind: "definition", nodeId: {} }]; },
    (value) => { value.snapshot.affected[0] = "arbitrary"; value.snapshot.workOrder[0] = "arbitrary"; value.snapshot.invalidations[0].nodeId = "arbitrary"; },
    (value) => { value.snapshot.documentVersions[0].uri = "file:///outside.ts"; },
    (value) => { value.snapshot.documentVersions.reverse(); },
    (value) => { value.snapshot.ownership.root = "file:relative"; },
    (value) => { value.snapshot.operationId = `${value.snapshot.sessionId}:operation-${"9".repeat(40)}`; },
    (value) => { value.snapshot.results[0].provenance.primaryOrigin.uri = "file:///outside.ts"; },
    (value) => { value.snapshot.results.find((result: any) => result.artifacts.length > 0).provenance.sourceToArtifacts.pop(); },
    (value) => {
      const result = value.snapshot.results.find((candidate: any) => candidate.artifacts.length > 0);
      result.artifacts[0].provenance.module.transformation = "forged-transform";
    },
    (value) => {
      const affectedId = value.snapshot.affected[0];
      value.snapshot.results.find((result: any) => result.id === affectedId).generation -= 1;
    },
    (value) => { value.snapshot.invalidations[1].reasons[0].dependencyId = "route:manifest"; },
    (value) => { value.snapshot.invalidations[0].reasons = [{ kind: "initial", nodeId: value.snapshot.invalidations[0].nodeId }]; },
    (value) => { value.snapshot.results = Array.from({ length: ANALYZER_GRAPH_LIMITS.maximumNodes + 1 }, () => value.snapshot.results[0]); },
    (value) => {
      const result = value.snapshot.results.find((candidate: any) => candidate.artifacts.length > 0);
      result.artifacts = Array.from({ length: ANALYZER_GRAPH_LIMITS.maximumArtifacts + 1 }, () => result.artifacts[0]);
    },
  ];
  for (const mutate of serializationMutations) {
    const invalid = JSON.parse(rootEditSerialized);
    mutate(invalid);
    assert.throws(
      () => deserializeAnalyzerGraphSnapshot(JSON.stringify(invalid)),
      /FADENO_ANALYZER_GRAPH_SERIALIZATION/u,
    );
  }

  const pageDocument = session.currentSnapshot.documents.find(({ uri }) => uri === uris.page)!;
  acceptDocument(session.change(paths.page, pageDocument.open!.lifetime, 1, [
    { start: pageDocument.effective.text.length, end: pageDocument.effective.text.length, text: "\n/* PAGE_EDIT */\n" },
  ]));
  const directEdit = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = directEdit;
  assert.deepEqual(directEdit.affected, ["route:dashboard", "route:manifest"]);
  assert.equal(directEdit.results.find(({ id }) => id === "route:root-layout")?.generation, 2);
  assert.equal(directEdit.results.find(({ id }) => id === "route:admin-layout")?.generation, 2);
  assert.equal(directEdit.results.find(({ id }) => id === "route:dashboard")?.generation, 3);

  const documentVersionsBeforeConfiguration = session.currentSnapshot.documentVersions;
  refuseDocument(session, () => session.reloadConfiguration("invalid"), "FADENO_ANALYZER_CONFIGURATION_IDENTITY");
  acceptDocument(session.reloadConfiguration("a".repeat(64)));
  assert.deepEqual(session.currentSnapshot.documentVersions, documentVersionsBeforeConfiguration);
  const configured = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = configured;
  assert.equal(configured.configurationEpoch, 1);
  assert.equal(configured.ownership.configurationFingerprint, "a".repeat(64));
  assert.equal(configured.invalidations.every(({ reasons }) => reasons.some(({ kind }) => kind === "configuration")), true);
  const epochBeforeRepeatedConfiguration = session.currentSnapshot.workspaceEpoch;
  acceptDocument(session.reloadConfiguration("a".repeat(64)));
  assert.equal(session.currentSnapshot.workspaceEpoch, epochBeforeRepeatedConfiguration + 1);
  const repeatedConfiguration = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = repeatedConfiguration;
  assert.equal(repeatedConfiguration.configurationEpoch, 2);
  assert.equal(repeatedConfiguration.invalidations.every(({ reasons }) => reasons.some(({ kind }) => kind === "configuration")), true);
  const noOp = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = noOp;
  assert.deepEqual(noOp.affected, []);
  assert.deepEqual(noOp.workOrder, []);
  assert.equal(Object.isFrozen(noOp), true);
  assert.equal(Object.isFrozen(noOp.results), true);
  assert.equal(Object.isFrozen(noOp.results[0]?.value), true);
  const freshEquivalentDefinitions = definitions.map((definition) => ({
    ...definition,
    compute: compute(
      definition.id === "route:root-layout" ? "root"
        : definition.id === "route:admin-layout" ? "admin"
          : definition.id === "route:dashboard" ? "page" : "manifest",
      definition.id === "route:root-layout"
        ? { id: "artifact:root-declaration", path: ".fadeno/root.d.ts" }
        : definition.id === "route:dashboard"
          ? { id: "artifact:dashboard-route", path: ".fadeno/dashboard.route.json" }
          : definition.id === "route:manifest"
            ? { id: "artifact:route-manifest", path: ".fadeno/routes.manifest.json" }
            : undefined,
    ),
  }));
  const allocationIndependent = acceptGraph(session.analyzeGraph(freshEquivalentDefinitions));
  currentGraph = allocationIndependent;
  assert.deepEqual(allocationIndependent.affected, [], "callback allocation changed graph identity");
  currentGraph = acceptGraph(session.analyzeGraph(definitions));
  assert.deepEqual(currentGraph.affected, []);

  const movedArtifactDefinitions = definitions.map((definition) => definition.id === "route:dashboard"
    ? {
      ...definition,
      definitionVersion: 2,
      compute: compute("page", { id: "artifact:dashboard-route", path: ".fadeno/dashboard-v2.route.json" }),
    }
    : definition);
  const movedArtifact = acceptGraph(session.analyzeGraph(movedArtifactDefinitions));
  currentGraph = movedArtifact;
  assert.deepEqual(movedArtifact.removedArtifacts, [{
    id: "artifact:dashboard-route", path: ".fadeno/dashboard.route.json", ownerNodeId: "route:dashboard",
  }]);
  const restoredArtifact = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = restoredArtifact;
  assert.deepEqual(restoredArtifact.removedArtifacts, [{
    id: "artifact:dashboard-route", path: ".fadeno/dashboard-v2.route.json", ownerNodeId: "route:dashboard",
  }]);

  const cyclic = definitions.map((definition) => definition.id === "route:root-layout"
    ? { ...definition, definitionVersion: 2, dependencies: ["route:manifest"] }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(cyclic), "FADENO_ANALYZER_GRAPH_CYCLE");
  const brokenCompute = definitions.map((definition) => definition.id === "route:dashboard"
    ? { ...definition, definitionVersion: 2, compute: () => { throw new Error("refuse"); } }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(brokenCompute), "FADENO_ANALYZER_GRAPH_COMPUTE");
  const invalidValue = definitions.map((definition) => definition.id === "route:dashboard"
    ? { ...definition, definitionVersion: 2, compute: () => Number.NaN }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(invalidValue), "FADENO_ANALYZER_GRAPH_VALUE");
  const unknownOwner = definitions.map((definition) => definition.id === "route:root-layout"
    ? { ...definition, definitionVersion: 2, ownerUri: "file:///outside.ts" }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(unknownOwner), "FADENO_ANALYZER_GRAPH_OWNER");
  const unknownDependency = definitions.map((definition) => definition.id === "route:manifest"
    ? { ...definition, definitionVersion: 2, dependencies: ["route:missing"] }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(unknownDependency), "FADENO_ANALYZER_GRAPH_DEPENDENCY");
  refuseGraph(session, () => session.analyzeGraph([definitions[0]!, definitions[0]!]), "FADENO_ANALYZER_GRAPH_DUPLICATE");
  refuseGraph(
    session,
    () => session.analyzeGraph([null as unknown as AnalyzerGraphNodeDefinition]),
    "FADENO_ANALYZER_GRAPH_DEFINITION",
  );
  refuseGraph(
    session,
    () => session.analyzeGraph(Array.from({ length: ANALYZER_GRAPH_LIMITS.maximumNodes + 1 }, () => definitions[0]!)),
    "FADENO_ANALYZER_GRAPH_LIMIT",
  );
  const excessiveDependencies = definitions.map((definition) => definition.id === "route:root-layout"
    ? {
      ...definition,
      definitionVersion: 2,
      dependencies: Array.from({ length: ANALYZER_GRAPH_LIMITS.maximumDependenciesPerNode + 1 }, () => "route:admin-layout"),
    }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(excessiveDependencies), "FADENO_ANALYZER_GRAPH_LIMIT");
  const invalidArtifact = definitions.map((definition) => definition.id === "route:root-layout"
    ? {
      ...definition,
      definitionVersion: 2,
      compute: (context: AnalyzerGraphComputeContext) => {
        context.emitArtifact({ id: "artifact:escape", path: "../escape", value: null });
        return null;
      },
    }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(invalidArtifact), "FADENO_ANALYZER_GRAPH_ARTIFACT");
  const collidingArtifact = definitions.map((definition) => definition.id === "route:root-layout"
    ? {
      ...definition,
      definitionVersion: 2,
      compute: (context: AnalyzerGraphComputeContext) => {
        context.emitArtifact({ id: "artifact:collision", path: ".fadeno/routes.manifest.json", value: null });
        return null;
      },
    }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(collidingArtifact), "FADENO_ANALYZER_GRAPH_ARTIFACT");
  const excessiveArtifacts = definitions.map((definition) => definition.id === "route:root-layout"
    ? {
      ...definition,
      definitionVersion: 2,
      compute: (context: AnalyzerGraphComputeContext) => {
        for (let index = 0; index <= ANALYZER_GRAPH_LIMITS.maximumArtifacts; index += 1) {
          context.emitArtifact({ id: `artifact:item-${index}`, path: `.fadeno/item-${index}.json`, value: null });
        }
        return null;
      },
    }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(excessiveArtifacts), "FADENO_ANALYZER_GRAPH_LIMIT");

  const latestRoot = session.currentSnapshot.documents.find(({ uri }) => uri === uris.root)!;
  acceptDocument(session.change(paths.root, latestRoot.open!.lifetime, 2, [
    { start: latestRoot.effective.text.length, end: latestRoot.effective.text.length, text: "\n/* FINAL_NODE_ROLLBACK */\n" },
  ]));
  const failAtFinalNode = definitions.map((definition) => definition.id === "route:manifest"
    ? { ...definition, definitionVersion: 2, compute: () => { throw new Error("final-node-refusal"); } }
    : definition);
  refuseGraph(session, () => session.analyzeGraph(failAtFinalNode), "FADENO_ANALYZER_GRAPH_COMPUTE");
  const recoveredAfterFinalFailure = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = recoveredAfterFinalFailure;
  assert.deepEqual(recoveredAfterFinalFailure.affected, [
    "route:root-layout", "route:admin-layout", "route:dashboard", "route:manifest",
  ]);

  const obsoletePath = join(root, "routes/obsolete/page.tsx");
  mkdirSync(join(root, "routes/obsolete"));
  cpSync(paths.page, obsoletePath);
  acceptDocument(session.open(obsoletePath, 0, readFileSync(obsoletePath, "utf8")));
  const obsoleteUri = session.currentSnapshot.documents.find(({ path }) => path === "routes/obsolete/page.tsx")!.uri;
  const obsoleteDefinition: AnalyzerGraphNodeDefinition = {
    id: "route:obsolete", ownerUri: obsoleteUri, definitionVersion: 1, dependencies: ["route:admin-layout"],
    module: { namespace: "fadeno.routes", version: 1, transformation: "page" },
    compute: compute("obsolete", { id: "artifact:obsolete-route", path: ".fadeno/obsolete.route.json" }),
  };
  currentGraph = acceptGraph(session.analyzeGraph([...definitions, obsoleteDefinition]));
  acceptDocument(session.close(obsoletePath, 1, 0));
  rmSync(obsoletePath);
  acceptDocument(session.remove(obsoletePath));
  const deletedOwner = acceptGraph(session.analyzeGraph(definitions));
  currentGraph = deletedOwner;
  assert.deepEqual(deletedOwner.removedNodes, [{
    nodeId: "route:obsolete", ownerUri: obsoleteUri, reason: "owner-disappeared",
  }]);
  assert.deepEqual(deletedOwner.removedArtifacts, [{
    id: "artifact:obsolete-route", path: ".fadeno/obsolete.route.json", ownerNodeId: "route:obsolete",
  }]);

  const withoutManifest = definitions.filter(({ id }) => id !== "route:manifest");
  const manifestRemoved = acceptGraph(session.analyzeGraph(withoutManifest));
  currentGraph = manifestRemoved;
  assert.deepEqual(manifestRemoved.removedNodes, [{
    nodeId: "route:manifest", ownerUri: uris.manifest, reason: "definition-removed",
  }]);
  assert.deepEqual(manifestRemoved.removedArtifacts, [{
    id: "artifact:route-manifest", path: ".fadeno/routes.manifest.json", ownerNodeId: "route:manifest",
  }]);
  assert.equal(manifestRemoved.results.some(({ id }) => id === "route:manifest"), false);

  acceptDocument(session.close(paths.page, pageDocument.open!.lifetime, 1));
  refuseDocument(session, () => session.remove(paths.page), "FADENO_ANALYZER_DOCUMENT_EXISTS");
  refuseDocument(session, () => session.remove(join(root, "routes/missing.ts")), "FADENO_ANALYZER_DOCUMENT_UNKNOWN");
  const renamedPath = join(root, "routes/admin/overview/page.tsx");
  mkdirSync(join(root, "routes/admin/overview"));
  renameSync(paths.page, renamedPath);
  acceptDocument(session.remove(paths.page));
  acceptDocument(session.open(renamedPath, 0, readFileSync(renamedPath, "utf8")));
  const overviewUri = session.currentSnapshot.documents.find(({ path }) => path === "routes/admin/overview/page.tsx")!.uri;
  const computeOverview = compute("overview", { id: "artifact:overview-route", path: ".fadeno/overview.route.json" });
  const renamedDefinitions: readonly AnalyzerGraphNodeDefinition[] = [
    definitions[3]!,
    definitions[2]!,
    {
      id: "route:overview", ownerUri: overviewUri, definitionVersion: 1, dependencies: ["route:admin-layout"],
      module: { namespace: "fadeno.routes", version: 1, transformation: "page" }, compute: computeOverview,
    },
  ];
  const renamed = acceptGraph(session.analyzeGraph(renamedDefinitions));
  currentGraph = renamed;
  assert.deepEqual(renamed.removedNodes, [{
    nodeId: "route:dashboard", ownerUri: uris.page, reason: "owner-disappeared",
  }]);
  assert.deepEqual(renamed.removedArtifacts, [{
    id: "artifact:dashboard-route", path: ".fadeno/dashboard.route.json", ownerNodeId: "route:dashboard",
  }]);
  assert.equal(renamed.results.some(({ id }) => id === "route:dashboard"), false);
  assert.equal(renamed.results.find(({ id }) => id === "route:overview")?.provenance.primaryOrigin.uri, overviewUri);
  assert.equal(session.currentSnapshot.documents.some(({ uri }) => uri === uris.page), false);
  const renamedRoundTrip = deserializeAnalyzerGraphSnapshot(serializeAnalyzerGraphSnapshot(renamed));
  assert.deepEqual(renamedRoundTrip.removedNodes, renamed.removedNodes);
  assert.deepEqual(renamedRoundTrip.removedArtifacts, renamed.removedArtifacts);
  const invalidRemovedOwner = JSON.parse(serializeAnalyzerGraphSnapshot(renamed)) as any;
  invalidRemovedOwner.snapshot.removedArtifacts[0].ownerNodeId = "route:ghost";
  assert.throws(
    () => deserializeAnalyzerGraphSnapshot(JSON.stringify(invalidRemovedOwner)),
    /FADENO_ANALYZER_GRAPH_SERIALIZATION/u,
  );

  const normalizedUris = new Map(Object.entries(uris).map(([key, uri]) => [uri, documentPaths[key as keyof typeof documentPaths]]));
  normalizedUris.set(overviewUri, "routes/admin/overview/page.tsx");
  normalizedUris.set(obsoleteUri, "routes/obsolete/page.tsx");
  const normalizeUri = (uri: string) => normalizedUris.get(uri) ?? "<unknown>";
  const fixture = {
    affected: rootEdit.affected,
    workOrder: rootEdit.workOrder,
    invalidations: rootEdit.invalidations.map(({ nodeId, reasons }) => ({
      nodeId,
      reasons: reasons.map((reason) => reason.kind === "document" ? { ...reason, ownerUri: normalizeUri(reason.ownerUri) } : reason),
    })),
    provenance: rootEdit.results.map(({ id, provenance, artifacts }) => ({
      id,
      primary: normalizeUri(provenance.primaryOrigin.uri),
      related: provenance.relatedOrigins.map(({ uri }) => normalizeUri(uri)),
      module: provenance.module,
      nodeSourceToArtifact: provenance.sourceToArtifacts.map(({ sourceUri, artifactId }) => ({
        source: normalizeUri(sourceUri), artifactId,
      })),
      nodeArtifactToSource: provenance.artifactToSources.map(({ artifactId, sourceUri }) => ({
        artifactId, source: normalizeUri(sourceUri),
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        owner: artifact.provenance.generatedArtifactOwnership?.ownerNodeId,
        sourceToArtifact: artifact.provenance.sourceToArtifacts.map(({ sourceUri }) => normalizeUri(sourceUri)),
        artifactToSource: artifact.provenance.artifactToSources.map(({ sourceUri }) => normalizeUri(sourceUri)),
      })),
    })),
    cleanup: {
      deleted: {
        nodes: deletedOwner.removedNodes.map((node) => ({ ...node, ownerUri: normalizeUri(node.ownerUri) })),
        artifacts: deletedOwner.removedArtifacts,
      },
      definitionRemoved: {
        nodes: manifestRemoved.removedNodes.map((node) => ({ ...node, ownerUri: normalizeUri(node.ownerUri) })),
        artifacts: manifestRemoved.removedArtifacts,
      },
      renamed: {
        nodes: renamed.removedNodes.map((node) => ({ ...node, ownerUri: normalizeUri(node.ownerUri) })),
        artifacts: renamed.removedArtifacts,
      },
    },
  };
  const expected = JSON.parse(readFileSync(new URL("../fixtures/v1-analyzer/recomputation.normalized.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, expected);
  assert.ok(operationIds.size >= 15);
  console.log("V1 analyzer B3 passed (closure, recomputation, config, cycles, cleanup, construction provenance)");
} finally {
  rmSync(root, { recursive: true, force: true });
}
