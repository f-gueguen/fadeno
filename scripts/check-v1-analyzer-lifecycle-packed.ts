import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AnalyzerDiagnosticBatch } from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import type {
  PrivateProjectDocumentEvent,
  PrivateProjectDocumentResult,
} from "../packages/framework/src/internal/analyzer-project.ts";

type AnalyzerProjectModule = typeof import("../packages/framework/src/internal/analyzer-project.ts");
type AnalyzerDiagnosticsModule = typeof import("../packages/framework/src/internal/analyzer-diagnostics.ts");
type FileIdentity = readonly Readonly<{ path: string; sha256: string }>[];

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const fixtureRoot = join(root, "fixtures/v1-analyzer");
const packageName = "fadeno-framework-internal";

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_PACKED_LIFECYCLE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function treeIdentity(directory: string): FileIdentity {
  const files: { path: string; sha256: string }[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(directory, path).split("\\").join("/"),
        sha256: sha256(readFileSync(path)),
      });
      else throw new TypeError("FADENO_PACKED_LIFECYCLE_IDENTITY_ENTRY");
    }
  };
  visit(directory);
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

function assertIdentity(actual: FileIdentity, expected: FileIdentity, code: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(code);
}

function parserDirectories(packageDirectory: string): Readonly<{ parser: string; executable: string }> {
  const require = createRequire(join(realpathSync(packageDirectory), "package.json"));
  const parser = dirname(require.resolve("typescript/package.json"));
  const parserRequire = createRequire(join(parser, "package.json"));
  const executable = dirname(parserRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`));
  return Object.freeze({ parser, executable });
}

function detachedWrite(path: string, bytes: Buffer | string): void {
  rmSync(path);
  writeFileSync(path, bytes);
}

function operationSuffix(value: string): string {
  const match = /:operation-([1-9][0-9]*)$/u.exec(value);
  if (!match) throw new TypeError(`FADENO_PACKED_LIFECYCLE_OPERATION_ID:${value}`);
  return `operation-${match[1]}`;
}

function requestSuffix(value: string): string {
  const match = /:request-([1-9][0-9]*)$/u.exec(value);
  if (!match) throw new TypeError(`FADENO_PACKED_LIFECYCLE_REQUEST_ID:${value}`);
  return `request-${match[1]}`;
}

function diagnosticSuffix(value: string, operationId: string): string {
  const prefix = `${operationId}:`;
  if (!value.startsWith(prefix) || !/^diagnostic-[1-9][0-9]*$/u.test(value.slice(prefix.length))) {
    throw new TypeError(`FADENO_PACKED_LIFECYCLE_DIAGNOSTIC_ID:${value}`);
  }
  return value.slice(prefix.length);
}

function normalizeLocation(location: AnalyzerDiagnosticBatch["diagnostics"][number]["primaryLocation"]) {
  return {
    path: location.path,
    range: location.range,
    rangeReason: location.rangeReason,
  };
}

function normalizeBatch(batch: AnalyzerDiagnosticBatch) {
  const normalizeInstance = (value: string): string => diagnosticSuffix(value, batch.identity.operationId);
  return {
    namespace: batch.namespace,
    version: batch.version,
    identity: {
      workspaceEpoch: batch.identity.workspaceEpoch,
      configurationEpoch: batch.identity.configurationEpoch,
      operationId: operationSuffix(batch.identity.operationId),
      documentVersions: batch.identity.documentVersions.map(({ uri, version, lifetime }) => ({
        path: batch.identity.documents.find((document) => document.uri === uri)?.path,
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
      primaryLocation: normalizeLocation(diagnostic.primaryLocation),
      relatedLocations: diagnostic.relatedLocations.map(normalizeLocation),
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
      edits: correction.edits.map(({ path, version, lifetime, range, expectedText, text }) => ({
        path,
        version,
        lifetime,
        range,
        expectedText,
        text,
      })),
      applicabilityMatchesBatch: JSON.stringify(correction.applicability) === JSON.stringify(batch.identity),
    })),
    skippedWork: batch.skippedWork.map(({ id, causedBy }) => ({ id, causedBy: causedBy.map(normalizeInstance) })),
    completeness: batch.completeness,
    redaction: batch.redaction,
    truncated: batch.truncated,
  };
}

function uriPath(event: PrivateProjectDocumentEvent, uri: string): string {
  const document = event.documentSnapshot.documents.find((candidate) => candidate.uri === uri);
  if (!document) throw new TypeError(`FADENO_PACKED_LIFECYCLE_URI:${uri}`);
  return document.path;
}

function normalizeArtifacts(event: PrivateProjectDocumentEvent) {
  const artifacts = event.publication.artifacts.map((artifact) => ({
    id: artifact.id,
    path: artifact.path,
    ownerNodeId: artifact.ownerNodeId,
    module: artifact.provenance.module,
    generatedOwnership: artifact.provenance.generatedArtifactOwnership,
    primaryOrigin: {
      path: uriPath(event, artifact.provenance.primaryOrigin.uri),
      range: artifact.provenance.primaryOrigin.range,
    },
    relationCounts: {
      relatedOrigins: artifact.provenance.relatedOrigins.length,
      sourceToArtifacts: artifact.provenance.sourceToArtifacts.length,
      artifactToSources: artifact.provenance.artifactToSources.length,
    },
  }));
  const representative = event.publication.artifacts.find(({ id }) => id === "generated:routes-manifest-json");
  assert.ok(representative);
  return {
    artifacts,
    representativeRelations: {
      artifactId: representative.id,
      relatedOrigins: representative.provenance.relatedOrigins.map((origin) => ({
      path: uriPath(event, origin.uri),
      range: origin.range,
      })),
      sourceToArtifacts: representative.provenance.sourceToArtifacts.map(({ sourceUri, artifactId }) => ({
        sourcePath: uriPath(event, sourceUri),
        artifactId,
      })),
      artifactToSources: representative.provenance.artifactToSources.map(({ artifactId, sourceUri }) => ({
        artifactId,
        sourcePath: uriPath(event, sourceUri),
      })),
    },
  };
}

function normalizeEvent(event: PrivateProjectDocumentEvent) {
  assert.equal(event.publication.workspaceEpoch, event.workspaceEpoch);
  assert.deepEqual(event.requestedFacets, event.publication.requestedFacets);
  assert.equal(event.completeness, event.publication.completeness);
  assert.equal(event.interruption, event.publication.interruption);
  assert.equal(event.truncated, event.publication.truncated);
  return {
    operationId: event.operationId,
    documentOperationId: operationSuffix(event.documentOperationId),
    requestId: requestSuffix(event.requestId),
    operation: event.operation,
    documentVersion: event.documentVersion,
    documentLifetime: event.documentLifetime,
    workspaceEpoch: event.workspaceEpoch,
    input: event.input,
    document: {
      path: event.document.path,
      savedRevision: event.document.savedRevision,
      open: event.document.open ? {
        version: event.document.open.version,
        lifetime: event.document.open.lifetime,
      } : null,
      effectiveSource: event.document.effective.source,
      effectiveText: event.document.effective.text,
    },
    publication: {
      analyzerVersion: event.publication.analyzerVersion,
      schemaVersion: event.publication.schemaVersion,
      operationId: operationSuffix(event.publication.operationId),
      operation: event.publication.operation,
      workspaceEpoch: event.publication.workspaceEpoch,
      configurationEpoch: event.publication.configurationEpoch,
      generation: event.publication.publicationGeneration,
      requestedFacets: event.publication.requestedFacets,
      artifacts: event.publication.artifacts.map(({ id, path, ownerNodeId }) => ({
        id,
        path,
        ownerNodeId,
      })),
      removedArtifacts: event.publication.removedArtifacts,
      completeness: event.publication.completeness,
      interruption: event.publication.interruption,
      truncated: event.publication.truncated,
    },
  };
}

async function receive(result: PrivateProjectDocumentResult): Promise<PrivateProjectDocumentEvent> {
  if ("code" in result) throw new TypeError(`FADENO_PACKED_LIFECYCLE_REFUSED:${result.code}`);
  assert.equal(result.accepted, true);
  const event = await result.event.result;
  assert.equal(result.event.requestId, event.requestId);
  assert.equal(result.operationId, event.operationId);
  assert.equal(result.documentOperationId, event.documentOperationId);
  const transitioned = result.transitionSnapshot.documents.find(({ path }) => path === event.document.path);
  assert.ok(transitioned);
  assert.equal(transitioned.effective.text, event.document.effective.text);
  assert.equal(transitioned.open?.version ?? null, event.document.open?.version ?? null);
  assert.equal(transitioned.open?.lifetime ?? null, event.document.open?.lifetime ?? null);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.publication), true);
  return event;
}

function assertFixture(name: string, actual: unknown): void {
  const expected = JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as unknown;
  assert.deepEqual(actual, expected, name);
}

function assertTextFixture(name: string, actual: string): void {
  assert.equal(actual, readFileSync(join(fixtureRoot, name), "utf8"), name);
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-v1-packed-lifecycle-"));
let projections: Readonly<Record<string, unknown>> | null = null;
let diagnosticHuman = "";
let analyzerClosed = false;
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const builtParserDirectories = parserDirectories(packageRoot);
  const builtParserIdentity = Object.freeze({
    parser: treeIdentity(builtParserDirectories.parser),
    executable: treeIdentity(builtParserDirectories.executable),
  });

  const tarballs = join(temporary, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new TypeError("FADENO_PACKED_LIFECYCLE_TARBALL");
  const tarball = join(tarballs, tarballName);

  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", tarball, "-C", extracted], temporary);
  const expectedPackageIdentity = treeIdentity(join(extracted, "package"));

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: "fadeno-packed-lifecycle-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${tarball}` },
  }, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  const installedPackage = join(consumer, "node_modules", packageName);
  assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_LIFECYCLE_PACKAGE_STALE");

  const installedParserDirectories = parserDirectories(installedPackage);
  assertIdentity(treeIdentity(installedParserDirectories.parser), builtParserIdentity.parser, "FADENO_PACKED_LIFECYCLE_PARSER_STALE");
  assertIdentity(treeIdentity(installedParserDirectories.executable), builtParserIdentity.executable, "FADENO_PACKED_LIFECYCLE_EXECUTABLE_STALE");

  const analyzerPath = join(installedPackage, "dist/internal/analyzer-project.js");
  const analyzerBytes = readFileSync(analyzerPath);
  rmSync(analyzerPath);
  assert.throws(
    () => assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_LIFECYCLE_PACKAGE_STALE"),
    /FADENO_PACKED_LIFECYCLE_PACKAGE_STALE/u,
  );
  writeFileSync(analyzerPath, analyzerBytes);
  const extraPath = join(installedPackage, "dist/internal/c2-extra-canary.js");
  writeFileSync(extraPath, "export {};\n");
  assert.throws(
    () => assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_LIFECYCLE_PACKAGE_STALE"),
    /FADENO_PACKED_LIFECYCLE_PACKAGE_STALE/u,
  );
  rmSync(extraPath);
  detachedWrite(analyzerPath, `${analyzerBytes.toString("utf8")}\n// stale analyzer canary\n`);
  assert.throws(
    () => assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_LIFECYCLE_PACKAGE_STALE"),
    /FADENO_PACKED_LIFECYCLE_PACKAGE_STALE/u,
  );
  detachedWrite(analyzerPath, analyzerBytes);
  assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_LIFECYCLE_PACKAGE_STALE");

  const mutatedParser = join(temporary, "mutated-parser");
  cpSync(installedParserDirectories.parser, mutatedParser, { recursive: true });
  const parserEntry = join(mutatedParser, "dist/ast/index.js");
  detachedWrite(parserEntry, `${readFileSync(parserEntry, "utf8")}\n// stale parser canary\n`);
  assert.throws(
    () => assertIdentity(treeIdentity(mutatedParser), builtParserIdentity.parser, "FADENO_PACKED_LIFECYCLE_PARSER_STALE"),
    /FADENO_PACKED_LIFECYCLE_PARSER_STALE/u,
  );
  assertIdentity(treeIdentity(installedParserDirectories.parser), builtParserIdentity.parser, "FADENO_PACKED_LIFECYCLE_PARSER_STALE");

  const analyzerModule = await import(pathToFileURL(analyzerPath).href) as AnalyzerProjectModule;
  const diagnosticsPath = join(installedPackage, "dist/internal/analyzer-diagnostics.js");
  const diagnosticsModule = await import(pathToFileURL(diagnosticsPath).href) as AnalyzerDiagnosticsModule;

  const application = join(consumer, "app");
  cpSync(join(root, "examples/v1-app/src"), join(application, "src"), { recursive: true });
  const collisionRoot = join(application, "src/collision");
  mkdirSync(collisionRoot, { recursive: true });
  cpSync(join(root, "examples/v1-app/scenarios/route-role-collision/before/src/routes/page.tsx"), join(collisionRoot, "page.tsx"));
  cpSync(join(root, "examples/v1-app/scenarios/route-role-collision/before/src/routes/handler.ts"), join(collisionRoot, "handler.ts"));
  const configPath = join(application, "fadeno.config.ts");
  const savedConfig = "// café 😀\r\nexport default { routes: { root: 'src/routes' } };\r\n";
  writeFileSync(configPath, savedConfig);

  const analyzer = new analyzerModule.PrivateProjectAnalyzer(application);
  const initialized = await analyzer.analyze().result;
  assert.equal(initialized.input, "saved");
  assert.equal(initialized.diagnostics.diagnostics.length, 0);
  assert.equal(existsSync(join(application, ".fadeno")), false);
  assert.equal(existsSync(join(application, "dist")), false);

  const open = await receive(analyzer.document({
    kind: "open",
    workspaceRoots: [application],
    document: configPath,
    version: 1,
    text: savedConfig,
  }));
  assert.equal(open.publication.publicationGeneration, initialized.publication.publicationGeneration + 1);

  const prefix = "/* overlay */";
  const afterFirstEdit = `${prefix}${savedConfig}`;
  const routeLiteral = "'src/routes'";
  const routeStart = afterFirstEdit.indexOf(routeLiteral);
  assert.notEqual(routeStart, -1);
  const changedText = `${afterFirstEdit.slice(0, routeStart)}"src/routes"${afterFirstEdit.slice(routeStart + routeLiteral.length)}`;
  assert.notEqual(changedText, afterFirstEdit);
  const changed = await receive(analyzer.document({
    kind: "change",
    workspaceRoots: [application],
    document: configPath,
    lifetime: 1,
    version: 2,
    edits: [
      { start: 0, end: 0, text: prefix },
      { start: routeStart, end: routeStart + routeLiteral.length, text: '"src/routes"' },
    ],
  }));
  assert.equal(changed.publication.publicationGeneration, open.publication.publicationGeneration + 1);
  assert.equal(changed.document.effective.text, changedText);
  assert.equal(changed.document.effective.text.includes('root: "src/routes"'), true);
  assert.equal(changed.document.effective.text.includes("\r\n"), true);
  assert.equal(changed.document.effective.text.includes("café 😀"), true);
  assert.equal(changed.diagnostics.diagnostics.length, 0);
  assert.equal(readFileSync(configPath, "utf8"), savedConfig);

  const collisionConfig = "// collision café 😀\r\nexport default { routes: { root: 'src/collision' } };\r\n";
  const failed = await receive(analyzer.document({
    kind: "replace",
    workspaceRoots: [application],
    document: configPath,
    lifetime: 1,
    version: 3,
    text: collisionConfig,
  }));
  assert.equal(failed.publication.publicationGeneration, changed.publication.publicationGeneration + 1);
  assert.equal(failed.routePlan, null);
  assert.deepEqual(failed.diagnostics.diagnostics.map(({ code }) => code), [
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
  ]);
  assert.deepEqual(failed.diagnostics.corrections.map(({ fixId, safety, preferred, edits }) => ({
    fixId,
    safety,
    preferred,
    edits: edits.length,
  })), [{
    fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION",
    safety: "review",
    preferred: false,
    edits: 0,
  }]);
  const transportedFailure = diagnosticsModule.deserializeAnalyzerDiagnosticBatch(
    diagnosticsModule.serializeAnalyzerDiagnosticBatch(failed.diagnostics),
  );
  assert.deepEqual(transportedFailure, failed.diagnostics);
  diagnosticHuman = diagnosticsModule.formatAnalyzerDiagnosticBatchHuman(transportedFailure);

  const recovered = await receive(analyzer.document({
    kind: "replace",
    workspaceRoots: [application],
    document: configPath,
    lifetime: 1,
    version: 4,
    text: savedConfig,
  }));
  assert.equal(recovered.publication.publicationGeneration, failed.publication.publicationGeneration + 1);
  assert.equal(recovered.diagnostics.diagnostics.length, 0);
  assert.equal(recovered.diagnostics.corrections.length, 0);
  assert.equal(recovered.diagnostics.skippedWork.length, 0);
  const failedInstanceIds = failed.diagnostics.diagnostics.map(({ instanceId }) => instanceId);
  assert.equal(recovered.diagnostics.diagnostics.some(({ instanceId }) => failedInstanceIds.includes(instanceId)), false);
  assert.ok(recovered.routePlan);
  assert.equal(readFileSync(configPath, "utf8"), savedConfig);

  const closed = await receive(analyzer.document({
    kind: "close",
    workspaceRoots: [application],
    document: configPath,
    lifetime: 1,
    version: 4,
  }));
  assert.equal(closed.publication.publicationGeneration, recovered.publication.publicationGeneration + 1);
  assert.equal(closed.document.open, null);
  assert.equal(closed.document.effective.source, "saved");
  const reopened = await receive(analyzer.document({
    kind: "open",
    workspaceRoots: [application],
    document: pathToFileURL(configPath).href,
    version: 0,
    text: savedConfig,
  }));
  assert.equal(reopened.publication.publicationGeneration, closed.publication.publicationGeneration + 1);
  assert.equal(reopened.document.open?.lifetime, 2);
  const finalClose = await receive(analyzer.document({
    kind: "close",
    workspaceRoots: [application],
    document: configPath,
    lifetime: 2,
    version: 0,
  }));
  assert.equal(finalClose.publication.publicationGeneration, reopened.publication.publicationGeneration + 1);
  assert.equal(finalClose.document.open, null);
  assert.equal(existsSync(join(application, ".fadeno")), false);
  assert.equal(existsSync(join(application, "dist")), false);
  await analyzer.close();
  analyzerClosed = true;

  const normalizedFailure = normalizeBatch(transportedFailure);
  projections = Object.freeze({
    success: {
      event: normalizeEvent(changed),
      artifactOwnership: normalizeArtifacts(changed),
      analyzerTextEqualsDeclaredText: changed.document.effective.text === changedText,
      diskTextUnchanged: readFileSync(configPath, "utf8") === savedConfig,
      diagnostics: normalizeBatch(changed.diagnostics),
    },
    failure: normalizedFailure,
    correction: normalizedFailure.corrections,
    flow: {
      event: normalizeEvent(failed),
      outcome: {
        routePlan: failed.routePlan,
        diagnosticCodes: normalizedFailure.diagnostics.map(({ code }) => code),
        removedArtifacts: failed.publication.removedArtifacts,
      },
      causes: normalizedFailure.diagnostics.map(({ instanceId, code, causedBy }) => ({ instanceId, code, causedBy })),
      ownership: normalizedFailure.diagnostics.map(({ instanceId, primaryLocation, relatedLocations }) => ({
        instanceId,
        primaryLocation,
        relatedLocations,
      })),
      skippedWork: normalizedFailure.skippedWork,
    },
    recovery: {
      event: normalizeEvent(recovered),
      priorDiagnosticInstanceIds: failedInstanceIds.map((instanceId) => diagnosticSuffix(instanceId, failed.diagnostics.identity.operationId)),
      diagnostics: normalizeBatch(recovered.diagnostics),
      staleDiagnosticInstancesPresent: false,
      routeArtifactsRestored: recovered.publication.artifacts.length > 0,
      diskTextUnchanged: readFileSync(configPath, "utf8") === savedConfig,
    },
    cleanup: {
      firstClose: normalizeEvent(closed),
      reopen: normalizeEvent(reopened),
      finalClose: normalizeEvent(finalClose),
      analyzerClosed,
      generatedDirectoryExists: existsSync(join(application, ".fadeno")),
      distributionDirectoryExists: existsSync(join(application, "dist")),
      disposableConsumerRemoved: true,
    },
  });
} finally {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}

assert.ok(projections);
assert.equal(analyzerClosed, true);
assert.equal(existsSync(temporary), false);

assertFixture("lifecycle-success.normalized.json", projections["success"]);
assertFixture("lifecycle-failure.normalized.json", projections["failure"]);
assertFixture("lifecycle-correction.normalized.json", projections["correction"]);
assertFixture("lifecycle-flow.normalized.json", projections["flow"]);
assertFixture("lifecycle-recovery.normalized.json", projections["recovery"]);
assertFixture("lifecycle-cleanup.normalized.json", projections["cleanup"]);
assertTextFixture("lifecycle-diagnostic.human.txt", diagnosticHuman);
console.log("V1 packed analyzer lifecycle passed (identity, events, diagnostics, correction, recovery, cleanup)");
