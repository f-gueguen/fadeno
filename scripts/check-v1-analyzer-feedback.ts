import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, release, tmpdir, totalmem, version as osVersion } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PrivateAnalyzerOperationHandle } from "../packages/framework/src/internal/analyzer-coordinator.ts";
import type { PrivateProjectRefresh } from "../packages/framework/src/internal/analyzer-project.ts";
import type { PrivateFilesystemRefreshCycle, PrivateFilesystemRefreshTarget } from "../packages/framework/src/internal/analyzer-watcher.ts";
import { buildFeedbackEvidenceDocuments } from "./lib/v1-analyzer-feedback-evidence.ts";
import {
  redactedEnvironmentSha256,
  sha256,
  verifyFeedbackContract,
  verifyFeedbackRun,
} from "./lib/v1-analyzer-feedback-verifier.ts";

type AnalyzerProjectModule = typeof import("../packages/framework/src/internal/analyzer-project.ts");
type AnalyzerCompilerModule = typeof import("../packages/framework/src/internal/analyzer-compiler.ts");
type AnalyzerWatcherModule = typeof import("../packages/framework/src/internal/analyzer-watcher.ts");
type AnalyzerDiagnosticsModule = typeof import("../packages/framework/src/internal/analyzer-diagnostics.ts");
type FileIdentity = readonly Readonly<{ path: string; mode: number; sha256: string }>[];

type PendingAttempt = {
  readonly workloadId: "diagnostic-replacement" | "cleared-replacement";
  readonly startNs: bigint;
  readonly accept: (observation: AcceptedObservation) => void;
  readonly refuse: (error: unknown) => void;
  refreshNs: bigint | null;
  compilerStartNs: bigint | null;
  compilerEndNs: bigint | null;
};

type AcceptedObservation = Readonly<{
  acceptedNs: bigint;
  kind: "diagnostic-replacement" | "success-replacement";
  refresh: PrivateProjectRefresh | null;
  error: unknown;
  diskSha256: string;
}>;

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const packageName = "fadeno-framework-internal";
const contractPath = join(root, "fixtures/v1-analyzer/feedback-contract.json");
const pageBytes = "export default function Page(): string { return 'feedback'; }\n";
const handlerBytes = "export function GET(): Response { return new Response('feedback'); }\n";
const arguments_ = process.argv.slice(2).filter((argument, index) => argument !== "--" || index !== 0);
let deepTiming = false;
let retainPath: string | null = null;
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index]!;
  if (argument === "--deep-timing" && !deepTiming) {
    deepTiming = true;
    continue;
  }
  if (argument === "--retain" && retainPath === null && index + 1 < arguments_.length) {
    retainPath = arguments_[++index]!;
    continue;
  }
  throw new TypeError("FADENO_FEEDBACK_ARGUMENTS");
}
if (retainPath !== null && !deepTiming) throw new TypeError("FADENO_FEEDBACK_RETAIN_REQUIRES_DEEP_TIMING");

function retainedDirectory(requested: string, sourceCommit: string): string {
  if (requested.length === 0 || isAbsolute(requested) || requested.includes("\0")) throw new TypeError("FADENO_FEEDBACK_RETAIN_PATH");
  const result = resolve(root, requested);
  const relativePath = relative(root, result).split("\\").join("/");
  if (relativePath !== requested || !relativePath.startsWith("evidence/v1-analyzer-feedback/results/")) {
    throw new TypeError("FADENO_FEEDBACK_RETAIN_PATH");
  }
  const name = relativePath.slice("evidence/v1-analyzer-feedback/results/".length);
  if (!/^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{7}-a[1-9][0-9]*$/u.test(name) || !name.includes(`-${sourceCommit.slice(0, 7)}-`)) {
    throw new TypeError("FADENO_FEEDBACK_RETAIN_IDENTITY");
  }
  if (existsSync(result)) throw new TypeError("FADENO_FEEDBACK_RETAIN_EXISTS");
  return result;
}

function assertJsonFixture(name: string, actual: unknown): void {
  const expected = JSON.parse(readFileSync(join(root, "fixtures/v1-analyzer", name), "utf8")) as unknown;
  assert.deepEqual(actual, expected, name);
}

function assertTextFixture(name: string, actual: string): void {
  assert.equal(actual, readFileSync(join(root, "fixtures/v1-analyzer", name), "utf8"), name);
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_FEEDBACK_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function fileIdentity(directory: string): FileIdentity {
  const files: { path: string; mode: number; sha256: string }[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(directory, path).split("\\").join("/"),
        mode: lstatSync(path).mode & 0o777,
        sha256: sha256(readFileSync(path)),
      });
      else throw new TypeError("FADENO_FEEDBACK_IDENTITY_ENTRY");
    }
  };
  visit(directory);
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

function identitySha256(identity: FileIdentity): string {
  return sha256(JSON.stringify(identity));
}

function sourceIdentity(): Readonly<{ commit: string; treeSha256: string }> {
  const commit = run("git", ["rev-parse", "HEAD"], root).trim();
  assert.match(commit, /^[0-9a-f]{40}$/u);
  const listed = spawnSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new TypeError("FADENO_FEEDBACK_SOURCE_FILES");
  const tracked = listed.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const match = /^(100644|100755) [0-9a-f]+ 0\t(.+)$/u.exec(entry);
    if (!match) throw new TypeError("FADENO_FEEDBACK_SOURCE_INDEX");
    return Object.freeze({ path: match[2]!, mode: Number.parseInt(match[1]!, 8) & 0o777 });
  });
  const others = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (others.error) throw others.error;
  if (others.status !== 0) throw new TypeError("FADENO_FEEDBACK_SOURCE_FILES");
  const untracked = others.stdout.toString("utf8").split("\0").filter(Boolean).map((path) => Object.freeze({
    path,
    mode: lstatSync(join(root, path)).mode & 0o777,
  }));
  const identity = [...tracked, ...untracked].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0).map(({ path, mode }) => {
    const absolute = join(root, path);
    return Object.freeze({ path, mode, sha256: sha256(readFileSync(absolute)) });
  });
  return Object.freeze({ commit, treeSha256: sha256(JSON.stringify(identity)) });
}

function compilerIdentity(installedPackage: string): Readonly<{ version: string; sha256: string }> {
  const require = createRequire(join(installedPackage, "package.json"));
  const manifestPath = require.resolve("typescript/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
  const parserRequire = createRequire(manifestPath);
  const executableManifest = parserRequire.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`);
  const executable = join(dirname(executableManifest), "lib/tsc");
  const identity = [
    Object.freeze({ path: "typescript/package.json", sha256: sha256(readFileSync(manifestPath)) }),
    Object.freeze({ path: "typescript/lib/tsc.js", sha256: sha256(readFileSync(join(dirname(manifestPath), "lib/tsc.js"))) }),
    Object.freeze({ path: "compiler/package.json", sha256: sha256(readFileSync(executableManifest)) }),
    Object.freeze({ path: "compiler/lib/tsc", sha256: sha256(readFileSync(executable)) }),
  ];
  return Object.freeze({ version: manifest.version, sha256: sha256(JSON.stringify(identity)) });
}

function outputSha256(application: string): string {
  return identitySha256(fileIdentity(join(application, ".fadeno/routes")));
}

function diskArtifacts(application: string): readonly Readonly<{ path: string; sha256: string }>[] {
  return Object.freeze(fileIdentity(join(application, ".fadeno/routes")).map(({ path, sha256: digest }) => Object.freeze({
    path: `.fadeno/routes/${path}`,
    sha256: digest,
  })));
}

function publicationArtifacts(publication: PrivateProjectRefresh["publication"]): readonly Readonly<{ path: string; sha256: string }>[] {
  return Object.freeze(publication.artifacts.map((artifact) => {
    const value = artifact.value as Readonly<{ sha256: string }>;
    return Object.freeze({ path: artifact.path, sha256: value.sha256 });
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function publicationSha256(publication: PrivateProjectRefresh["publication"]): string {
  return sha256(JSON.stringify(publication));
}

function acceptedPromise(workloadId: PendingAttempt["workloadId"], startNs: bigint): Readonly<{
  promise: Promise<AcceptedObservation>;
  pending: PendingAttempt;
}> {
  let accept!: (observation: AcceptedObservation) => void;
  let refuse!: (error: unknown) => void;
  const promise = new Promise<AcceptedObservation>((resolve, reject) => { accept = resolve; refuse = reject; });
  return Object.freeze({
    promise,
    pending: { workloadId, startNs, accept, refuse, refreshNs: null, compilerStartNs: null, compilerEndNs: null },
  });
}

function cleanupProjection(watcher: ReturnType<AnalyzerWatcherModule["PrivateFilesystemInvalidationAdapter"]["prototype"]["ownership"]>, project: ReturnType<AnalyzerProjectModule["PrivateProjectAnalyzer"]["prototype"]["ownership"]>) {
  return Object.freeze({
    activeOperations: watcher.activeOperations,
    compilerValidations: project.compiler?.activeValidations ?? 0,
    coordinatorActiveOperations: project.coordinator.activeOperations,
    coordinatorDrainWorkers: project.coordinator.drainWorkers,
    coordinatorPendingAnalysisOperations: project.coordinator.pendingAnalysisOperations,
    coordinatorQueuedOperations: project.coordinator.queuedOperations,
    currentAnalysisTokens: project.currentAnalysisTokens,
    latestAnalysisRequests: project.latestAnalysisRequests,
    observers: watcher.observers,
    pendingApplicationRecoveries: project.pendingApplicationRecoveries,
    pendingBytes: watcher.pendingBytes,
    pendingCleanups: project.pendingCleanups,
    pendingHints: watcher.pendingHints,
    pendingNotifications: watcher.pendingNotifications,
    pendingRollbacks: project.pendingRollbacks,
    retainedCycles: watcher.retainedCycles,
    timers: watcher.timers,
    waiters: watcher.waiters,
  });
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-v1-feedback-"));
try {
  if (retainPath !== null && run("git", ["status", "--porcelain"], root).trim().length !== 0) {
    throw new TypeError("FADENO_FEEDBACK_RETAIN_DIRTY_SOURCE");
  }
  const contractBytes = readFileSync(contractPath);
  const contractSha256 = sha256(contractBytes);
  const contract = verifyFeedbackContract(JSON.parse(contractBytes.toString("utf8")) as unknown);
  assert.equal(sha256(pageBytes), contract.workloads[0]!.setup.sha256);
  assert.equal(sha256(handlerBytes), contract.workloads[0]!.mutation.sha256);

  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporary, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new TypeError("FADENO_FEEDBACK_TARBALL");
  const tarball = join(tarballs, tarballName);
  const tarballSha256 = sha256(readFileSync(tarball));
  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", tarball, "-C", extracted], temporary);
  const expectedPackageIdentity = fileIdentity(join(extracted, "package"));

  const application = join(temporary, "application");
  mkdirSync(application);
  cpSync(join(root, "examples/v1-app/src"), join(application, "src"), { recursive: true });
  cpSync(join(root, "examples/v1-app/fadeno.config.ts"), join(application, "fadeno.config.ts"));
  cpSync(join(root, "examples/v1-app/tsconfig.json"), join(application, "tsconfig.json"));
  const packageJson = JSON.parse(readFileSync(join(root, "examples/v1-app/package.json"), "utf8")) as {
    name: string;
    dependencies: Record<string, string>;
  };
  packageJson.name = "fadeno-feedback-dry-run";
  packageJson.dependencies[packageName] = `file:${tarball}`;
  writeFileSync(join(application, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  const feedbackDirectory = join(application, "src/routes/feedback");
  mkdirSync(feedbackDirectory, { recursive: true });
  const pagePath = join(feedbackDirectory, "page.tsx");
  const handlerPath = join(feedbackDirectory, "handler.ts");
  writeFileSync(pagePath, pageBytes);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], application);

  const installedPackage = join(application, "node_modules", packageName);
  assert.deepEqual(fileIdentity(installedPackage), expectedPackageIdentity);
  const installedPackageTreeSha256 = identitySha256(expectedPackageIdentity);
  const watcherPath = join(installedPackage, "dist/internal/analyzer-watcher.js");
  const watcherBytes = readFileSync(watcherPath);
  writeFileSync(watcherPath, `${watcherBytes.toString("utf8")}\n// stale feedback canary\n`);
  assert.notEqual(identitySha256(fileIdentity(installedPackage)), installedPackageTreeSha256);
  writeFileSync(watcherPath, watcherBytes);
  assert.equal(identitySha256(fileIdentity(installedPackage)), installedPackageTreeSha256);

  const analyzerPath = join(installedPackage, "dist/internal/analyzer-project.js");
  const compilerPath = join(installedPackage, "dist/internal/analyzer-compiler.js");
  const diagnosticsPath = join(installedPackage, "dist/internal/analyzer-diagnostics.js");
  const analyzerModule = await import(pathToFileURL(analyzerPath).href) as AnalyzerProjectModule;
  const compilerModule = await import(pathToFileURL(compilerPath).href) as AnalyzerCompilerModule;
  const watcherModule = await import(pathToFileURL(watcherPath).href) as AnalyzerWatcherModule;
  const diagnosticsModule = await import(pathToFileURL(diagnosticsPath).href) as AnalyzerDiagnosticsModule;

  let pending: PendingAttempt | null = null;
  const compiler = new compilerModule.PrivateCompilerValidator(application, deepTiming ? {
    onSpawn: () => { if (pending) pending.compilerStartNs = process.hrtime.bigint(); },
    onClose: () => { if (pending) pending.compilerEndNs = process.hrtime.bigint(); },
  } : {});
  const analyzer = new analyzerModule.PrivateProjectAnalyzer(application, { compiler });
  const target: PrivateFilesystemRefreshTarget<PrivateProjectRefresh> = Object.freeze({
    ownsProject: (projectRoot: string) => analyzer.ownsProject(projectRoot),
    refresh: (): PrivateAnalyzerOperationHandle<PrivateProjectRefresh> => {
      if (pending && deepTiming) pending.refreshNs = process.hrtime.bigint();
      return analyzer.refresh();
    },
    close: () => analyzer.close(),
  });
  const observerErrors: unknown[] = [];
  const adapter = new watcherModule.PrivateFilesystemInvalidationAdapter(application, target, {
    debounceMs: 0,
    maximumDelayMs: 1,
    onCycle: (cycle: PrivateFilesystemRefreshCycle<PrivateProjectRefresh>) => {
      if (!pending) return;
      try {
        assert.equal(pending.workloadId, "cleared-replacement");
        assert.equal(cycle.refresh.diagnostics.diagnostics.length, 0);
        pending.accept(Object.freeze({
          acceptedNs: process.hrtime.bigint(),
          kind: "success-replacement",
          refresh: cycle.refresh,
          error: null,
          diskSha256: outputSha256(application),
        }));
      } catch (error) {
        observerErrors.push(error);
        pending.refuse(error);
      }
    },
    onFailure: (_batch, error) => {
      if (!pending) return;
      try {
        assert.equal(pending.workloadId, "diagnostic-replacement");
        assert.ok(error instanceof analyzerModule.PrivateProjectDiagnosticError);
        pending.accept(Object.freeze({
          acceptedNs: process.hrtime.bigint(),
          kind: "diagnostic-replacement",
          refresh: null,
          error,
          diskSha256: outputSha256(application),
        }));
      } catch (captureError) {
        observerErrors.push(captureError);
        pending.refuse(captureError);
      }
    },
  });

  const initial = await adapter.flush();
  assert.equal(initial.refresh.diagnostics.diagnostics.length, 0);
  const initialDiskSha256 = outputSha256(application);
  const captured: any[] = [];
  let humanDiagnostic = "";
  const rounds = contract.schedule.warmups + contract.schedule.repetitions;
  for (let round = 0; round < rounds; round += 1) {
    for (const workloadId of contract.schedule.order) {
      if (workloadId === "diagnostic-replacement") writeFileSync(handlerPath, handlerBytes);
      else rmSync(handlerPath);
      const startNs = process.hrtime.bigint();
      const accepted = acceptedPromise(workloadId, startNs);
      pending = accepted.pending;
      const admission = adapter.notify({ kind: workloadId === "diagnostic-replacement" ? "change" : "rename", path: handlerPath });
      assert.equal(admission.status, "accepted");
      const flush = adapter.flush();
      let flushError: unknown = null;
      const settledFlush = flush.catch((error) => { flushError = error; return null; });
      const observation = await accepted.promise;
      await settledFlush;
      assert.deepEqual(observerErrors, []);
      if (workloadId === "diagnostic-replacement") assert.ok(flushError instanceof analyzerModule.PrivateProjectDiagnosticError);
      else assert.equal(flushError, null);
      const refresh = observation.refresh;
      const diagnosticError = observation.error as InstanceType<AnalyzerProjectModule["PrivateProjectDiagnosticError"]> | null;
      const diagnostics = refresh?.diagnostics ?? diagnosticError!.diagnostics;
      const publication = refresh?.publication ?? diagnosticError!.publication;
      assert.equal(diagnostics.identity.operationId, publication.operationId);
      const workload = contract.workloads.find(({ id }) => id === workloadId)!;
      assert.deepEqual(diagnostics.diagnostics.map(({ code }) => code), workload.diagnosticCodes);
      if (workloadId === "diagnostic-replacement" && humanDiagnostic.length === 0) {
        humanDiagnostic = diagnosticsModule.formatAnalyzerDiagnosticBatchHuman(diagnostics);
      }
      assert.equal(observation.diskSha256, initialDiskSha256);
      const stage = round < contract.schedule.warmups ? "warmup" : "sample";
      const repetition = stage === "warmup" ? round + 1 : round - contract.schedule.warmups + 1;
      const phaseTiming = deepTiming ? Object.freeze({
        invalidation: Object.freeze({
          status: "completed",
          elapsedNs: ((pending.refreshNs ?? observation.acceptedNs) - startNs).toString(),
          reason: null,
        }),
        "fadeno-analysis-and-generation": Object.freeze({
          status: "completed",
          elapsedNs: ((pending.compilerStartNs ?? observation.acceptedNs) - (pending.refreshNs ?? startNs)).toString(),
          reason: null,
        }),
        "typescript-refresh": pending.compilerStartNs && pending.compilerEndNs
          ? Object.freeze({ status: "completed", elapsedNs: (pending.compilerEndNs - pending.compilerStartNs).toString(), reason: null })
          : Object.freeze({ status: "skipped", elapsedNs: "0", reason: "framework-diagnostic" }),
        "accepted-consumer-replacement": Object.freeze({
          status: "completed",
          elapsedNs: (observation.acceptedNs - (pending.compilerEndNs ?? observation.acceptedNs)).toString(),
          reason: null,
        }),
      }) : null;
      captured.push({
        attemptId: `${stage}-${repetition}-${workloadId}`,
        stage,
        repetition,
        workloadId,
        startNs: startNs.toString(),
        acceptedNs: observation.acceptedNs.toString(),
        elapsedNs: (observation.acceptedNs - startNs).toString(),
        acceptedEvent: {
          kind: observation.kind,
          operationId: publication.operationId,
          diagnosticOperationId: diagnostics.identity.operationId,
          publicationOperationId: publication.operationId,
          workspaceEpoch: diagnostics.identity.workspaceEpoch,
          configurationEpoch: diagnostics.identity.configurationEpoch,
          diagnosticCodes: diagnostics.diagnostics.map(({ code }) => code),
          diagnosticCompleteness: diagnostics.completeness,
          diagnosticTruncated: diagnostics.truncated,
          publicationArtifacts: publicationArtifacts(publication),
          removedArtifactPaths: publication.removedArtifacts.map(({ path }) => path).sort(),
          diskArtifacts: diskArtifacts(application),
          publicationSha256: publicationSha256(publication),
          diskSha256: observation.diskSha256,
        },
        phaseTiming,
      });
      pending = null;
    }
  }

  await adapter.close();
  const cleanup = cleanupProjection(adapter.ownership(), analyzer.ownership());
  assert.equal(Object.values(cleanup).every((value) => value === 0), true);
  const validity = Object.freeze(Object.fromEntries(contract.validity.map((key) => [key, true])));
  const attempts = captured.map((attempt) => Object.freeze(attempt));
  const source = sourceIdentity();
  const compilerIdentity_ = compilerIdentity(installedPackage);
  const identity = Object.freeze({
    sourceCommit: source.commit,
    sourceTreeSha256: source.treeSha256,
    tarballSha256,
    installedPackageTreeSha256,
    runtimeVersion: process.version,
    runtimeExecutableSha256: sha256(readFileSync(process.execPath)),
    compilerVersion: compilerIdentity_.version,
    compilerPackageSha256: compilerIdentity_.sha256,
    platform: process.platform,
    architecture: process.arch,
    environmentSha256: redactedEnvironmentSha256(process.env),
  });
  const raw = Object.freeze({
    schema: "fadeno.private.feedback-run",
    version: 1,
    contractSha256,
    mode: retainPath === null ? "dry-run" : "measurement",
    deepTiming,
    identity,
    clock: contract.clock,
    attempts: Object.freeze(attempts),
    validity,
    cleanup,
    complete: true,
    selection: "all-attempts-no-retry",
  });
  const verified = verifyFeedbackRun(raw, contract, contractSha256, identity);
  assert.deepEqual(verified, { mode: retainPath === null ? "dry-run" : "measurement", attempts: 14, deepTiming });
  if (retainPath !== null) {
    const output = retainedDirectory(retainPath, source.commit);
    const resultId = basename(output);
    const parent = dirname(output);
    mkdirSync(parent, { recursive: true });
    const stage = join(parent, `.${output.slice(parent.length + 1)}.stage`);
    if (existsSync(stage)) throw new TypeError("FADENO_FEEDBACK_RETAIN_STAGE");
    mkdirSync(stage);
    try {
      const identityDocument = {
        schema: "fadeno.private.feedback-identity",
        version: 1,
        contractSha256,
        identity,
        attempts: raw.attempts.length,
        deepTiming,
      };
      const hostDocument = {
        schema: "fadeno.private.feedback-host",
        version: 1,
        platform: process.platform,
        architecture: process.arch,
        osRelease: release(),
        osVersion: osVersion(),
        cpuModel: cpus()[0]?.model ?? "unknown",
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        runtimeVersion: process.version,
      };
      const evidence = buildFeedbackEvidenceDocuments(
        raw,
        identityDocument,
        hostDocument,
        resultId,
        source.commit,
        contractSha256,
        contract.schedule.order,
        contract.phases,
      );
      for (const [name, bytes] of Object.entries(evidence)) writeFileSync(join(stage, name), bytes);
      renameSync(stage, output);
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  } else if (!deepTiming) {
    const projection = {
      schema: raw.schema,
      version: raw.version,
      contractSha256: "<sha256>",
      mode: raw.mode,
      deepTiming: raw.deepTiming,
      identity: Object.fromEntries(Object.keys(raw.identity).map((key) => [key, `<${key}>`])),
      clock: raw.clock,
      attemptIds: raw.attempts.map((attempt) => attempt.attemptId),
      timing: { startNs: "<ns>", acceptedNs: "<ns>", elapsedNs: "<ns>", retained: false },
      observedWorkloads: contract.workloads.map((workload) => ({
        id: workload.id,
        attempts: raw.attempts.filter((attempt) => attempt.workloadId === workload.id).length,
        acceptedEvent: workload.acceptedEvent,
        diagnosticCodes: workload.diagnosticCodes,
      })),
      validity: validity,
      finalCleanup: cleanup,
      complete: raw.complete,
      selection: raw.selection,
    };
    const firstDiagnostic = raw.attempts.find(({ workloadId }) => workloadId === "diagnostic-replacement")!;
    const firstClear = raw.attempts.find(({ workloadId }) => workloadId === "cleared-replacement")!;
    const flow = {
      boundary: "saved-mutation-to-final-accepted-consumer-event",
      causes: contract.workloads.map(({ id, acceptedEvent, diagnosticCodes }) => ({ id, acceptedEvent, diagnosticCodes })),
      phases: [
        { id: "invalidation", owner: "filesystem-invalidation-adapter", diagnostic: "completed", cleared: "completed" },
        { id: "fadeno-analysis-and-generation", owner: "private-analyzer", diagnostic: "completed", cleared: "completed" },
        { id: "typescript-refresh", owner: "stock-compiler", diagnostic: "skipped-framework-diagnostic", cleared: "completed" },
        { id: "accepted-consumer-replacement", owner: "private-consumer", diagnostic: firstDiagnostic.acceptedEvent.kind, cleared: firstClear.acceptedEvent.kind },
      ],
      observableOutcome: {
        diagnosticCodes: firstDiagnostic.acceptedEvent.diagnosticCodes,
        clearedDiagnosticCodes: firstClear.acceptedEvent.diagnosticCodes,
        timingRetained: false,
      },
    };
    const recovery = {
      pairs: raw.attempts.length / 2,
      diagnosticReplacementObserved: raw.attempts.filter(({ acceptedEvent }) => acceptedEvent.kind === "diagnostic-replacement").length,
      emptyReplacementObserved: raw.attempts.filter(({ acceptedEvent }) => acceptedEvent.kind === "success-replacement").length,
      staleDiagnosticsRemoved: raw.attempts.every((attempt, index) => index % 2 === 0 || attempt.acceptedEvent.diagnosticCodes.length === 0),
      lastGoodDiskPreserved: raw.attempts.every((attempt) => attempt.acceptedEvent.diskSha256 === firstDiagnostic.acceptedEvent.diskSha256),
      stalePackageCanaryRestored: true,
      finalCleanup: cleanup,
    };
    const refusal = (mutate: (copy: any) => void): string => {
      const copy = structuredClone(raw);
      mutate(copy);
      let code = "";
      assert.throws(() => verifyFeedbackRun(copy, contract, contractSha256, identity), (error: unknown) => {
        code = error instanceof Error ? error.message : "unknown";
        return true;
      });
      return code;
    };
    const refusals = {
      stalePackage: refusal((copy) => { copy.identity.installedPackageTreeSha256 = "0".repeat(64); }),
      missingAttempt: refusal((copy) => { copy.attempts.pop(); }),
      missingFinalEvent: refusal((copy) => { copy.attempts[0].acceptedEvent.kind = "success-replacement"; }),
      incompleteCleanup: refusal((copy) => { copy.cleanup.activeOperations = 1; }),
      retrySelection: refusal((copy) => { copy.selection = "best-attempt"; }),
    };
    assertJsonFixture("feedback-dry-run.normalized.json", projection);
    assertJsonFixture("feedback-flow.normalized.json", flow);
    assertJsonFixture("feedback-recovery.normalized.json", recovery);
    assertJsonFixture("feedback-refusal.normalized.json", refusals);
    assertTextFixture("feedback-diagnostic.human.txt", humanDiagnostic);
  }
  console.log(`V1 analyzer feedback ${retainPath === null ? "dry run" : "capture"} passed (${verified.attempts} ordered attempts, current package${retainPath === null ? ", no retained timing result" : ", retained raw baseline"}${deepTiming ? ", explicit phase detail" : ""})`);
} finally {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}
