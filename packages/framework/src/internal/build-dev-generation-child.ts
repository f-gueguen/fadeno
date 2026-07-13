import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createScanner, SyntaxKind } from "typescript/unstable/ast";

import {
  assertPrivateBuildCompilerContract,
  assertPrivateRuntimeIdentity,
  capturePrivateEnvironment,
  capturePrivateRuntimeIdentity,
  type PrivateRuntimeIdentity,
} from "./build-dev-decision.ts";
import { capturePrivateCompilerDependencyRoots } from "./analyzer-compiler.ts";

const maximumRequestBytes = 256 * 1024;
const maximumCompilerOutputBytes = 1024 * 1024;
const maximumCompilerFiles = 4_096;
const maximumSourceFileBytes = 64 * 1024 * 1024;
const maximumDiagnostics = 4_096;
const maximumDiagnosticBytes = 4 * 1024 * 1024;
const maximumTraversalEntries = 8_192;
const maximumTraversalPathBytes = 1024 * 1024;
const maximumRuntimeReferences = 4_096;
const maximumRuntimeTokens = 1_000_000;

type RuntimeClosure = Readonly<{ root: string; identity: PrivateRuntimeIdentity }>;
type GenerationRequest = Readonly<{
  schemaVersion: 1;
  generation: number;
  projectRoot: string;
  stageRoot: string;
  environmentSha256: string;
  runtimeClosures: readonly RuntimeClosure[];
}>;

type StructuredDiagnostic = Readonly<{
  code: number;
  category: number;
  file: string | null;
  start: number | null;
  end: number | null;
  rangeReason: "global" | null;
  text: string;
}>;

function fail(code: string): never { throw new TypeError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function contained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}
function plain(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function request(): GenerationRequest {
  const chunks: Buffer[] = [];
  let requestBytes = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumRequestBytes + 1 - requestBytes));
    const count = readSync(0, chunk, 0, chunk.byteLength, null);
    if (count === 0) break;
    requestBytes += count;
    if (requestBytes > maximumRequestBytes) fail("FADENO_BUILD_CHILD_REQUEST");
    chunks.push(chunk.subarray(0, count));
  }
  if (requestBytes === 0) fail("FADENO_BUILD_CHILD_REQUEST");
  const bytes = Buffer.concat(chunks, requestBytes);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("FADENO_BUILD_CHILD_REQUEST"); }
  const root = plain(value);
  if (!root || JSON.stringify(Object.keys(root).sort(compareText)) !== JSON.stringify([
    "environmentSha256", "generation", "projectRoot", "runtimeClosures", "schemaVersion", "stageRoot",
  ])) fail("FADENO_BUILD_CHILD_REQUEST");
  if (
    root["schemaVersion"] !== 1 || !Number.isSafeInteger(root["generation"]) ||
    (root["generation"] as number) < 1 || typeof root["projectRoot"] !== "string" ||
    typeof root["stageRoot"] !== "string" || typeof root["environmentSha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(root["environmentSha256"] as string) || !Array.isArray(root["runtimeClosures"]) ||
    root["runtimeClosures"].length === 0 || root["runtimeClosures"].length > 8
  ) fail("FADENO_BUILD_CHILD_REQUEST");
  const runtimeClosures = root["runtimeClosures"].map((entry) => {
    const closure = plain(entry);
    if (!closure || Object.keys(closure).length !== 2 || typeof closure["root"] !== "string" || !plain(closure["identity"])) {
      fail("FADENO_BUILD_CHILD_REQUEST");
    }
    return Object.freeze({ root: closure["root"], identity: closure["identity"] as PrivateRuntimeIdentity });
  });
  return Object.freeze({
    schemaVersion: 1,
    generation: root["generation"] as number,
    projectRoot: root["projectRoot"] as string,
    stageRoot: root["stageRoot"] as string,
    environmentSha256: root["environmentSha256"] as string,
    runtimeClosures: Object.freeze(runtimeClosures),
  });
}

function ownedRoot(path: string, code: string): string {
  const logical = resolve(path);
  try {
    const metadata = lstatSync(logical);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail(code);
    return realpathSync(logical);
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    fail(code);
  }
}

function ensureOwnedDirectory(root: string, path: string): void {
  if (!contained(root, path)) fail("FADENO_BUILD_CHILD_STAGE");
  if (!existsSync(path)) mkdirSync(path);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(path) !== path) {
    fail("FADENO_BUILD_CHILD_STAGE");
  }
}

function prepareStage(projectRoot: string, requestedStage: string, generation: number): string {
  const state = join(projectRoot, ".fadeno");
  const stages = join(state, "build-stage");
  const stage = join(stages, `generation-${generation}`);
  if (resolve(requestedStage) !== stage) fail("FADENO_BUILD_CHILD_STAGE");
  ensureOwnedDirectory(projectRoot, state);
  ensureOwnedDirectory(projectRoot, stages);
  if (existsSync(stage)) {
    const metadata = lstatSync(stage);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || realpathSync(stage) !== stage) {
      fail("FADENO_BUILD_CHILD_STAGE");
    }
    rmSync(stage, { recursive: true });
  }
  mkdirSync(stage);
  return stage;
}

function readStableBoundedFile(path: string, maximumBytes: number, code: string): Buffer {
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maximumBytes) fail(code);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength !== before.size || after.isSymbolicLink() || !after.isFile() ||
    after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
  ) fail(code);
  return bytes;
}

async function structuredDiagnostics(projectRoot: string): Promise<Readonly<{
  diagnostics: readonly StructuredDiagnostic[];
  programFiles: readonly string[];
  projectFiles: readonly string[];
}>> {
  const { API } = await import("typescript/unstable/sync");
  const api = new API({ cwd: projectRoot });
  const config = join(projectRoot, "tsconfig.json");
  const snapshot = api.updateSnapshot({ openProjects: [{ uri: pathToFileURL(config).href }] });
  try {
    const projects = snapshot.getProjects();
    if (projects.length !== 1) fail("FADENO_BUILD_CHILD_COMPILER");
    const program = projects[0]!.program;
    const groups = [
      program.getConfigFileParsingDiagnostics(),
      program.getGlobalDiagnostics(),
      program.getSyntacticDiagnostics(),
      program.getSemanticDiagnostics(),
    ];
    if (groups.reduce((count, group) => count + group.length, 0) > maximumDiagnostics) {
      fail("FADENO_BUILD_CHILD_DIAGNOSTIC_LIMIT");
    }
    const raw = groups.flat() as readonly Readonly<{
      code: number;
      category: number;
      fileName?: string;
      pos?: number;
      end?: number;
      text: string;
    }>[];
    let diagnosticBytes = 0;
    const diagnostics = raw.map((diagnostic): StructuredDiagnostic => {
      diagnosticBytes += Buffer.byteLength(diagnostic.text);
      if (diagnosticBytes > maximumDiagnosticBytes) fail("FADENO_BUILD_CHILD_DIAGNOSTIC_LIMIT");
      const canonical = diagnostic.fileName && existsSync(diagnostic.fileName) ? realpathSync(diagnostic.fileName) : null;
      return Object.freeze({
        code: diagnostic.code,
        category: diagnostic.category,
        file: canonical && contained(projectRoot, canonical)
          ? relative(projectRoot, canonical).split("\\").join("/")
          : null,
        start: Number.isSafeInteger(diagnostic.pos) && diagnostic.pos! >= 0 ? diagnostic.pos! : null,
        end: Number.isSafeInteger(diagnostic.end) && diagnostic.end! >= 0 ? diagnostic.end! : null,
        rangeReason: Number.isSafeInteger(diagnostic.pos) && diagnostic.pos! >= 0 ? null : "global",
        text: diagnostic.text,
      });
    }).sort((left, right) =>
      compareText(left.file ?? "", right.file ?? "") || (left.start ?? -1) - (right.start ?? -1) || left.code - right.code
    );
    const programFileNames = program.getSourceFileNames();
    if (programFileNames.length === 0 || programFileNames.length > maximumCompilerFiles) {
      fail("FADENO_BUILD_CHILD_COMPILER_INPUT_LIMIT");
    }
    const programFiles = programFileNames.map((path) => realpathSync(path)).sort(compareText);
    const projectFiles: string[] = [];
    for (const path of programFiles) {
      if (!contained(projectRoot, path)) continue;
      const relativePath = relative(projectRoot, path).split("\\").join("/");
      if (relativePath.startsWith("dist/") || relativePath.startsWith(".fadeno/build-stage/")) {
        fail("FADENO_BUILD_CHILD_COMPILER_INPUT");
      }
      const source = program.getSourceFile(path);
      const current = readStableBoundedFile(path, maximumSourceFileBytes, "FADENO_BUILD_CHILD_INPUT").toString("utf8");
      if (!source || source.text !== current) fail("FADENO_BUILD_CHILD_STALE_INPUT");
      projectFiles.push(relativePath);
    }
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      programFiles: Object.freeze(programFiles),
      projectFiles: Object.freeze(projectFiles),
    });
  } finally {
    snapshot.dispose();
    api.close();
  }
}

function outputPaths(
  root: string,
  directory = root,
  budget = { entries: 0, pathBytes: 0 },
  paths: string[] = [],
): string[] {
  const handle = opendirSync(directory);
  const entries = [];
  try {
    for (;;) {
      const entry = handle.readSync();
      if (!entry) break;
      entries.push(entry);
      if (entries.length > maximumTraversalEntries - budget.entries) fail("FADENO_BUILD_CHILD_OUTPUT_LIMIT");
    }
  } finally {
    handle.closeSync();
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    budget.entries += 1;
    budget.pathBytes += Buffer.byteLength(relativePath);
    if (budget.entries > maximumTraversalEntries || budget.pathBytes > maximumTraversalPathBytes) {
      fail("FADENO_BUILD_CHILD_OUTPUT_LIMIT");
    }
    if (entry.isSymbolicLink()) fail("FADENO_BUILD_CHILD_OUTPUT");
    if (entry.isDirectory()) outputPaths(root, path, budget, paths);
    else if (entry.isFile()) paths.push(relativePath);
    else fail("FADENO_BUILD_CHILD_OUTPUT");
  }
  return paths;
}

function runtimePackageNames(stageRoot: string, paths: readonly string[]): readonly string[] {
  const packages = new Set<string>();
  const emittedPaths = new Set(paths);
  let references = 0;
  const record = (importer: string, specifier: string): void => {
    references += 1;
    if (references > maximumRuntimeReferences || specifier.length === 0 || specifier.includes("\0")) {
      fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
    }
    if (specifier.startsWith("node:") || specifier === "fadeno:routes") return;
    if (specifier.startsWith(".")) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
      const target = resolve(dirname(join(stageRoot, importer)), specifier);
      if (!contained(stageRoot, target)) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
      const targetPath = relative(stageRoot, target).split("\\").join("/");
      if (!emittedPaths.has(targetPath)) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
      return;
    }
    if (specifier.startsWith("/") || specifier.startsWith("file:") || specifier.startsWith("#")) {
      fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
    }
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
    if (
      name.length === 0 || name.length > 214 ||
      !/^(?:@[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/u.test(name)
    ) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
    packages.add(name);
  };
  for (const path of paths) {
    if (!/\.(?:c|m)?js$/u.test(path)) continue;
    const source = readStableBoundedFile(join(stageRoot, path), maximumSourceFileBytes, "FADENO_BUILD_CHILD_OUTPUT").toString("utf8");
    const scanner = createScanner(true, undefined, source);
    const tokens: Array<Readonly<{ kind: SyntaxKind; value: string }>> = [];
    for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
      tokens.push(Object.freeze({ kind, value: scanner.getTokenValue() }));
      if (tokens.length > maximumRuntimeTokens) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
    }
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token?.kind === SyntaxKind.ImportKeyword) {
        const next = tokens[index + 1];
        if (next?.kind === SyntaxKind.DotToken) continue;
        if (next?.kind === SyntaxKind.OpenParenToken) {
          const value = tokens[index + 2];
          if (value?.kind !== SyntaxKind.StringLiteral && value?.kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
            fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
          }
          record(path, value.value);
          continue;
        }
        if (next?.kind === SyntaxKind.StringLiteral) { record(path, next.value); continue; }
        let braces = 0;
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
          const candidate = tokens[cursor];
          if (!candidate) break;
          if (candidate.kind === SyntaxKind.OpenBraceToken) braces += 1;
          if (candidate.kind === SyntaxKind.CloseBraceToken) braces -= 1;
          if (braces === 0 && candidate.kind === SyntaxKind.SemicolonToken) break;
          if (braces === 0 && candidate.kind === SyntaxKind.FromKeyword) {
            const value = tokens[cursor + 1];
            if (value?.kind !== SyntaxKind.StringLiteral) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
            record(path, value.value);
            break;
          }
        }
      }
      if (token?.kind === SyntaxKind.ExportKeyword) {
        let braces = 0;
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
          const candidate = tokens[cursor];
          if (!candidate) break;
          if (candidate.kind === SyntaxKind.OpenBraceToken) braces += 1;
          if (candidate.kind === SyntaxKind.CloseBraceToken) braces -= 1;
          if (braces === 0 && candidate.kind === SyntaxKind.SemicolonToken) break;
          if (braces === 0 && candidate.kind === SyntaxKind.FromKeyword) {
            const value = tokens[cursor + 1];
            if (value?.kind !== SyntaxKind.StringLiteral) fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
            record(path, value.value);
            break;
          }
        }
      }
      if (
        (token?.kind === SyntaxKind.RequireKeyword || (token?.kind === SyntaxKind.Identifier && token.value === "require")) &&
        tokens[index + 1]?.kind === SyntaxKind.OpenParenToken
      ) {
        const value = tokens[index + 2];
        if (value?.kind !== SyntaxKind.StringLiteral && value?.kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
          fail("FADENO_BUILD_CHILD_RUNTIME_IMPORT");
        }
        record(path, value.value);
      }
    }
  }
  return Object.freeze([...packages].sort(compareText));
}

function assertCompilerOwnership(
  programFiles: readonly string[],
  projectRoot: string,
  dependencyRoots: readonly string[],
  closures: readonly RuntimeClosure[],
): void {
  const dependencyRootSet = new Set(dependencyRoots.map((root) => realpathSync(resolve(root))));
  const dependencyOwns = (file: string): boolean => {
    let directory = dirname(file);
    for (;;) {
      if (dependencyRootSet.has(directory)) return true;
      const parent = dirname(directory);
      if (parent === directory) return false;
      directory = parent;
    }
  };
  const ownership = closures.map((closure) => Object.freeze({
    root: realpathSync(resolve(closure.root)),
    paths: new Set(closure.identity.files.map(({ path }) => path)),
  }));
  for (const file of programFiles) {
    if (contained(projectRoot, file)) continue;
    if (dependencyOwns(file)) continue;
    const owner = ownership.find(({ root }) => contained(root, file));
    const path = owner ? relative(owner.root, file).split("\\").join("/") : null;
    if (!owner || !path || !owner.paths.has(path)) fail("FADENO_BUILD_CHILD_COMPILER_INPUT");
  }
}

function emit(projectRoot: string, stageRoot: string): void {
  const require = createRequire(import.meta.url);
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
  const result = spawnSync(process.execPath, [compiler, "-p", join(projectRoot, "tsconfig.json"),
    "--outDir", stageRoot, "--rootDir", projectRoot, "--noCheck", "--pretty", "false", "--incremental", "false"], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: maximumCompilerOutputBytes,
  });
  if (result.error || result.status !== 0 || result.signal !== null) fail("FADENO_BUILD_CHILD_EMIT");
}

async function main(): Promise<void> {
  const input = request();
  const projectRoot = ownedRoot(input.projectRoot, "FADENO_BUILD_CHILD_PROJECT");
  if (resolve(input.projectRoot) !== projectRoot) fail("FADENO_BUILD_CHILD_PROJECT");
  for (const closure of input.runtimeClosures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
  const environment = capturePrivateEnvironment(projectRoot, process.env);
  if (environment.sha256 !== input.environmentSha256) fail("FADENO_BUILD_CHILD_ENVIRONMENT");
  const configPath = join(projectRoot, "tsconfig.json");
  const configBytes = readStableBoundedFile(configPath, maximumRequestBytes, "FADENO_BUILD_CHILD_TSCONFIG");
  let config: unknown;
  try { config = JSON.parse(configBytes.toString("utf8")); } catch { fail("FADENO_BUILD_CHILD_TSCONFIG"); }
  assertPrivateBuildCompilerContract(config);
  const stageRoot = prepareStage(projectRoot, input.stageRoot, input.generation);
  const dependencyBefore = await capturePrivateCompilerDependencyRoots(
    projectRoot,
    `build-generation-${input.generation}`,
  );
  const analysis = await structuredDiagnostics(projectRoot);
  const dependencyAfterAnalysis = await capturePrivateCompilerDependencyRoots(
    projectRoot,
    `build-generation-${input.generation}`,
  );
  if (dependencyAfterAnalysis.sha256 !== dependencyBefore.sha256) fail("FADENO_BUILD_CHILD_STALE_INPUT");
  assertCompilerOwnership(analysis.programFiles, projectRoot, dependencyBefore.roots, input.runtimeClosures);
  const sourcePaths = new Set(analysis.projectFiles);
  for (const path of ["tsconfig.json", "package.json", "fadeno.config.ts", ".env", ".env.local"]) {
    if (existsSync(join(projectRoot, path))) sourcePaths.add(path);
  }
  const ownedSourcePaths = Object.freeze([...sourcePaths].sort(compareText));
  const before = capturePrivateRuntimeIdentity(projectRoot, ownedSourcePaths);
  if (!readStableBoundedFile(configPath, maximumRequestBytes, "FADENO_BUILD_CHILD_TSCONFIG").equals(configBytes)) {
    fail("FADENO_BUILD_CHILD_STALE_INPUT");
  }
  if (analysis.diagnostics.length > 0) {
    for (const closure of input.runtimeClosures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
    if (capturePrivateEnvironment(projectRoot, process.env).sha256 !== environment.sha256) {
      fail("FADENO_BUILD_CHILD_ENVIRONMENT");
    }
    rmSync(stageRoot, { recursive: true });
    process.stdout.write(`${JSON.stringify(Object.freeze({
      schemaVersion: 1,
      generation: input.generation,
      status: "diagnostics",
      environmentSha256: environment.sha256,
      inputSha256: before.sha256,
      input: before,
      compilerDependenciesSha256: dependencyBefore.sha256,
      diagnostics: analysis.diagnostics,
    }))}\n`);
    return;
  }
  emit(projectRoot, stageRoot);
  const after = capturePrivateRuntimeIdentity(projectRoot, ownedSourcePaths);
  if (after.sha256 !== before.sha256) fail("FADENO_BUILD_CHILD_STALE_INPUT");
  if ((await capturePrivateCompilerDependencyRoots(
    projectRoot,
    `build-generation-${input.generation}`,
  )).sha256 !== dependencyBefore.sha256) fail("FADENO_BUILD_CHILD_STALE_INPUT");
  for (const closure of input.runtimeClosures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
  if (capturePrivateEnvironment(projectRoot, process.env).sha256 !== environment.sha256) fail("FADENO_BUILD_CHILD_ENVIRONMENT");
  const emittedPaths = outputPaths(stageRoot);
  const runtimePackages = runtimePackageNames(stageRoot, emittedPaths);
  const output = capturePrivateRuntimeIdentity(stageRoot, emittedPaths);
  const operationSha256 = createHash("sha256").update(JSON.stringify({
    generation: input.generation,
    environment: environment.sha256,
    input: after.sha256,
    output: output.sha256,
    runtime: input.runtimeClosures.map(({ identity }) => identity.sha256),
  })).digest("hex");
  process.stdout.write(`${JSON.stringify(Object.freeze({
    schemaVersion: 1,
    generation: input.generation,
    status: "emitted",
    environmentSha256: environment.sha256,
    inputSha256: after.sha256,
    input: after,
    compilerDependenciesSha256: dependencyBefore.sha256,
    runtimePackages,
    output,
    operationSha256,
    diagnostics: Object.freeze([]),
  }))}\n`);
}

try { await main(); } catch (error) {
  const identity = error instanceof Error && /^FADENO_/u.test(error.message) ? error.message : "FADENO_BUILD_CHILD_INTERNAL";
  process.stderr.write(`${identity}\n`);
  process.exitCode = 3;
}
