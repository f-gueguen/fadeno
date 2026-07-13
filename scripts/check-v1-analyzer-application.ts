import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PrivateProjectAnalyzer,
  routeArtifactPlanFromPublication,
} from "../packages/framework/src/internal/analyzer-project.ts";
import { deserializeAnalyzerPublicationSnapshot, serializeAnalyzerPublicationSnapshot } from "../packages/framework/src/internal/analyzer-publication.ts";
import type { RouteArtifactMutationFileSystem } from "../packages/framework/src/internal/routing/generator.ts";

type OutputSnapshot = Readonly<Record<string, Readonly<{ bytes: Buffer; mtimeNs: bigint }>>>;

function outputSnapshot(output: string): OutputSnapshot {
  return Object.freeze(Object.fromEntries(readdirSync(output).sort().map((name) => {
    const path = join(output, name);
    return [name, Object.freeze({ bytes: readFileSync(path), mtimeNs: statSync(path, { bigint: true }).mtimeNs })];
  })));
}

function assertSnapshot(output: string, expected: OutputSnapshot, mtimes = false): void {
  const actual = outputSnapshot(output);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(actual[name]?.bytes.equals(value.bytes), true, name);
    if (mtimes) assert.equal(actual[name]?.mtimeNs, value.mtimeNs, `${name}:mtime`);
  }
}

function writeRoute(root: string, path: string): void {
  const target = join(root, "src/routes", path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `export default function Page(): string { return ${JSON.stringify(path)}; }\n`);
}

function mutationFileSystem(fail: (operation: "mkdir" | "write" | "rename" | "remove", count: number, path: string) => boolean): RouteArtifactMutationFileSystem {
  const counts = { mkdir: 0, write: 0, rename: 0, remove: 0 };
  const reject = (operation: keyof typeof counts, path: string): void => {
    counts[operation] += 1;
    if (fail(operation, counts[operation], path)) throw new TypeError(`FADENO_TEST_${operation.toUpperCase()}_FAILURE`);
  };
  return Object.freeze({
    mkdir: (path) => { reject("mkdir", path); mkdirSync(path); },
    writeFile: (path, bytes) => { reject("write", path); writeFileSync(path, bytes); },
    rename: (from, to) => { reject("rename", `${from}->${to}`); renameSync(from, to); },
    remove: (path) => { reject("remove", path); rmSync(path, { recursive: true, force: true }); },
  });
}

function manifestRoutes(output: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  return manifest.routes.map(({ id }) => id);
}

function mutatePublication(
  analysis: Awaited<ReturnType<PrivateProjectAnalyzer["analyze"]>>,
  mutate: (publication: any) => void,
): void {
  const publication = structuredClone(analysis.publication);
  mutate(publication);
  assert.throws(() => routeArtifactPlanFromPublication(publication, analysis.routePlan!), /FADENO_ANALYZER_APPLICATION_PUBLICATION/u);
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-application-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(root);
  const output = join(root, ".fadeno/routes");

  const initial = await analyzer.analyze();
  assert.equal(initial.apply().changed, true);
  const initialSnapshot = outputSnapshot(output);
  assert.equal(initial.apply().changed, false);
  assertSnapshot(output, initialSnapshot, true);

  const transported = deserializeAnalyzerPublicationSnapshot(serializeAnalyzerPublicationSnapshot(initial.publication));
  assert.equal("apply" in transported, false);
  assert.deepEqual(routeArtifactPlanFromPublication(initial.publication, initial.routePlan!).files, initial.routePlan?.files);
  mutatePublication(initial, (publication) => { publication.artifacts[0].path = ".fadeno/foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].id = "generated:foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].ownerNodeId = "route:foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].value.encoding = "binary"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].value.sha256 = "0".repeat(64); });
  mutatePublication(initial, (publication) => {
    publication.artifacts[0].value.bytes = "";
    publication.artifacts[0].value.sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  });
  mutatePublication(initial, (publication) => { publication.artifacts[0].provenance.module.transformation = "foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].provenance.generatedArtifactOwnership.path = ".fadeno/foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts[0].provenance.sourceToArtifacts[0].artifactId = "generated:foreign"; });
  mutatePublication(initial, (publication) => { publication.artifacts.pop(); });
  mutatePublication(initial, (publication) => { publication.artifacts.push(structuredClone(publication.artifacts[0])); });

  writeRoute(root, "obsolete/page.tsx");
  const withObsolete = await analyzer.analyze();
  const observed: string[] = [];
  assert.equal(withObsolete.apply({ observe: (phase) => {
    observed.push(phase);
    if (phase === "after-backup") assert.equal(existsSync(output), false);
  } }).changed, true);
  assert.deepEqual(observed, ["after-stage", "after-backup", "after-replace", "before-cleanup"]);
  assert.equal(manifestRoutes(output).includes("/obsolete"), true);
  await assert.rejects(async () => initial.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);

  cpSync(new URL("../examples/v1-app/scenarios/analyzer-project/handler.ts", import.meta.url), join(root, "src/routes/handler.ts"));
  const collision = await analyzer.analyze();
  const retainedCollision = outputSnapshot(output);
  assert.throws(() => collision.apply(), /FADENO_ANALYZER_APPLICATION_DIAGNOSTIC/u);
  assertSnapshot(output, retainedCollision, true);

  rmSync(join(root, "src/routes/handler.ts"));
  rmSync(join(root, "src/routes/obsolete"), { recursive: true });
  const recovery = await analyzer.analyze();
  assert.equal(recovery.apply().changed, true);
  assert.equal(manifestRoutes(output).includes("/obsolete"), false);

  const staleSource = await analyzer.analyze();
  const home = join(root, "src/routes/page.tsx");
  const homeBytes = readFileSync(home, "utf8");
  writeFileSync(home, `${homeBytes}// changed before apply\n`);
  const beforeStaleRefusal = outputSnapshot(output);
  assert.throws(() => staleSource.apply(), /FADENO_ANALYZER_PROJECT_INPUT_CHANGED/u);
  assertSnapshot(output, beforeStaleRefusal, true);
  writeFileSync(home, homeBytes);

  writeRoute(root, "fault/page.tsx");
  const fault = await analyzer.analyze();
  const beforeFault = outputSnapshot(output);
  assert.throws(() => fault.apply({ fileSystem: mutationFileSystem((operation, count) => operation === "write" && count === 1) }), /FADENO_TEST_WRITE_FAILURE/u);
  assertSnapshot(output, beforeFault, true);
  assert.equal(readdirSync(join(root, ".fadeno")).some((name) => name.startsWith("routes.pending-") || name.startsWith("routes.previous-")), false);

  assert.throws(() => fault.apply({ fileSystem: mutationFileSystem((operation, count) => operation === "rename" && count === 1) }), /FADENO_TEST_RENAME_FAILURE/u);
  assertSnapshot(output, beforeFault, true);

  assert.throws(() => fault.apply({ fileSystem: mutationFileSystem((operation, count) => operation === "rename" && count === 2) }), /FADENO_TEST_RENAME_FAILURE/u);
  assertSnapshot(output, beforeFault, true);

  assert.throws(() => fault.apply({ fileSystem: mutationFileSystem((operation, count) => operation === "rename" && (count === 2 || count === 3)) }), /FADENO_TEST_RENAME_FAILURE/u);
  assert.equal(existsSync(output), false);
  assert.equal(readdirSync(join(root, ".fadeno")).filter((name) => name.startsWith("routes.previous-")).length, 1);
  assert.equal(fault.apply().changed, true);
  assert.equal(manifestRoutes(output).includes("/fault"), true);

  writeRoute(root, "cleanup/page.tsx");
  const cleanup = await analyzer.analyze();
  assert.throws(() => cleanup.apply({ fileSystem: mutationFileSystem((operation, _count, path) => operation === "remove" && path.includes("routes.previous-")) }), /FADENO_TEST_REMOVE_FAILURE/u);
  assert.equal(existsSync(output), true);
  assert.equal(readdirSync(join(root, ".fadeno")).filter((name) => name.startsWith("routes.previous-")).length, 1);
  assert.equal(cleanup.apply().changed, true);
  assert.equal(manifestRoutes(output).includes("/cleanup"), true);

  writeRoute(root, "post-validation/page.tsx");
  const postValidation = await analyzer.analyze();
  const beforePostValidation = outputSnapshot(output);
  const postPath = join(root, "src/routes/post-validation/page.tsx");
  const postBytes = readFileSync(postPath, "utf8");
  assert.throws(() => postValidation.apply({ observe: (phase) => {
    if (phase === "after-replace") writeFileSync(postPath, `${postBytes}// changed after replace\n`);
  } }), /FADENO_ANALYZER_PROJECT_INPUT_CHANGED/u);
  assertSnapshot(output, beforePostValidation, true);
  writeFileSync(postPath, postBytes);
  assert.equal(postValidation.apply().changed, true);

  const staleConfiguration = await analyzer.analyze();
  const configPath = join(root, "fadeno.config.ts");
  const configBytes = readFileSync(configPath, "utf8");
  writeFileSync(configPath, `// changed before apply\n${configBytes}`);
  const beforeConfigRefusal = outputSnapshot(output);
  assert.throws(() => staleConfiguration.apply(), /FADENO_ANALYZER_PROJECT_INPUT_CHANGED/u);
  assertSnapshot(output, beforeConfigRefusal, true);
  writeFileSync(configPath, configBytes);

  const staleStructure = await analyzer.analyze();
  writeRoute(root, "new-entry/page.tsx");
  const beforeStructureRefusal = outputSnapshot(output);
  assert.throws(() => staleStructure.apply(), /FADENO_GENERATION_SOURCE_CHANGED/u);
  assertSnapshot(output, beforeStructureRefusal, true);
  rmSync(join(root, "src/routes/new-entry"), { recursive: true });

  const recoveryEvidence = await analyzer.analyze();
  const parent = join(root, ".fadeno");
  const completePending = join(parent, "routes.pending-complete");
  cpSync(output, completePending, { recursive: true });
  const beforePendingCleanup = outputSnapshot(output);
  const invalidPrevious = join(parent, "routes.previous-invalid");
  mkdirSync(invalidPrevious);
  writeFileSync(join(invalidPrevious, "partial"), "unowned\n");
  assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_UNOWNED/u);
  assert.equal(existsSync(completePending), true);
  assertSnapshot(output, beforePendingCleanup, true);
  rmSync(invalidPrevious, { recursive: true });
  assert.equal(recoveryEvidence.apply().changed, false);
  assert.equal(existsSync(completePending), false);
  assertSnapshot(output, beforePendingCleanup, true);

  cpSync(output, join(parent, "routes.pending-first"), { recursive: true });
  cpSync(output, join(parent, "routes.pending-second"), { recursive: true });
  assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_RECOVERY_AMBIGUOUS/u);
  assertSnapshot(output, beforePendingCleanup, true);
  rmSync(join(parent, "routes.pending-first"), { recursive: true });
  rmSync(join(parent, "routes.pending-second"), { recursive: true });

  const partialPending = join(parent, "routes.pending-partial");
  mkdirSync(partialPending);
  writeFileSync(join(partialPending, "partial"), "unconfirmed\n");
  assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_RECOVERY_PENDING/u);
  assertSnapshot(output, beforePendingCleanup, true);
  rmSync(partialPending, { recursive: true });

  const external = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-application-external-"));
  try {
    const sentinel = join(external, "sentinel.txt");
    writeFileSync(sentinel, "external-owned\n");
    const linkedPending = join(parent, "routes.pending-linked");
    symlinkSync(external, linkedPending);
    assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_RECOVERY_PENDING/u);
    assert.equal(readFileSync(sentinel, "utf8"), "external-owned\n");
    unlinkSync(linkedPending);

    const displaced = join(parent, "routes.displaced-test");
    renameSync(output, displaced);
    symlinkSync(external, output);
    assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_TYPE/u);
    assert.equal(readFileSync(sentinel, "utf8"), "external-owned\n");
    unlinkSync(output);
    renameSync(displaced, output);
  } finally {
    rmSync(external, { recursive: true, force: true });
  }

  cpSync(output, join(parent, "routes.previous-first"), { recursive: true });
  cpSync(output, join(parent, "routes.previous-second"), { recursive: true });
  assert.throws(() => recoveryEvidence.apply(), /FADENO_GENERATION_OUTPUT_RECOVERY_AMBIGUOUS/u);
  assertSnapshot(output, beforePendingCleanup, true);
  rmSync(join(parent, "routes.previous-first"), { recursive: true });
  rmSync(join(parent, "routes.previous-second"), { recursive: true });

  const older = await analyzer.analyze();
  const newer = await analyzer.analyze();
  assert.throws(() => older.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);
  assert.equal(newer.apply().changed, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 analyzer disk application passed (current publication, collision preservation, faults, recovery, no mixed set)");
