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
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AnalyzerDiagnosticBatch } from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import type {
  PrivateProjectDiagnosticError,
} from "../packages/framework/src/internal/analyzer-project.ts";
import type {
  PrivateFilesystemInvalidationBatch,
  PrivateFilesystemRefreshCycle,
} from "../packages/framework/src/internal/analyzer-watcher.ts";

type AnalyzerProjectModule = typeof import("../packages/framework/src/internal/analyzer-project.ts");
type AnalyzerWatcherModule = typeof import("../packages/framework/src/internal/analyzer-watcher.ts");
type AnalyzerDiagnosticsModule = typeof import("../packages/framework/src/internal/analyzer-diagnostics.ts");
type FileIdentity = readonly Readonly<{ path: string; sha256: string }>[];
type OutputBytes = Readonly<Record<string, string>>;

type SuccessCapture = Readonly<{
  cycle: PrivateFilesystemRefreshCycle;
  disk: OutputBytes;
  parentEntries: readonly string[];
}>;

type FailureCapture = Readonly<{
  batch: PrivateFilesystemInvalidationBatch;
  error: PrivateProjectDiagnosticError;
  disk: OutputBytes;
  parentEntries: readonly string[];
}>;

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const fixtureRoot = join(root, "fixtures/v1-analyzer");
const packageName = "fadeno-framework-internal";
const generatedNames = Object.freeze([
  "app.ts",
  "index.d.ts",
  "index.js",
  "loader.ts",
  "manifest.json",
  "owner.json",
  "virtual.ts",
]);

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `FADENO_PACKED_FRESHNESS_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`,
    );
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
      else throw new TypeError("FADENO_PACKED_FRESHNESS_IDENTITY_ENTRY");
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

function readOutput(application: string): OutputBytes {
  const output = join(application, ".fadeno/routes");
  const names = readdirSync(output).sort();
  assert.deepEqual(names, generatedNames);
  return Object.freeze(Object.fromEntries(names.map((name) => [name, readFileSync(join(output, name), "utf8")])));
}

function parentEntries(application: string): readonly string[] {
  return Object.freeze(readdirSync(join(application, ".fadeno")).sort());
}

function artifactValue(value: unknown): Readonly<{ bytes: string; encoding: string; sha256: string }> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  const record = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["bytes", "encoding", "sha256"]);
  assert.equal(typeof record["bytes"], "string");
  assert.equal(record["encoding"], "utf8");
  assert.equal(record["sha256"], sha256(record["bytes"] as string));
  return record as { bytes: string; encoding: string; sha256: string };
}

function assertSuccessCapture(capture: SuccessCapture): void {
  const { refresh } = capture.cycle;
  assert.equal(refresh.diagnostics.identity.operationId, refresh.publication.operationId);
  assert.equal(refresh.diagnostics.diagnostics.length, 0);
  assert.equal(refresh.compiler.publicationOperationId, refresh.publication.operationId);
  assert.equal(refresh.compiler.artifactSourceSha256, refresh.application.sourceSha256);
  assert.equal(refresh.publication.artifacts.length, generatedNames.length);
  assert.deepEqual(capture.parentEntries, ["routes"]);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const artifact of refresh.publication.artifacts) {
    assert.equal(ids.has(artifact.id), false);
    assert.equal(paths.has(artifact.path), false);
    ids.add(artifact.id);
    paths.add(artifact.path);
    const name = artifact.path.replace(/^\.fadeno\/routes\//u, "");
    assert.ok(generatedNames.includes(name));
    const value = artifactValue(artifact.value);
    assert.equal(capture.disk[name], value.bytes, name);
  }
  assert.deepEqual([...Object.keys(capture.disk)].sort(), generatedNames);
  const manifest = JSON.parse(capture.disk["manifest.json"]!) as {
    generation: { sourceSha256: string };
    routes: readonly { id: string }[];
  };
  assert.equal(manifest.generation.sourceSha256, refresh.application.sourceSha256);
  assert.match(capture.disk["index.d.ts"]!, new RegExp(`source ${refresh.application.sourceSha256}\\.`, "u"));
}

function routeIds(capture: SuccessCapture): readonly string[] {
  const manifest = JSON.parse(capture.disk["manifest.json"]!) as { routes: readonly { id: string }[] };
  return Object.freeze(manifest.routes.map(({ id }) => id).sort());
}

function relativeHint(application: string, path: string): string {
  return relative(application, path).split("\\").join("/");
}

function normalizedBatch(batch: PrivateFilesystemInvalidationBatch) {
  return {
    size: batch.size,
    fullWorkspace: batch.fullWorkspace,
    hints: batch.hints,
    reasons: batch.reasons,
  };
}

function diagnosticEvidence(batch: AnalyzerDiagnosticBatch) {
  const codes = new Map(batch.diagnostics.map(({ instanceId, code }) => [instanceId, code]));
  return batch.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    parameters: diagnostic.parameters,
    primaryLocation: {
      path: diagnostic.primaryLocation.path,
      range: diagnostic.primaryLocation.range,
      rangeReason: diagnostic.primaryLocation.rangeReason,
    },
    relatedLocations: diagnostic.relatedLocations.map(({ path, range, rangeReason }) => ({ path, range, rangeReason })),
    causedBy: diagnostic.causedBy.map((instanceId) => codes.get(instanceId) ?? "unknown"),
    correctionFixIds: diagnostic.correctionFixIds,
    explanationRef: diagnostic.explanationRef,
  }));
}

function flowSuccess(name: string, capture: SuccessCapture) {
  const routes = routeIds(capture);
  return {
    name,
    invalidation: normalizedBatch(capture.cycle.batch),
    decision: capture.cycle.refresh.application.changed ? "replace-generated-artifacts" : "retain-identical-artifacts",
    ownership: {
      artifactCount: capture.cycle.refresh.publication.artifacts.length,
      ownerNodeIds: [...new Set(capture.cycle.refresh.publication.artifacts.map(({ ownerNodeId }) => ownerNodeId))],
    },
    outcome: {
      freshnessRoute: routes.includes("/freshness"),
      renamedRoute: routes.includes("/renamed"),
      conflictRoute: routes.includes("/conflict"),
      exactPublicationBytesApplied: true,
    },
  };
}

function assertFixture(name: string, actual: unknown): void {
  const expected = JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as unknown;
  assert.deepEqual(actual, expected, name);
}

function assertTextFixture(name: string, actual: string): void {
  assert.equal(actual, readFileSync(join(fixtureRoot, name), "utf8"), name);
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-v1-packed-freshness-"));
let projections: Readonly<Record<string, unknown>> | null = null;
let diagnosticHuman = "";
let closed = false;
try {
  const packageDistribution = join(packageRoot, "dist");
  const staleBuildEntry = join(packageDistribution, "stale-build-entry.js");
  mkdirSync(packageDistribution, { recursive: true });
  writeFileSync(staleBuildEntry, "throw new Error('stale package output');\n");
  rmSync(packageDistribution, { recursive: true, force: true });
  assert.equal(existsSync(staleBuildEntry), false);
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
  if (!tarballName) throw new TypeError("FADENO_PACKED_FRESHNESS_TARBALL");
  const tarball = join(tarballs, tarballName);
  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", tarball, "-C", extracted], temporary);
  const expectedPackageIdentity = treeIdentity(join(extracted, "package"));

  const application = join(temporary, "application");
  mkdirSync(application);
  cpSync(join(root, "examples/v1-app/src"), join(application, "src"), { recursive: true });
  cpSync(join(root, "examples/v1-app/fadeno.config.ts"), join(application, "fadeno.config.ts"));
  cpSync(join(root, "examples/v1-app/tsconfig.json"), join(application, "tsconfig.json"));
  const sourcePackage = JSON.parse(readFileSync(join(root, "examples/v1-app/package.json"), "utf8")) as {
    name: string;
    version: string;
    private: boolean;
    type: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  sourcePackage.name = "fadeno-packed-freshness-consumer";
  sourcePackage.dependencies[packageName] = `file:${tarball}`;
  writeFileSync(join(application, "package.json"), `${JSON.stringify(sourcePackage, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], application);

  const installedPackage = join(application, "node_modules", packageName);
  const installedParserDirectories = parserDirectories(installedPackage);
  const analyzerPath = join(installedPackage, "dist/internal/analyzer-project.js");
  const watcherPath = join(installedPackage, "dist/internal/analyzer-watcher.js");
  const diagnosticsPath = join(installedPackage, "dist/internal/analyzer-diagnostics.js");
  for (const runtimePath of [analyzerPath, watcherPath]) {
    const bytes = readFileSync(runtimePath);
    detachedWrite(runtimePath, `${bytes.toString("utf8")}\n// detached stale runtime canary\n`);
    assert.throws(
      () => assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_FRESHNESS_PACKAGE_STALE"),
      /FADENO_PACKED_FRESHNESS_PACKAGE_STALE/u,
    );
    detachedWrite(runtimePath, bytes);
  }
  const parserEntry = join(installedParserDirectories.parser, "dist/ast/index.js");
  const parserBytes = readFileSync(parserEntry);
  detachedWrite(parserEntry, `${parserBytes.toString("utf8")}\n// detached stale parser canary\n`);
  assert.throws(
    () => assertIdentity(treeIdentity(installedParserDirectories.parser), builtParserIdentity.parser, "FADENO_PACKED_FRESHNESS_PARSER_STALE"),
    /FADENO_PACKED_FRESHNESS_PARSER_STALE/u,
  );
  detachedWrite(parserEntry, parserBytes);
  assertIdentity(treeIdentity(installedPackage), expectedPackageIdentity, "FADENO_PACKED_FRESHNESS_PACKAGE_STALE");
  assertIdentity(treeIdentity(installedParserDirectories.parser), builtParserIdentity.parser, "FADENO_PACKED_FRESHNESS_PARSER_STALE");
  assertIdentity(
    treeIdentity(installedParserDirectories.executable),
    builtParserIdentity.executable,
    "FADENO_PACKED_FRESHNESS_EXECUTABLE_STALE",
  );

  const analyzerModule = await import(pathToFileURL(analyzerPath).href) as AnalyzerProjectModule;
  const watcherModule = await import(pathToFileURL(watcherPath).href) as AnalyzerWatcherModule;
  const diagnosticsModule = await import(pathToFileURL(diagnosticsPath).href) as AnalyzerDiagnosticsModule;
  const analyzer = new analyzerModule.PrivateProjectAnalyzer(application);
  const successes: SuccessCapture[] = [];
  const failures: FailureCapture[] = [];
  const observerErrors: unknown[] = [];
  const adapter = new watcherModule.PrivateFilesystemInvalidationAdapter(application, analyzer, {
    debounceMs: 0,
    maximumDelayMs: 1,
    onCycle: (cycle) => {
      try {
        const capture = Object.freeze({ cycle, disk: readOutput(application), parentEntries: parentEntries(application) });
        assertSuccessCapture(capture);
        successes.push(capture);
      } catch (error) {
        observerErrors.push(error);
      }
    },
    onFailure: (batch, error) => {
      try {
        assert.ok(error instanceof analyzerModule.PrivateProjectDiagnosticError);
        assert.equal(error.diagnostics.identity.operationId, error.publication.operationId);
        failures.push(Object.freeze({
          batch,
          error,
          disk: readOutput(application),
          parentEntries: parentEntries(application),
        }));
      } catch (captureError) {
        observerErrors.push(captureError);
      }
    },
  });

  const receiveSuccess = async (): Promise<SuccessCapture> => {
    const prior = successes.length;
    const priorFailures = failures.length;
    const cycle = await adapter.flush();
    assert.deepEqual(observerErrors, []);
    assert.equal(successes.length, prior + 1);
    assert.equal(failures.length, priorFailures);
    const capture = successes.at(-1);
    assert.ok(capture);
    assert.equal(capture.cycle, cycle);
    return capture;
  };
  const receiveFailure = async (): Promise<FailureCapture> => {
    const prior = failures.length;
    let rejected: unknown = null;
    await assert.rejects(adapter.flush(), (error: unknown) => {
      rejected = error;
      return error instanceof Error && /FADENO_ANALYZER_APPLICATION_DIAGNOSTIC/u.test(error.message);
    });
    assert.equal(failures.length, prior + 1);
    assert.deepEqual(observerErrors, []);
    const capture = failures.at(-1);
    assert.ok(capture);
    assert.equal(capture.error, rejected);
    return capture;
  };

  const baseline = await receiveSuccess();
  const routeDirectory = join(application, "src/routes/freshness");
  const routePath = join(routeDirectory, "page.tsx");
  mkdirSync(routeDirectory, { recursive: true });
  writeFileSync(routePath, "export default function Page(): string { return 'freshness'; }\n");
  assert.equal(adapter.notify({ kind: "change", path: routePath }).reason, "contained-change");
  const direct = await receiveSuccess();
  assert.equal(routeIds(direct).includes("/freshness"), true);
  assert.equal(direct.cycle.refresh.application.changed, true);

  const owner = join(application, "src/freshness-owner.ts");
  const chain = join(application, "support-chain");
  mkdirSync(chain);
  writeFileSync(join(chain, "level1.ts"), "export { freshnessValue } from './level2.ts';\n");
  writeFileSync(join(chain, "level2.ts"), "export { freshnessValue } from './level3.ts';\n");
  const leaf = join(chain, "level3.ts");
  writeFileSync(leaf, "export const freshnessValue: string = 'one';\n");
  writeFileSync(owner, "import { freshnessValue } from '../support-chain/level1.ts';\nvoid freshnessValue;\n");
  adapter.notify({ kind: "change", path: owner });
  const chainInitial = await receiveSuccess();
  writeFileSync(leaf, "export const freshnessValue: string = 'two';\n");
  assert.equal(adapter.notify({ kind: "change", path: leaf }).reason, "contained-change");
  const transitive = await receiveSuccess();
  assert.notEqual(transitive.cycle.refresh.compiler.inputSha256, chainInitial.cycle.refresh.compiler.inputSha256);
  assert.equal(transitive.cycle.refresh.application.sourceSha256, chainInitial.cycle.refresh.application.sourceSha256);
  assert.deepEqual(transitive.disk, chainInitial.disk);
  assert.equal(transitive.cycle.refresh.application.changed, false);

  const configPath = join(application, "fadeno.config.ts");
  const configBytes = readFileSync(configPath, "utf8");
  writeFileSync(configPath, `// C3 configuration-only refresh\n${configBytes}`);
  assert.equal(adapter.notify({ kind: "change", path: configPath }).reason, "contained-change");
  const configuration = await receiveSuccess();
  assert.deepEqual(configuration.cycle.batch.hints, [relativeHint(application, configPath)]);
  assert.equal(configuration.cycle.refresh.publication.configurationEpoch, transitive.cycle.refresh.publication.configurationEpoch + 1);
  assert.equal(configuration.cycle.refresh.application.changed, false);
  assert.deepEqual(configuration.disk, transitive.disk);

  const renamedDirectory = join(application, "src/routes/renamed");
  renameSync(routeDirectory, renamedDirectory);
  const renamedPath = join(renamedDirectory, "page.tsx");
  assert.equal(adapter.notify({ kind: "rename", path: renamedPath }).reason, "rename-rescan");
  const renamed = await receiveSuccess();
  assert.equal(routeIds(renamed).includes("/freshness"), false);
  assert.equal(routeIds(renamed).includes("/renamed"), true);
  assert.equal(renamed.disk["index.d.ts"]!.includes('"/freshness"'), false);
  assert.equal(renamed.disk["index.d.ts"]!.includes('"/renamed"'), true);

  rmSync(renamedDirectory, { recursive: true });
  adapter.notify({ kind: "rename", path: renamedPath });
  const deleted = await receiveSuccess();
  assert.equal(routeIds(deleted).includes("/freshness"), false);
  assert.equal(routeIds(deleted).includes("/renamed"), false);
  assert.equal(deleted.disk["index.d.ts"]!.includes('"/freshness"'), false);
  assert.equal(deleted.disk["index.d.ts"]!.includes('"/renamed"'), false);
  assert.equal(
    deleted.cycle.refresh.publication.graph.removedNodes.some(({ ownerUri }) => ownerUri.endsWith("/src/routes/renamed/page.tsx")),
    true,
  );

  const conflictDirectory = join(application, "src/routes/conflict");
  const conflictPage = join(conflictDirectory, "page.tsx");
  mkdirSync(conflictDirectory, { recursive: true });
  writeFileSync(conflictPage, "export default function Page(): string { return 'conflict'; }\n");
  writeFileSync(join(conflictDirectory, "handler.ts"), "export function GET(): Response { return new Response('conflict'); }\n");
  adapter.notify({ kind: "change", path: conflictPage });
  const refusal = await receiveFailure();
  assert.deepEqual(refusal.error.diagnostics.diagnostics.map(({ code }) => code), [
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
  ]);
  assert.equal(refusal.error.publication.artifacts.length, 0);
  assert.equal(refusal.error.publication.removedArtifacts.length, generatedNames.length);
  assert.deepEqual(refusal.disk, deleted.disk);
  assert.deepEqual(refusal.parentEntries, ["routes"]);
  diagnosticHuman = diagnosticsModule.formatAnalyzerDiagnosticBatchHuman(refusal.error.diagnostics);
  const refusedInstanceIds = refusal.error.diagnostics.diagnostics.map(({ instanceId }) => instanceId);

  rmSync(conflictDirectory, { recursive: true });
  adapter.notify({ kind: "rename", path: conflictPage });
  const recovery = await receiveSuccess();
  assert.equal(recovery.cycle.refresh.diagnostics.diagnostics.length, 0);
  assert.equal(
    recovery.cycle.refresh.diagnostics.diagnostics.some(({ instanceId }) => refusedInstanceIds.includes(instanceId)),
    false,
  );
  assert.deepEqual(recovery.disk, deleted.disk);
  assert.equal(routeIds(recovery).includes("/conflict"), false);
  await adapter.close();
  closed = true;

  const successProjection = Object.freeze({
    initial: {
      delivery: normalizedBatch(baseline.cycle.batch),
      artifactCount: baseline.cycle.refresh.publication.artifacts.length,
      exactPublicationBytesApplied: true,
    },
    direct: {
      delivery: normalizedBatch(direct.cycle.batch),
      workspaceEpoch: direct.cycle.refresh.publication.workspaceEpoch,
      routeAdded: routeIds(direct).includes("/freshness"),
      declarationAndManifestReplaced: direct.cycle.refresh.application.changed,
      artifactCount: direct.cycle.refresh.publication.artifacts.length,
      exactPublicationBytesApplied: true,
    },
    transitive: {
      delivery: normalizedBatch(transitive.cycle.batch),
      importedLeafOutsideRootInclude: relativeHint(application, leaf),
      compilerInputChanged: true,
      artifactIdentityUnchanged: true,
      artifactBytesUnchanged: true,
    },
    configuration: {
      delivery: normalizedBatch(configuration.cycle.batch),
      configurationEpochBefore: transitive.cycle.refresh.publication.configurationEpoch,
      configurationEpochAfter: configuration.cycle.refresh.publication.configurationEpoch,
      soleMutationAdvancedConfigurationEpoch: true,
      artifactBytesUnchanged: true,
    },
  });
  const refusalProjection = Object.freeze({
    batch: normalizedBatch(refusal.batch),
    error: refusal.error.message,
    operationIdentityMatches: refusal.error.diagnostics.identity.operationId === refusal.error.publication.operationId,
    diagnostics: diagnosticEvidence(refusal.error.diagnostics),
    correctionFixIds: refusal.error.diagnostics.corrections.map(({ fixId }) => fixId),
    skippedWork: refusal.error.diagnostics.skippedWork.map(({ id }) => id),
    publicationArtifactCount: refusal.error.publication.artifacts.length,
    removedArtifactIds: refusal.error.publication.removedArtifacts.map(({ id }) => id),
    lastGoodDiskPreserved: true,
    transactionDebrisAbsent: true,
  });
  const flowProjection = Object.freeze([
    flowSuccess("direct", direct),
    flowSuccess("transitive", transitive),
    flowSuccess("configuration", configuration),
    flowSuccess("rename", renamed),
    flowSuccess("delete", deleted),
    {
      name: "refusal",
      invalidation: normalizedBatch(refusal.batch),
      decision: "refuse-artifact-application",
      causesAndOwnership: diagnosticEvidence(refusal.error.diagnostics),
      skippedWork: refusal.error.diagnostics.skippedWork.map(({ id }) => id),
      outcome: { publicationArtifactsRemoved: generatedNames.length, lastGoodDiskPreserved: true },
    },
    flowSuccess("recovery", recovery),
  ]);
  const staleProjection = Object.freeze({
    rename: {
      oldRouteAbsent: true,
      newRoutePresent: true,
      declarationReplaced: true,
      exactArtifactBytesApplied: true,
    },
    deletion: {
      oldAndNewRoutesAbsent: true,
      declarationReplaced: true,
      disappearedOwnerRemoved: true,
      exactArtifactBytesApplied: true,
    },
    refusal: {
      desiredPublicationRemovedArtifacts: generatedNames.length,
      appliedLastGoodDiskPreserved: true,
    },
  });
  const recoveryProjection = Object.freeze({
    delivery: normalizedBatch(recovery.cycle.batch),
    workspaceEpoch: recovery.cycle.refresh.publication.workspaceEpoch,
    artifactCount: recovery.cycle.refresh.publication.artifacts.length,
    diagnosticsReplacedWithEmptyBatch: true,
    staleDiagnosticInstancesPresent: false,
    publicationMatchesDisk: true,
    lastGoodBytesReunified: true,
    staleRoutePresent: false,
    transactionDebrisAbsent: true,
    adapterAndAnalyzerClosed: closed,
    disposableApplicationRemoved: true,
  });
  projections = Object.freeze({
    success: successProjection,
    refusal: refusalProjection,
    flow: flowProjection,
    stale: staleProjection,
    recovery: recoveryProjection,
  });
} finally {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}

assert.ok(projections);
assert.equal(closed, true);
assert.equal(existsSync(temporary), false);

assertFixture("freshness-success.normalized.json", projections["success"]);
assertFixture("freshness-refusal.normalized.json", projections["refusal"]);
assertFixture("freshness-flow.normalized.json", projections["flow"]);
assertFixture("freshness-stale-artifact.normalized.json", projections["stale"]);
assertFixture("freshness-recovery.normalized.json", projections["recovery"]);
assertTextFixture("freshness-diagnostic.human.txt", diagnosticHuman);
console.log("V1 packed saved-project freshness passed (direct, transitive, config, rename, deletion, refusal, recovery)");
