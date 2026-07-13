import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { version as compilerVersion } from "typescript";

import { formatAnalyzerDiagnosticBatchHuman } from "./analyzer-diagnostics.ts";
import { PrivateCompilerValidationError } from "./analyzer-compiler.ts";
import { PrivateProjectAnalyzer, type PrivateProjectRefresh } from "./analyzer-project.ts";
import {
  capturePrivateEnvironment,
  capturePrivateRuntimeIdentity,
  parsePrivateBuildDevArguments,
  type PrivateEnvironmentSnapshot,
  type PrivateRuntimeIdentity,
} from "./build-dev-decision.ts";
import { AnalyzerRootError } from "./analyzer-session.ts";
import { FadenoDiagnosticError, formatDiagnosticHuman } from "./diagnostic.ts";

const packageName = "fadeno-framework-internal";
const maximumChildOutputBytes = 8 * 1024 * 1024;
const maximumOutputFiles = 4_096;
const maximumOutputPathBytes = 1024 * 1024;

type StructuredCompilerDiagnostic = Readonly<{
  code: number;
  category: number;
  file: string | null;
  start: number | null;
  end: number | null;
  rangeReason: "global" | null;
  text: string;
}>;

type GenerationResult = Readonly<{
  schemaVersion: 1;
  generation: number;
  status: "diagnostics" | "emitted";
  environmentSha256: string;
  inputSha256: string;
  diagnostics: readonly StructuredCompilerDiagnostic[];
  output?: PrivateRuntimeIdentity;
  operationSha256?: string;
}>;

type RuntimeClosure = Readonly<{ root: string; identity: PrivateRuntimeIdentity }>;

export interface ProjectBuildCommandResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProjectBuildCommandContext {
  readonly cwd: string;
  readonly processEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly createIncidentId?: () => string;
  readonly beforeAcceptStage?: (stageRoot: string) => void;
}

const usage = "FADENO_BUILD_USAGE: fadeno build --project-root <path>\n";

function fail(code: string): never { throw new TypeError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function ownedDirectory(path: string, code: string): string {
  try {
    const logical = resolve(path);
    const status = lstatSync(logical);
    if (status.isSymbolicLink() || !status.isDirectory()) fail(code);
    const canonical = realpathSync(logical);
    if (canonical !== logical) fail(code);
    return canonical;
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    fail(code);
  }
}

function identityPaths(
  root: string,
  directory = root,
  budget = { entries: 0, pathBytes: 0 },
  result: string[] = [],
): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    budget.entries += 1;
    budget.pathBytes += Buffer.byteLength(relativePath);
    if (budget.entries > maximumOutputFiles || budget.pathBytes > maximumOutputPathBytes) fail("FADENO_BUILD_OUTPUT_LIMIT");
    if (entry.isSymbolicLink()) fail("FADENO_BUILD_OUTPUT_OWNERSHIP");
    if (entry.isDirectory()) identityPaths(root, path, budget, result);
    else if (entry.isFile()) result.push(relativePath);
    else fail("FADENO_BUILD_OUTPUT_OWNERSHIP");
  }
  return result;
}

function runtimeClosures(): readonly RuntimeClosure[] {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const frameworkRoot = ownedDirectory(resolve(moduleDirectory, "../.."), "FADENO_BUILD_RUNTIME_IDENTITY");
  const require = createRequire(import.meta.url);
  const typescriptRoot = ownedDirectory(dirname(require.resolve("typescript/package.json")), "FADENO_BUILD_RUNTIME_IDENTITY");
  const typescriptRequire = createRequire(join(typescriptRoot, "package.json"));
  const executableRoot = ownedDirectory(dirname(typescriptRequire.resolve(
    `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
  )), "FADENO_BUILD_RUNTIME_IDENTITY");
  return Object.freeze([frameworkRoot, typescriptRoot, executableRoot].map((root) => Object.freeze({
    root,
    identity: capturePrivateRuntimeIdentity(root, identityPaths(root)),
  })));
}

function parseGenerationResult(output: string, generation: number): GenerationResult {
  let value: unknown;
  try { value = JSON.parse(output); } catch { fail("FADENO_BUILD_CHILD_RESULT"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("FADENO_BUILD_CHILD_RESULT");
  const result = value as Partial<GenerationResult>;
  if (
    result.schemaVersion !== 1 || result.generation !== generation ||
    (result.status !== "diagnostics" && result.status !== "emitted") ||
    typeof result.environmentSha256 !== "string" || typeof result.inputSha256 !== "string" ||
    !Array.isArray(result.diagnostics)
  ) fail("FADENO_BUILD_CHILD_RESULT");
  if (result.status === "emitted" && (!result.output || typeof result.operationSha256 !== "string")) {
    fail("FADENO_BUILD_CHILD_RESULT");
  }
  return Object.freeze(result as GenerationResult);
}

function runGeneration(
  projectRoot: string,
  generation: number,
  environment: PrivateEnvironmentSnapshot,
  closures: readonly RuntimeClosure[],
): GenerationResult {
  const stageRoot = join(projectRoot, ".fadeno", "build-stage", `generation-${generation}`);
  const child = join(dirname(fileURLToPath(import.meta.url)), "build-dev-generation-child.js");
  const request = Object.freeze({
    schemaVersion: 1,
    generation,
    projectRoot,
    stageRoot,
    environmentSha256: environment.sha256,
    runtimeClosures: closures,
  });
  const result = spawnSync(process.execPath, [child], {
    cwd: projectRoot,
    env: environment.values,
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: maximumChildOutputBytes,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    const identity = /^FADENO_[A-Z0-9_]+$/u.exec(result.stderr.trim())?.[0] ?? "FADENO_BUILD_CHILD_INTERNAL";
    fail(identity);
  }
  return parseGenerationResult(result.stdout.trim(), generation);
}

function renderBootstrap(): string {
  return [
    'import { createHash } from "node:crypto";',
    'import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";',
    'import { createRequire } from "node:module";',
    'import { dirname, join, relative } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "const fail = (code) => { throw new Error(code); };",
    "const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;",
    "const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');",
    "const portText = process.env['FADENO_PORT'];",
    "if (!portText || !/^[1-9][0-9]{0,4}$/.test(portText)) fail('FADENO_BUILD_RUNTIME_PORT');",
    "const port = Number(portText);",
    "if (!Number.isSafeInteger(port) || port > 65535) fail('FADENO_BUILD_RUNTIME_PORT');",
    "const distRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));",
    "const manifestPath = join(distRoot, '.fadeno/build-manifest.json');",
    "const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));",
    "if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.runtime?.schemaVersion !== 1) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const walk = (root, directory = root, paths = []) => {",
    "  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {",
    "    const path = join(directory, entry.name);",
    "    if (entry.isSymbolicLink()) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "    if (entry.isDirectory()) walk(root, path, paths);",
    "    else if (entry.isFile()) paths.push(relative(root, path).split('\\\\').join('/'));",
    "    else fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "    if (paths.length > 4096) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "  }",
    "  return paths;",
    "};",
    "const expectedPaths = [...manifest.files.map((file) => file.path), '.fadeno/build-manifest.json'].sort(compare);",
    "if (JSON.stringify(walk(distRoot)) !== JSON.stringify(expectedPaths)) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const verify = (root, identity) => {",
    "  const aggregate = createHash('sha256');",
    "  for (const file of identity.files) {",
    "    const path = join(root, file.path);",
    "    const status = lstatSync(path);",
    "    if (status.isSymbolicLink() || !status.isFile() || realpathSync(path) !== path) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    const bytes = readFileSync(path);",
    "    if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    aggregate.update(`${file.path}\\0${file.bytes}\\0${file.sha256}\\n`);",
    "  }",
    "  if (aggregate.digest('hex') !== identity.sha256) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "};",
    "verify(distRoot, { schemaVersion: 1, files: manifest.files, sha256: manifest.outputSha256 });",
    `const entry = createRequire(import.meta.url).resolve(${JSON.stringify(packageName)});`,
    "const runtimeRoot = realpathSync(dirname(dirname(entry)));",
    "verify(runtimeRoot, manifest.runtime);",
    `const { listenNodeHttp } = await import(${JSON.stringify(`${packageName}/node`)});`,
    "const { handler } = await import('../.fadeno/routes/app.js');",
    "const server = await listenNodeHttp({ handler, hostname: '127.0.0.1', port });",
    "process.stdout.write(`Fadeno production server ready at ${server.origin}.\\n`);",
    "let stopping = false;",
    "const stop = async () => { if (stopping) return; stopping = true; await server.close(); };",
    "process.once('SIGTERM', () => { void stop(); });",
    "process.once('SIGINT', () => { void stop(); });",
    "",
  ].join("\n");
}

function prepareManifest(
  projectRoot: string,
  generation: GenerationResult,
  refresh: PrivateProjectRefresh,
  frameworkRuntime: PrivateRuntimeIdentity,
): PrivateRuntimeIdentity {
  const stageRoot = join(projectRoot, ".fadeno", "build-stage", `generation-${generation.generation}`);
  const bootstrap = join(stageRoot, "server", "bootstrap.js");
  const manifestPath = join(stageRoot, ".fadeno", "build-manifest.json");
  if (existsSync(bootstrap) || existsSync(manifestPath)) fail("FADENO_BUILD_OUTPUT_CONFLICT");
  mkdirSync(dirname(bootstrap), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(bootstrap, renderBootstrap());
  const output = capturePrivateRuntimeIdentity(stageRoot, identityPaths(stageRoot));
  const manifest = Object.freeze({
    schemaVersion: 1,
    framework: packageName,
    compilerVersion,
    environmentSha256: generation.environmentSha256,
    inputSha256: generation.inputSha256,
    generationSha256: generation.operationSha256,
    artifactSourceSha256: refresh.compiler.artifactSourceSha256,
    artifacts: refresh.publication.artifacts.length,
    files: output.files,
    outputSha256: output.sha256,
    runtime: frameworkRuntime,
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return capturePrivateRuntimeIdentity(stageRoot, identityPaths(stageRoot));
}

function assertOrdinaryTree(path: string): void {
  ownedDirectory(path, "FADENO_BUILD_OUTPUT_OWNERSHIP");
  identityPaths(path);
}

function recoverBuildTransaction(projectRoot: string): void {
  const state = join(projectRoot, ".fadeno", "build-stage");
  if (!existsSync(state)) return;
  assertOrdinaryTree(state);
  const output = join(projectRoot, "dist");
  const rollback = join(state, "rollback");
  const rejected = join(state, "rejected");
  if (existsSync(rejected)) { assertOrdinaryTree(rejected); rmSync(rejected, { recursive: true }); }
  if (!existsSync(rollback)) return;
  assertOrdinaryTree(rollback);
  if (existsSync(output)) {
    assertOrdinaryTree(output);
    renameSync(output, rejected);
  }
  renameSync(rollback, output);
  if (existsSync(rejected)) rmSync(rejected, { recursive: true });
}

function acceptStage(projectRoot: string, generation: number, expected: PrivateRuntimeIdentity): void {
  const state = join(projectRoot, ".fadeno", "build-stage");
  const stage = join(state, `generation-${generation}`);
  const output = join(projectRoot, "dist");
  const rollback = join(state, "rollback");
  const rejected = join(state, "rejected");
  if (existsSync(rollback) || existsSync(rejected)) fail("FADENO_BUILD_TRANSACTION_STATE");
  assertOrdinaryTree(stage);
  let previous = false;
  if (existsSync(output)) {
    assertOrdinaryTree(output);
    renameSync(output, rollback);
    previous = true;
  }
  try {
    renameSync(stage, output);
    const accepted = capturePrivateRuntimeIdentity(output, identityPaths(output));
    if (accepted.sha256 !== expected.sha256) fail("FADENO_BUILD_OUTPUT_STALE");
    if (previous) rmSync(rollback, { recursive: true });
  } catch (error) {
    if (existsSync(output)) renameSync(output, rejected);
    if (previous && existsSync(rollback)) renameSync(rollback, output);
    if (existsSync(rejected)) rmSync(rejected, { recursive: true });
    throw error;
  }
}

function formatCompilerDiagnostics(diagnostics: readonly StructuredCompilerDiagnostic[], projectRoot: string): string {
  const lines = [`FADENO_BUILD_TYPESCRIPT: TypeScript reported ${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}.`];
  for (const diagnostic of diagnostics) {
    const location = diagnostic.file === null
      ? diagnostic.rangeReason ?? "global"
      : `${diagnostic.file}:${diagnostic.start ?? "?"}-${diagnostic.end ?? "?"}`;
    lines.push(`  TS${diagnostic.code} ${location}: ${diagnostic.text.replaceAll(projectRoot, "<project>")}`);
  }
  return `${lines.join("\n")}\n`;
}

function rootFailure(error: AnalyzerRootError): string {
  const summary = error.code === "FADENO_ANALYZER_ROOT_MISSING"
    ? "Project root does not exist."
    : error.code === "FADENO_ANALYZER_ROOT_OWNERSHIP"
      ? "Project root must be one owned, non-symlink directory."
      : "Project root must be an absolute path.";
  return `${error.code}: ${summary}\n`;
}

export async function runProjectBuildCommand(
  arguments_: readonly string[],
  context: ProjectBuildCommandContext,
): Promise<ProjectBuildCommandResult> {
  const parsed = parsePrivateBuildDevArguments(arguments_, context.cwd);
  if (!parsed || parsed.command !== "build") return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });
  const projectRoot = parsed.projectRoot;
  let analyzer: PrivateProjectAnalyzer | null = null;
  try {
    analyzer = new PrivateProjectAnalyzer(projectRoot);
    recoverBuildTransaction(projectRoot);
    const environment = capturePrivateEnvironment(projectRoot, context.processEnvironment ?? process.env);
    const closures = runtimeClosures();
    const preliminary = await analyzer.analyze().result;
    if (preliminary.diagnostics.diagnostics.length > 0) {
      return Object.freeze({
        exitCode: 1 as const,
        stdout: "",
        stderr: formatAnalyzerDiagnosticBatchHuman(preliminary.diagnostics),
      });
    }
    const compilerDiagnostics: { current: GenerationResult | null } = { current: null };
    let refresh: PrivateProjectRefresh;
    try {
      refresh = await analyzer.refresh({
        onCompilerDiagnostic: () => { compilerDiagnostics.current = runGeneration(projectRoot, 1, environment, closures); },
      }).result;
    } catch (error) {
      if (
        error instanceof PrivateCompilerValidationError &&
        error.code === "FADENO_ANALYZER_COMPILER_DIAGNOSTIC" &&
        compilerDiagnostics.current?.status === "diagnostics"
      ) {
        return Object.freeze({
          exitCode: 1 as const,
          stdout: "",
          stderr: formatCompilerDiagnostics(compilerDiagnostics.current.diagnostics, projectRoot),
        });
      }
      throw error;
    }
    const generation = runGeneration(projectRoot, 1, environment, closures);
    if (generation.status !== "emitted") {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: formatCompilerDiagnostics(generation.diagnostics, projectRoot) });
    }
    const complete = prepareManifest(projectRoot, generation, refresh, closures[0]!.identity);
    context.beforeAcceptStage?.(join(projectRoot, ".fadeno", "build-stage", "generation-1"));
    acceptStage(projectRoot, 1, complete);
    const fileCount = complete.files.length;
    return Object.freeze({
      exitCode: 0 as const,
      stdout: `Fadeno production build completed: ${fileCount} files written to dist.\n`,
      stderr: "",
    });
  } catch (error) {
    if (error instanceof FadenoDiagnosticError) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: formatDiagnosticHuman(error) });
    }
    if (error instanceof AnalyzerRootError) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: rootFailure(error) });
    }
    if (error instanceof PrivateCompilerValidationError || (error instanceof TypeError && /^FADENO_/u.test(error.message))) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: `${error.message}\n` });
    }
    const incident = context.createIncidentId?.() ?? randomUUID();
    return Object.freeze({
      exitCode: 3 as const,
      stdout: "",
      stderr: `FADENO_BUILD_INTERNAL: Production build could not complete.\n  incident: ${incident}\n`,
    });
  } finally {
    if (analyzer) {
      try {
        await analyzer.close();
      } catch {
        const incident = context.createIncidentId?.() ?? randomUUID();
        return Object.freeze({
          exitCode: 3 as const,
          stdout: "",
          stderr: `FADENO_BUILD_INTERNAL: Production build could not complete.\n  incident: ${incident}\n`,
        });
      }
    }
  }
}
