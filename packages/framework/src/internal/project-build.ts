import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { version as compilerVersion } from "typescript";

import { formatAnalyzerDiagnosticBatchHuman } from "./analyzer-diagnostics.ts";
import { capturePrivateCompilerDependencyRoots, PrivateCompilerValidationError } from "./analyzer-compiler.ts";
import { PrivateProjectAnalyzer, type PrivateProjectRefresh } from "./analyzer-project.ts";
import {
  capturePrivateEnvironment,
  capturePrivateRuntimeIdentity,
  assertPrivateRuntimeIdentity,
  parsePrivateBuildDevArguments,
  type PrivateEnvironmentSnapshot,
  type PrivateRuntimeIdentity,
} from "./build-dev-decision.ts";
import { AnalyzerRootError } from "./analyzer-session.ts";
import { FadenoDiagnosticError, formatDiagnosticHuman } from "./diagnostic.ts";

const packageName = "fadeno-framework-internal";
const maximumChildOutputBytes = 8 * 1024 * 1024;
const maximumGenerationRequestBytes = 256 * 1024;
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
  input: PrivateRuntimeIdentity;
  compilerDependenciesSha256: string;
  diagnostics: readonly StructuredCompilerDiagnostic[];
  runtimePackages?: readonly string[];
  output?: PrivateRuntimeIdentity;
  operationSha256?: string;
}>;

type RuntimeClosure = Readonly<{ root: string; identity: PrivateRuntimeIdentity }>;
type DependencyClosure = RuntimeClosure & Readonly<{ name: string; path: string }>;

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
const maximumRuntimePackages = 256;
const maximumRuntimeFiles = 16_384;
const maximumRuntimeBytes = 512 * 1024 * 1024;
const maximumBuildManifestBytes = 4 * 1024 * 1024;
const maximumPackageManifestBytes = 1024 * 1024;

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

function contained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function boundedDirectoryEntries(directory: string, remaining: number, code: string): Dirent<string>[] {
  const handle = opendirSync(directory);
  const entries: Dirent<string>[] = [];
  try {
    for (;;) {
      const entry = handle.readSync();
      if (!entry) break;
      entries.push(entry);
      if (entries.length > remaining) fail(code);
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort((left, right) => compareText(left.name, right.name));
}

function identityPaths(
  root: string,
  directory = root,
  budget = { entries: 0, pathBytes: 0 },
  result: string[] = [],
  skipRootNodeModules = false,
): string[] {
  for (const entry of boundedDirectoryEntries(directory, maximumOutputFiles - budget.entries, "FADENO_BUILD_OUTPUT_LIMIT")) {
    if (skipRootNodeModules && directory === root && entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    budget.entries += 1;
    budget.pathBytes += Buffer.byteLength(relativePath);
    if (budget.entries > maximumOutputFiles || budget.pathBytes > maximumOutputPathBytes) fail("FADENO_BUILD_OUTPUT_LIMIT");
    if (entry.isSymbolicLink()) fail("FADENO_BUILD_OUTPUT_OWNERSHIP");
    if (entry.isDirectory()) identityPaths(root, path, budget, result, skipRootNodeModules);
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
    identity: capturePrivateRuntimeIdentity(root, identityPaths(root, root, { entries: 0, pathBytes: 0 }, [], true)),
  })));
}

function acquireBuildLock(projectRoot: string): () => void {
  const internalRoot = join(projectRoot, ".fadeno");
  try {
    if (!existsSync(internalRoot)) mkdirSync(internalRoot);
    ownedDirectory(internalRoot, "FADENO_BUILD_TRANSACTION_STATE");
    const lock = join(internalRoot, "build-lock");
    const identity = `fadeno-build-lock:v1:${process.pid}:${randomUUID()}`;
    const candidate = `${lock}.owner-${process.pid}-${randomUUID()}`;
    writeFileSync(candidate, identity, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          linkSync(candidate, lock);
          unlinkSync(candidate);
          return () => {
            const status = lstatSync(lock);
            if (status.isSymbolicLink() || !status.isFile() || status.size > 256 || readFileSync(lock, "utf8") !== identity) {
              fail("FADENO_BUILD_TRANSACTION_STATE");
            }
            unlinkSync(lock);
          };
        } catch {
          if (!existsSync(lock)) continue;
          const status = lstatSync(lock);
          if (status.isSymbolicLink() || !status.isFile() || status.size > 256) fail("FADENO_BUILD_TRANSACTION_STATE");
          const current = readFileSync(lock, "utf8");
          const match = /^fadeno-build-lock:v1:([1-9][0-9]*):[a-f0-9-]+$/u.exec(current);
          if (!match) fail("FADENO_BUILD_TRANSACTION_STATE");
          const pid = Number(match[1]);
          let alive = true;
          try { process.kill(pid, 0); } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === "ESRCH") alive = false;
            else if ((cause as NodeJS.ErrnoException).code !== "EPERM") fail("FADENO_BUILD_TRANSACTION_STATE");
          }
          if (alive) fail("FADENO_BUILD_CONCURRENT");
          const stale = `${lock}.stale-${randomUUID()}`;
          try { renameSync(lock, stale); } catch { continue; }
          const staleStatus = lstatSync(stale);
          if (staleStatus.isSymbolicLink() || !staleStatus.isFile() || readFileSync(stale, "utf8") !== current) {
            fail("FADENO_BUILD_TRANSACTION_STATE");
          }
          unlinkSync(stale);
        }
      }
    } finally {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
    fail("FADENO_BUILD_TRANSACTION_STATE");
  } catch (error) {
    if (error instanceof TypeError && /^FADENO_/u.test(error.message)) throw error;
    fail("FADENO_BUILD_TRANSACTION_STATE");
  }
}

async function captureRuntimeDependencies(projectRoot: string): Promise<Readonly<{
  closures: readonly DependencyClosure[];
  ownershipSha256: string;
}>> {
  const document = (root: string): Record<string, unknown> => {
    try {
      const path = join(root, "package.json");
      const before = lstatSync(path);
      if (
        before.isSymbolicLink() || !before.isFile() || before.size > maximumPackageManifestBytes ||
        realpathSync(path) !== path
      ) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      const bytes = readFileSync(path);
      const after = lstatSync(path);
      if (
        after.isSymbolicLink() || !after.isFile() || bytes.byteLength !== before.size ||
        after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || realpathSync(path) !== path
      ) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof TypeError && error.message === "FADENO_BUILD_RUNTIME_CLOSURE") throw error;
      fail("FADENO_BUILD_RUNTIME_CLOSURE");
    }
  };
  const names = (value: unknown): readonly string[] => {
    if (value === undefined) return Object.freeze([]);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("FADENO_BUILD_RUNTIME_CLOSURE");
    const entries = Object.entries(value);
    if (entries.length > maximumRuntimePackages) fail("FADENO_BUILD_RUNTIME_CLOSURE_LIMIT");
    const result = entries.map(([name, requirement]) => {
      if (
        typeof requirement !== "string" || name.length === 0 || name.length > 214 ||
        !/^(?:@[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/u.test(name)
      ) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      return name;
    }).sort(compareText);
    if (new Set(result).size !== result.length) {
      fail("FADENO_BUILD_RUNTIME_CLOSURE");
    }
    return Object.freeze(result);
  };
  const resolveInstalled = (importer: string, name: string, optional: boolean): string | null => {
    let directory = importer;
    const checked = new Set<string>();
    for (;;) {
      if (!contained(projectRoot, directory)) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      const parent = dirname(directory);
      const candidate = basename(directory) === "node_modules"
        ? join(directory, ...name.split("/"))
        : join(directory, "node_modules", ...name.split("/"));
      if (!checked.has(candidate)) {
        checked.add(candidate);
        if (existsSync(candidate)) {
          try {
            const root = realpathSync(candidate);
            if (!contained(projectRoot, root)) fail("FADENO_BUILD_RUNTIME_CLOSURE");
            return root;
          } catch (error) {
            if (error instanceof TypeError && error.message === "FADENO_BUILD_RUNTIME_CLOSURE") throw error;
            fail("FADENO_BUILD_RUNTIME_CLOSURE");
          }
        }
      }
      if (directory === projectRoot) break;
      if (parent === directory) fail("FADENO_BUILD_RUNTIME_CLOSURE");
      directory = parent;
    }
    if (optional) return null;
    fail("FADENO_BUILD_RUNTIME_CLOSURE");
  };
  const rootDocument = document(projectRoot);
  const pending: Array<Readonly<{ root: string; name: string }>> = [];
  const scheduled = new Set<string>();
  const schedule = (importer: string, name: string, optional: boolean): void => {
    const root = resolveInstalled(importer, name, optional);
    if (!root || scheduled.has(root)) return;
    if (scheduled.size >= maximumRuntimePackages) fail("FADENO_BUILD_RUNTIME_CLOSURE_LIMIT");
    scheduled.add(root);
    pending.push(Object.freeze({ root, name }));
  };
  const rootOptional = new Set(names(rootDocument["optionalDependencies"]));
  for (const name of names(rootDocument["dependencies"])) schedule(projectRoot, name, rootOptional.has(name));
  for (const name of rootOptional) schedule(projectRoot, name, true);
  const rootPeerMeta = rootDocument["peerDependenciesMeta"];
  const rootPeerMetaDocument = rootPeerMeta && typeof rootPeerMeta === "object" && !Array.isArray(rootPeerMeta)
    ? rootPeerMeta as Record<string, unknown>
    : Object.create(null) as Record<string, unknown>;
  for (const dependency of names(rootDocument["peerDependencies"])) {
    const metadata = rootPeerMetaDocument[dependency];
    const optionalPeer = metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>)["optional"] === true;
    schedule(projectRoot, dependency, optionalPeer === true);
  }
  const closures: DependencyClosure[] = [];
  let files = 0;
  let bytes = 0;
  const paths = new Set<string>();
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const next = pending[pendingIndex]!;
    const root = next.root;
    const path = relative(projectRoot, root).split("\\").join("/");
    if (path === "" || path.startsWith("../") || paths.has(path)) fail("FADENO_BUILD_RUNTIME_CLOSURE");
    paths.add(path);
    const packageDocument = document(root);
    const name = packageDocument["name"];
    if (name !== next.name) fail("FADENO_BUILD_RUNTIME_CLOSURE");
    const identity = capturePrivateRuntimeIdentity(root, identityPaths(root, root, { entries: 0, pathBytes: 0 }, [], true));
    files += identity.files.length;
    bytes += identity.files.reduce((total, file) => total + file.bytes, 0);
    if (files > maximumRuntimeFiles || bytes > maximumRuntimeBytes) fail("FADENO_BUILD_RUNTIME_CLOSURE_LIMIT");
    closures.push(Object.freeze({ root, path, name: next.name, identity }));
    const optional = new Set(names(packageDocument["optionalDependencies"]));
    for (const dependency of names(packageDocument["dependencies"])) {
      schedule(root, dependency, optional.has(dependency));
    }
    for (const dependency of optional) schedule(root, dependency, true);
    const peerMeta = packageDocument["peerDependenciesMeta"];
    const peerMetaDocument = peerMeta && typeof peerMeta === "object" && !Array.isArray(peerMeta)
      ? peerMeta as Record<string, unknown>
      : Object.create(null) as Record<string, unknown>;
    for (const dependency of names(packageDocument["peerDependencies"])) {
      const metadata = peerMetaDocument[dependency];
      const optionalPeer = metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>)["optional"] === true;
      schedule(root, dependency, optionalPeer === true);
    }
  }
  if (closures.length === 0) fail("FADENO_BUILD_RUNTIME_CLOSURE");
  closures.sort((left, right) => compareText(left.path, right.path));
  const ownership = createHash("sha256");
  for (const closure of closures) ownership.update(`${closure.path}\0${closure.name}\0${closure.identity.sha256}\n`);
  return Object.freeze({ closures: Object.freeze(closures), ownershipSha256: ownership.digest("hex") });
}

async function assertRuntimeDependenciesCurrent(
  projectRoot: string,
  expected: Readonly<{ closures: readonly DependencyClosure[]; ownershipSha256: string }>,
): Promise<void> {
  const current = await captureRuntimeDependencies(projectRoot);
  if (
    current.ownershipSha256 !== expected.ownershipSha256 || current.closures.length !== expected.closures.length ||
    current.closures.some((closure, index) => {
      const prior = expected.closures[index];
      return !prior || closure.path !== prior.path || closure.name !== prior.name || closure.identity.sha256 !== prior.identity.sha256;
    })
  ) fail("FADENO_BUILD_RUNTIME_CLOSURE_STALE");
}

function assertRuntimePackagesDeclared(generation: GenerationResult, dependencies: readonly DependencyClosure[]): void {
  const allowed = new Set(dependencies.map(({ name }) => name));
  for (const name of generation.runtimePackages ?? []) {
    if (!allowed.has(name)) fail("FADENO_BUILD_RUNTIME_IMPORT");
  }
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
    !Array.isArray(result.diagnostics) || !result.input || result.input.sha256 !== result.inputSha256 ||
    typeof result.compilerDependenciesSha256 !== "string"
  ) fail("FADENO_BUILD_CHILD_RESULT");
  if (
    result.status === "emitted" &&
    (!result.output || typeof result.operationSha256 !== "string" || !Array.isArray(result.runtimePackages))
  ) {
    fail("FADENO_BUILD_CHILD_RESULT");
  }
  return Object.freeze(result as GenerationResult);
}

async function assertGenerationFresh(
  projectRoot: string,
  generation: GenerationResult,
  environment: PrivateEnvironmentSnapshot,
  processEnvironment: Readonly<Record<string, string | undefined>>,
  closures: readonly RuntimeClosure[],
): Promise<void> {
  assertPrivateRuntimeIdentity(projectRoot, generation.input);
  if (capturePrivateEnvironment(projectRoot, processEnvironment).sha256 !== environment.sha256) {
    fail("FADENO_BUILD_ENVIRONMENT");
  }
  for (const closure of closures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
  const compilerDependencies = await capturePrivateCompilerDependencyRoots(projectRoot, "production-build-acceptance");
  if (compilerDependencies.sha256 !== generation.compilerDependenciesSha256) fail("FADENO_BUILD_INPUT_STALE");
}

function runGeneration(
  projectRoot: string,
  generation: number,
  environment: PrivateEnvironmentSnapshot,
  closures: readonly RuntimeClosure[],
): GenerationResult {
  const stageRoot = join(projectRoot, ".fadeno", "build-stage", `generation-${generation}`);
  const child = join(dirname(fileURLToPath(import.meta.url)), "build-dev-generation-child.js");
  const request = generationRequest(projectRoot, stageRoot, generation, environment, closures);
  const requestBytes = Buffer.from(JSON.stringify(request));
  if (requestBytes.byteLength === 0 || requestBytes.byteLength > maximumGenerationRequestBytes) {
    fail("FADENO_BUILD_CHILD_REQUEST");
  }
  const requestPath = join(projectRoot, ".fadeno", `build-request-${process.pid}-${randomUUID()}`);
  writeFileSync(requestPath, requestBytes, { flag: "wx", mode: 0o600 });
  const requestStatus = lstatSync(requestPath);
  if (requestStatus.isSymbolicLink() || !requestStatus.isFile() || requestStatus.size !== requestBytes.byteLength) {
    fail("FADENO_BUILD_CHILD_REQUEST");
  }
  let input = -1;
  let result: SpawnSyncReturns<string>;
  try {
    input = openSync(requestPath, "r");
    const opened = fstatSync(input);
    if (
      !opened.isFile() || opened.dev !== requestStatus.dev || opened.ino !== requestStatus.ino ||
      opened.size !== requestStatus.size
    ) fail("FADENO_BUILD_CHILD_REQUEST");
    result = spawnSync(process.execPath, [child], {
      cwd: projectRoot,
      env: environment.values,
      stdio: [input, "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: maximumChildOutputBytes,
    });
  } finally {
    if (input !== -1) closeSync(input);
    const current = lstatSync(requestPath);
    if (
      current.isSymbolicLink() || !current.isFile() || current.dev !== requestStatus.dev ||
      current.ino !== requestStatus.ino || current.size !== requestStatus.size
    ) fail("FADENO_BUILD_CHILD_REQUEST");
    unlinkSync(requestPath);
  }
  if (result.error || result.signal !== null || result.status !== 0) {
    failGenerationChild(result.stderr.trim());
  }
  return parseGenerationResult(result.stdout.trim(), generation);
}

function generationRequest(
  projectRoot: string,
  stageRoot: string,
  generation: number,
  environment: PrivateEnvironmentSnapshot,
  closures: readonly RuntimeClosure[],
): Readonly<{
  schemaVersion: 1;
  generation: number;
  projectRoot: string;
  stageRoot: string;
  environmentSha256: string;
  runtimeClosures: readonly RuntimeClosure[];
}> {
  return Object.freeze({
    schemaVersion: 1,
    generation,
    projectRoot,
    stageRoot,
    environmentSha256: environment.sha256,
    runtimeClosures: closures,
  });
}

function failGenerationChild(stderr: string): never {
  const childIdentity = /^FADENO_[A-Z0-9_]+$/u.exec(stderr)?.[0];
  const identity = childIdentity === "FADENO_BUILD_CHILD_ENVIRONMENT"
    ? "FADENO_BUILD_ENVIRONMENT"
    : childIdentity === "FADENO_BUILD_CHILD_STALE_INPUT"
      ? "FADENO_BUILD_INPUT_STALE"
      : childIdentity === "FADENO_BUILD_CHILD_RUNTIME_IMPORT"
        ? "FADENO_BUILD_RUNTIME_IMPORT"
      : childIdentity ?? "FADENO_BUILD_CHILD_INTERNAL";
  fail(identity);
}

async function runGenerationAsync(
  projectRoot: string,
  generation: number,
  environment: PrivateEnvironmentSnapshot,
  closures: readonly RuntimeClosure[],
  signal: AbortSignal,
): Promise<GenerationResult> {
  signal.throwIfAborted();
  const stageRoot = join(projectRoot, ".fadeno", "build-stage", `generation-${generation}`);
  const childPath = join(dirname(fileURLToPath(import.meta.url)), "build-dev-generation-child.js");
  const request = JSON.stringify(generationRequest(projectRoot, stageRoot, generation, environment, closures));
  const child = spawn(process.execPath, [childPath], {
    cwd: projectRoot,
    env: environment.values,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let outputExceeded = false;
  const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > maximumChildOutputBytes) {
      outputExceeded = true;
      child.kill("SIGKILL");
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  const abort = (): void => { child.kill("SIGKILL"); };
  signal.addEventListener("abort", abort, { once: true });
  const completion = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveChild, rejectChild) => {
    child.once("error", rejectChild);
    child.once("exit", (code, exitSignal) => resolveChild(Object.freeze({ code, signal: exitSignal })));
  });
  child.stdin.end(request);
  try {
    const result = await completion;
    signal.throwIfAborted();
    if (outputExceeded || result.signal !== null || result.code !== 0) failGenerationChild(stderr.trim());
    return parseGenerationResult(stdout.trim(), generation);
  } finally {
    signal.removeEventListener("abort", abort);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      try { await completion; } catch { /* the caller owns the primary failure */ }
    }
  }
}

function renderBootstrap(): string {
  return [
    'import { createHash } from "node:crypto";',
    'import { lstatSync, opendirSync, readFileSync, realpathSync } from "node:fs";',
    'import { dirname, isAbsolute, join, relative } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "const fail = (code) => { throw new Error(code); };",
    "const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;",
    "const hasKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort(compare)) === JSON.stringify(keys);",
    "const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');",
    "const readStable = (path, maximum, code, expected = null) => {",
    "  const before = lstatSync(path);",
    "  if (before.isSymbolicLink() || !before.isFile() || before.size > maximum || (expected !== null && before.size !== expected) || realpathSync(path) !== path) fail(code);",
    "  const bytes = readFileSync(path);",
    "  const after = lstatSync(path);",
    "  if (after.isSymbolicLink() || !after.isFile() || bytes.byteLength !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || realpathSync(path) !== path) fail(code);",
    "  return bytes;",
    "};",
    "try {",
    "const portText = process.env['FADENO_PORT'];",
    "if (!portText || !/^[1-9][0-9]{0,4}$/.test(portText)) fail('FADENO_BUILD_RUNTIME_PORT');",
    "const port = Number(portText);",
    "if (!Number.isSafeInteger(port) || port > 65535) fail('FADENO_BUILD_RUNTIME_PORT');",
    "const distRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));",
    "const manifestPath = join(distRoot, '.fadeno/build-manifest.json');",
    "let manifest;",
    "try { manifest = JSON.parse(readStable(manifestPath, 4194304, 'FADENO_BUILD_RUNTIME_MANIFEST').toString('utf8')); } catch (error) { if (error?.message === 'FADENO_BUILD_RUNTIME_MANIFEST') throw error; fail('FADENO_BUILD_RUNTIME_MANIFEST'); }",
    `const manifestKeys = ${JSON.stringify([
      "artifactSourceSha256", "artifacts", "compilerVersion", "dependencies", "environmentSha256", "files",
      "framework", "generationSha256", "inputSha256", "outputSha256", "runtime", "schemaVersion",
    ])};`,
    `if (!hasKeys(manifest, manifestKeys) || manifest.schemaVersion !== 1 || manifest.framework !== ${JSON.stringify(packageName)} || manifest.compilerVersion !== ${JSON.stringify(compilerVersion)} || !Number.isSafeInteger(manifest.artifacts) || manifest.artifacts < 0 || manifest.artifacts > 4096 || !Array.isArray(manifest.files) || !Array.isArray(manifest.dependencies)) fail('FADENO_BUILD_RUNTIME_MANIFEST');`,
    "for (const name of ['environmentSha256', 'inputSha256', 'generationSha256', 'artifactSourceSha256', 'outputSha256']) if (typeof manifest[name] !== 'string' || !/^[a-f0-9]{64}$/.test(manifest[name])) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const validPath = (path) => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');",
    "if (manifest.files.length === 0 || manifest.files.length > 4096 || !manifest.files.every((file) => file && validPath(file.path))) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const manifestPaths = manifest.files.map((file) => file.path);",
    "if (JSON.stringify(manifestPaths) !== JSON.stringify([...new Set(manifestPaths)].sort(compare))) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const walk = (root, maximumEntries, skipRootNodeModules = false) => {",
    "  let walkedEntries = 0; let walkedPathBytes = 0; const paths = [];",
    "  const visit = (directory) => {",
    "    const handle = opendirSync(directory); const entries = [];",
    "    try { for (;;) { const entry = handle.readSync(); if (!entry) break; if (skipRootNodeModules && directory === root && entry.name === 'node_modules') continue; walkedEntries += 1; if (walkedEntries > maximumEntries) fail('FADENO_BUILD_RUNTIME_IDENTITY'); entries.push(entry); } } finally { handle.closeSync(); }",
    "    entries.sort((a, b) => compare(a.name, b.name));",
    "    for (const entry of entries) {",
    "      const path = join(directory, entry.name); const ownedPath = relative(root, path).split('\\\\').join('/');",
    "      walkedPathBytes += Buffer.byteLength(ownedPath); if (walkedPathBytes > 1048576) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "      if (entry.isSymbolicLink()) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "      if (entry.isDirectory()) visit(path); else if (entry.isFile()) paths.push(ownedPath); else fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    }",
    "  }; visit(root); return paths.sort(compare);",
    "};",
    "const expectedPaths = [...manifest.files.map((file) => file.path), '.fadeno/build-manifest.json'].sort(compare);",
    "if (JSON.stringify(walk(distRoot, 4097)) !== JSON.stringify(expectedPaths)) fail('FADENO_BUILD_RUNTIME_MANIFEST');",
    "const verify = (root, identity, exact = true) => {",
    "  if (!hasKeys(identity, ['files', 'schemaVersion', 'sha256']) || identity.schemaVersion !== 1 || !Array.isArray(identity.files) || identity.files.length === 0 || identity.files.length > 4096 || !/^[a-f0-9]{64}$/.test(identity.sha256)) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "  const identityPaths = identity.files.map((file) => file?.path);",
    "  if (JSON.stringify(identityPaths) !== JSON.stringify([...new Set(identityPaths)].sort(compare))) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "  const aggregate = createHash('sha256'); let total = 0;",
    "  for (const file of identity.files) {",
    "    if (!hasKeys(file, ['bytes', 'path', 'sha256']) || !validPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 67108864 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    total += file.bytes; if (!Number.isSafeInteger(total) || total > 134217728) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    const path = join(root, file.path);",
    "    const bytes = readStable(path, 67108864, 'FADENO_BUILD_RUNTIME_IDENTITY', file.bytes);",
    "    if (digest(bytes) !== file.sha256) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "    aggregate.update(`${file.path}\\0${file.bytes}\\0${file.sha256}\\n`);",
    "  }",
    "  if (aggregate.digest('hex') !== identity.sha256) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "  if (exact && JSON.stringify(walk(root, 4096, true)) !== JSON.stringify(identityPaths)) fail('FADENO_BUILD_RUNTIME_IDENTITY');",
    "  return { files: identity.files.length, bytes: total };",
    "};",
    "verify(distRoot, { schemaVersion: 1, files: manifest.files, sha256: manifest.outputSha256 }, false);",
    `const entry = fileURLToPath(import.meta.resolve(${JSON.stringify(packageName)}));`,
    "const runtimeRoot = realpathSync(dirname(dirname(entry)));",
    "verify(runtimeRoot, manifest.runtime);",
    "const projectRoot = realpathSync(dirname(distRoot));",
    "if (manifest.dependencies.length === 0 || manifest.dependencies.length > 256) fail('FADENO_BUILD_RUNTIME_CLOSURE');",
    "const dependencyPaths = manifest.dependencies.map((closure) => closure?.path);",
    "if (JSON.stringify(dependencyPaths) !== JSON.stringify([...new Set(dependencyPaths)].sort(compare))) fail('FADENO_BUILD_RUNTIME_CLOSURE');",
    "let dependencyFiles = 0; let dependencyBytes = 0;",
    "for (const closure of manifest.dependencies) {",
    "  if (!hasKeys(closure, ['identity', 'name', 'path']) || typeof closure.name !== 'string' || closure.name.length > 214 || !/^(?:@[A-Za-z0-9_~-][A-Za-z0-9._~-]*\\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/.test(closure.name) || !validPath(closure.path)) fail('FADENO_BUILD_RUNTIME_CLOSURE');",
    "  const root = realpathSync(join(projectRoot, closure.path));",
    "  const difference = relative(projectRoot, root);",
    "  if (difference === '' || difference.startsWith('..') || isAbsolute(difference)) fail('FADENO_BUILD_RUNTIME_CLOSURE');",
    "  const packageIdentity = verify(root, closure.identity); dependencyFiles += packageIdentity.files; dependencyBytes += packageIdentity.bytes;",
    "  if (dependencyFiles > 16384 || dependencyBytes > 536870912) fail('FADENO_BUILD_RUNTIME_CLOSURE');",
    "}",
    `const { listenNodeHttp } = await import(${JSON.stringify(`${packageName}/node`)});`,
    "const { handler } = await import('../.fadeno/routes/app.js');",
    "const server = await listenNodeHttp({",
    "  handler, hostname: '127.0.0.1', port,",
    "  failureObserver({ cause: _cause, ...report }) {",
    "    process.stdout.write(`${JSON.stringify({ event: 'framework-failure', ...report })}\\n`);",
    "  },",
    "});",
    "let stopping = false;",
    "const stop = async () => { if (stopping) return; stopping = true; await server.close(); };",
    "process.once('SIGTERM', () => { void stop(); });",
    "process.once('SIGINT', () => { void stop(); });",
    "process.stdout.write(`Fadeno production server ready at ${server.origin}.\\n`);",
    "} catch (error) {",
    "  const code = error instanceof Error && /^FADENO_[A-Z0-9_]+$/.test(error.message) ? error.message : 'FADENO_BUILD_RUNTIME_INTERNAL';",
    "  process.stderr.write(`${code}\\n`); process.exitCode = 1;",
    "}",
    "",
  ].join("\n");
}

function prepareManifest(
  projectRoot: string,
  generation: GenerationResult,
  refresh: PrivateProjectRefresh,
  frameworkRuntime: PrivateRuntimeIdentity,
  dependencies: readonly DependencyClosure[],
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
    dependencies: dependencies.map(({ name, path, identity }) => Object.freeze({ name, path, identity })),
  });
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(manifestBytes) > maximumBuildManifestBytes) fail("FADENO_BUILD_RUNTIME_CLOSURE_LIMIT");
  writeFileSync(manifestPath, manifestBytes);
  return capturePrivateRuntimeIdentity(stageRoot, identityPaths(stageRoot));
}

function assertOrdinaryTree(path: string): void {
  ownedDirectory(path, "FADENO_BUILD_OUTPUT_OWNERSHIP");
  identityPaths(path);
}

function validManifestPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function assertIdentityStructure(value: unknown, code: string): PrivateRuntimeIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const identity = value as Partial<PrivateRuntimeIdentity>;
  if (
    JSON.stringify(Object.keys(identity).sort(compareText)) !== JSON.stringify(["files", "schemaVersion", "sha256"]) ||
    identity.schemaVersion !== 1 || !Array.isArray(identity.files) || identity.files.length === 0 ||
    identity.files.length > maximumOutputFiles || typeof identity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(identity.sha256)
  ) fail(code);
  let totalBytes = 0;
  let totalPathBytes = 0;
  let previousPath: string | null = null;
  for (const file of identity.files) {
    if (
      !file || JSON.stringify(Object.keys(file).sort(compareText)) !== JSON.stringify(["bytes", "path", "sha256"]) ||
      !validManifestPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      file.bytes > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      (previousPath !== null && compareText(previousPath, file.path) >= 0)
    ) fail(code);
    totalBytes += file.bytes;
    totalPathBytes += Buffer.byteLength(file.path);
    if (totalBytes > 128 * 1024 * 1024 || totalPathBytes > maximumOutputPathBytes) fail(code);
    previousPath = file.path;
  }
  return identity as PrivateRuntimeIdentity;
}

function readAcceptedBuildManifest(output: string, code: string): Readonly<{
  bytes: Buffer;
  identity: PrivateRuntimeIdentity;
  runtime: PrivateRuntimeIdentity;
}> {
  try {
    const path = join(output, ".fadeno", "build-manifest.json");
    const before = lstatSync(path);
    if (
      before.isSymbolicLink() || !before.isFile() || before.size > maximumBuildManifestBytes ||
      realpathSync(path) !== path
    ) fail(code);
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (
      after.isSymbolicLink() || !after.isFile() || bytes.byteLength !== before.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || realpathSync(path) !== path
    ) fail(code);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    const manifest = value as Record<string, unknown>;
    const expectedKeys = [
      "artifactSourceSha256", "artifacts", "compilerVersion", "dependencies", "environmentSha256", "files",
      "framework", "generationSha256", "inputSha256", "outputSha256", "runtime", "schemaVersion",
    ];
    if (
      JSON.stringify(Object.keys(manifest).sort(compareText)) !== JSON.stringify(expectedKeys) ||
      manifest["schemaVersion"] !== 1 || manifest["framework"] !== packageName ||
      manifest["compilerVersion"] !== compilerVersion || !Number.isSafeInteger(manifest["artifacts"]) ||
      (manifest["artifacts"] as number) < 0 || (manifest["artifacts"] as number) > maximumOutputFiles ||
      !Array.isArray(manifest["dependencies"]) || manifest["dependencies"].length === 0 ||
      manifest["dependencies"].length > maximumRuntimePackages
    ) fail(code);
    for (const name of ["environmentSha256", "inputSha256", "generationSha256", "artifactSourceSha256", "outputSha256"]) {
      if (typeof manifest[name] !== "string" || !/^[a-f0-9]{64}$/u.test(manifest[name] as string)) fail(code);
    }
    const runtime = assertIdentityStructure(manifest["runtime"], code);
    let previousDependencyPath: string | null = null;
    let dependencyFiles = 0;
    let dependencyBytes = 0;
    for (const value of manifest["dependencies"]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
      const dependency = value as Record<string, unknown>;
      if (
        JSON.stringify(Object.keys(dependency).sort(compareText)) !== JSON.stringify(["identity", "name", "path"]) ||
        typeof dependency["name"] !== "string" || dependency["name"].length > 214 ||
        !/^(?:@[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/u.test(dependency["name"]) ||
        !validManifestPath(dependency["path"]) ||
        (previousDependencyPath !== null && compareText(previousDependencyPath, dependency["path"]) >= 0)
      ) fail(code);
      const dependencyIdentity = assertIdentityStructure(dependency["identity"], code);
      dependencyFiles += dependencyIdentity.files.length;
      dependencyBytes += dependencyIdentity.files.reduce((total, file) => total + file.bytes, 0);
      if (dependencyFiles > maximumRuntimeFiles || dependencyBytes > maximumRuntimeBytes) fail(code);
      previousDependencyPath = dependency["path"];
    }
    const identity = assertIdentityStructure(Object.freeze({
      schemaVersion: 1 as const,
      files: manifest["files"],
      sha256: manifest["outputSha256"],
    }), code);
    const requiredFiles = [
      ".fadeno/routes/app.js", ".fadeno/routes/loader.js", ".fadeno/routes/virtual.js", "server/bootstrap.js",
    ];
    const ownedFiles = new Set(identity.files.map(({ path }) => path));
    if (requiredFiles.some((path) => !ownedFiles.has(path))) fail(code);
    return Object.freeze({ bytes, identity, runtime });
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    fail(code);
  }
}

function assertAcceptedOutput(output: string, code: string): void {
  try {
    ownedDirectory(output, code);
    const manifest = readAcceptedBuildManifest(output, code);
    if (manifest.runtime.sha256 !== runtimeClosures()[0]!.identity.sha256) fail(code);
    if (manifest.identity.files.some(({ path }) => path === ".fadeno/build-manifest.json")) fail(code);
    assertPrivateRuntimeIdentity(output, manifest.identity);
    const actualPaths = identityPaths(output).sort(compareText);
    const expectedPaths = [...manifest.identity.files.map(({ path }) => path), ".fadeno/build-manifest.json"].sort(compareText);
    if (
      actualPaths.length !== expectedPaths.length ||
      actualPaths.some((path, index) => path !== expectedPaths[index]) ||
      readFileSync(join(output, "server", "bootstrap.js"), "utf8") !== renderBootstrap() ||
      !readAcceptedBuildManifest(output, code).bytes.equals(manifest.bytes)
    ) fail(code);
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    fail(code);
  }
}

function recoverBuildTransaction(projectRoot: string): void {
  const state = join(projectRoot, ".fadeno", "build-stage");
  const output = join(projectRoot, "dist");
  if (!existsSync(state)) {
    if (existsSync(output)) assertAcceptedOutput(output, "FADENO_BUILD_OUTPUT_OWNERSHIP");
    return;
  }
  assertOrdinaryTree(state);
  const allowed = new Set(["generation-1", "generation-2", "rejected", "rollback"]);
  if (readdirSync(state).some((name) => !allowed.has(name))) fail("FADENO_BUILD_TRANSACTION_STATE");
  const candidate = join(state, "generation-1");
  const verification = join(state, "generation-2");
  const rollback = join(state, "rollback");
  const rejected = join(state, "rejected");
  if (existsSync(rejected)) { assertOrdinaryTree(rejected); rmSync(rejected, { recursive: true }); }
  if (existsSync(verification)) { assertOrdinaryTree(verification); rmSync(verification, { recursive: true }); }
  if (!existsSync(rollback)) {
    if (existsSync(candidate)) { assertOrdinaryTree(candidate); rmSync(candidate, { recursive: true }); }
    if (existsSync(output)) assertAcceptedOutput(output, "FADENO_BUILD_OUTPUT_OWNERSHIP");
    return;
  }
  assertAcceptedOutput(rollback, "FADENO_BUILD_TRANSACTION_STATE");
  if (existsSync(output)) {
    assertOrdinaryTree(output);
    renameSync(output, rejected);
  }
  renameSync(rollback, output);
  if (existsSync(rejected)) rmSync(rejected, { recursive: true });
  if (existsSync(candidate)) { assertOrdinaryTree(candidate); rmSync(candidate, { recursive: true }); }
}

function cleanupBuildCandidate(projectRoot: string): void {
  cleanupGenerationCandidate(projectRoot, 1);
}

function cleanupGenerationCandidate(projectRoot: string, generation: number): void {
  const candidate = join(projectRoot, ".fadeno", "build-stage", `generation-${generation}`);
  if (!existsSync(candidate)) return;
  assertOrdinaryTree(candidate);
  rmSync(candidate, { recursive: true });
}

async function verifyEquivalentGeneration(
  projectRoot: string,
  expected: GenerationResult,
  environment: PrivateEnvironmentSnapshot,
  processEnvironment: Readonly<Record<string, string | undefined>>,
  closures: readonly RuntimeClosure[],
): Promise<GenerationResult> {
  let verification: GenerationResult;
  try {
    verification = runGeneration(projectRoot, 2, environment, closures);
    if (
      verification.status !== "emitted" || expected.status !== "emitted" ||
      verification.environmentSha256 !== expected.environmentSha256 ||
      verification.inputSha256 !== expected.inputSha256 ||
      verification.compilerDependenciesSha256 !== expected.compilerDependenciesSha256 ||
      verification.output?.sha256 !== expected.output?.sha256 ||
      JSON.stringify(verification.runtimePackages) !== JSON.stringify(expected.runtimePackages)
    ) fail("FADENO_BUILD_INPUT_STALE");
    await assertGenerationFresh(projectRoot, verification, environment, processEnvironment, closures);
    return verification;
  } finally {
    cleanupGenerationCandidate(projectRoot, 2);
  }
}

interface PrivateOutputAcceptance {
  commit(): void;
  rollback(): void;
}

function beginAcceptStage(projectRoot: string, generation: number, expected: PrivateRuntimeIdentity): PrivateOutputAcceptance {
  const state = join(projectRoot, ".fadeno", "build-stage");
  const stage = join(state, `generation-${generation}`);
  const output = join(projectRoot, "dist");
  const rollback = join(state, "rollback");
  const rejected = join(state, "rejected");
  if (existsSync(rollback) || existsSync(rejected)) fail("FADENO_BUILD_TRANSACTION_STATE");
  assertOrdinaryTree(stage);
  let previous = false;
  if (existsSync(output)) {
    assertAcceptedOutput(output, "FADENO_BUILD_OUTPUT_OWNERSHIP");
    renameSync(output, rollback);
    previous = true;
  }
  let settled = false;
  try {
    renameSync(stage, output);
    const outputIdentity = capturePrivateRuntimeIdentity(output, identityPaths(output));
    if (outputIdentity.sha256 !== expected.sha256) fail("FADENO_BUILD_OUTPUT_STALE");
    assertAcceptedOutput(output, "FADENO_BUILD_OUTPUT_STALE");
    return Object.freeze({
      commit(): void {
        if (settled) return;
        if (previous) renameSync(rollback, rejected);
        settled = true;
        if (previous) rmSync(rejected, { recursive: true });
      },
      rollback(): void {
        if (settled) return;
        if (existsSync(output)) renameSync(output, rejected);
        if (previous) renameSync(rollback, output);
        settled = true;
        if (existsSync(rejected)) rmSync(rejected, { recursive: true });
      },
    });
  } catch (error) {
    if (existsSync(output)) renameSync(output, rejected);
    if (previous && existsSync(rollback)) renameSync(rollback, output);
    if (existsSync(rejected)) rmSync(rejected, { recursive: true });
    throw error;
  }
}

function acceptStage(projectRoot: string, generation: number, expected: PrivateRuntimeIdentity): void {
  beginAcceptStage(projectRoot, generation, expected).commit();
}

function formatCompilerDiagnostics(diagnostics: readonly StructuredCompilerDiagnostic[], projectRoot: string): string {
  const lines = [`FADENO_BUILD_TYPESCRIPT: TypeScript reported ${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}.`];
  for (const diagnostic of diagnostics) {
    const location = diagnostic.file === null
      ? diagnostic.rangeReason ?? "global"
      : `${diagnostic.file}:${diagnostic.start ?? "?"}-${diagnostic.end ?? "?"}`;
    const text = diagnostic.text
      .replaceAll(projectRoot, "<project>")
      .replace(/(['"`])(?:\\.|(?!\1)[^\\\r\n])*\1/gu, "<redacted-literal>")
      .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s'"`<>:]+[\\/])*[^\s'"`<>:]*/gu, "<redacted-path>")
      .replace(/[\u0000-\u001f\u007f]/gu, (value) => `\\u${value.codePointAt(0)!.toString(16).padStart(4, "0")}`);
    lines.push(`  TS${diagnostic.code} ${location}: ${text}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatPrivateProjectRootFailure(error: AnalyzerRootError): string {
  const summary = error.code === "FADENO_ANALYZER_ROOT_MISSING"
    ? "Project root does not exist."
    : error.code === "FADENO_ANALYZER_ROOT_OWNERSHIP"
      ? "Project root must be one owned, non-symlink directory."
      : "Project root must be an absolute path.";
  return `${error.code}: ${summary}\n`;
}

export class PrivateProjectGenerationDiagnosticError extends TypeError {
  readonly human: string;

  constructor(human: string) {
    super("FADENO_BUILD_DIAGNOSTIC");
    this.name = "PrivateProjectGenerationDiagnosticError";
    this.human = human;
  }
}

export interface PrivateProjectOutputTransaction {
  readonly environment: PrivateEnvironmentSnapshot;
  commit(): void;
  rollback(): void;
}

export interface PrivateStagedProjectGeneration {
  accept(signal: AbortSignal): Promise<PrivateProjectOutputTransaction>;
  discard(): void;
}

export class PrivateProjectGenerationOwner {
  readonly #root: string;
  readonly #processEnvironment: Readonly<Record<string, string | undefined>>;
  readonly #releaseBuildLock: () => void;
  #busy = false;
  #closed = false;

  constructor(projectRoot: string, processEnvironment: Readonly<Record<string, string | undefined>> = process.env) {
    this.#root = ownedDirectory(projectRoot, "FADENO_BUILD_OUTPUT_OWNERSHIP");
    this.#processEnvironment = processEnvironment;
    this.#releaseBuildLock = acquireBuildLock(this.#root);
    try {
      recoverBuildTransaction(this.#root);
    } catch (error) {
      this.#releaseBuildLock();
      throw error;
    }
  }

  ownsProject(projectRoot: string): boolean {
    return resolve(projectRoot) === this.#root;
  }

  async compilerDiagnostics(signal: AbortSignal): Promise<PrivateProjectGenerationDiagnosticError> {
    this.#begin();
    try {
      const environment = capturePrivateEnvironment(this.#root, this.#processEnvironment);
      const closures = runtimeClosures();
      const generation = await runGenerationAsync(this.#root, 1, environment, closures, signal);
      if (generation.status !== "diagnostics") fail("FADENO_BUILD_CHILD_RESULT");
      return new PrivateProjectGenerationDiagnosticError(formatCompilerDiagnostics(generation.diagnostics, this.#root));
    } finally {
      try { cleanupGenerationCandidate(this.#root, 1); } finally { this.#busy = false; }
    }
  }

  async prepare(refresh: PrivateProjectRefresh, signal: AbortSignal): Promise<PrivateStagedProjectGeneration> {
    this.#begin();
    try {
      const environment = capturePrivateEnvironment(this.#root, this.#processEnvironment);
      const closures = runtimeClosures();
      const generation = await runGenerationAsync(this.#root, 1, environment, closures, signal);
      if (generation.status === "diagnostics") {
        throw new PrivateProjectGenerationDiagnosticError(formatCompilerDiagnostics(generation.diagnostics, this.#root));
      }
      const dependencies = await captureRuntimeDependencies(this.#root);
      assertRuntimePackagesDeclared(generation, dependencies.closures);
      const complete = prepareManifest(this.#root, generation, refresh, closures[0]!.identity, dependencies.closures);
      await assertGenerationFresh(this.#root, generation, environment, this.#processEnvironment, closures);
      await assertRuntimeDependenciesCurrent(this.#root, dependencies);
      signal.throwIfAborted();
      let state: "staged" | "accepted" | "settled" = "staged";
      const release = (): void => {
        if (state === "settled") return;
        state = "settled";
        this.#busy = false;
      };
      return Object.freeze({
        accept: async (acceptSignal: AbortSignal): Promise<PrivateProjectOutputTransaction> => {
          if (state !== "staged") fail("FADENO_BUILD_TRANSACTION_STATE");
          acceptSignal.throwIfAborted();
          await assertGenerationFresh(this.#root, generation, environment, this.#processEnvironment, closures);
          await assertRuntimeDependenciesCurrent(this.#root, dependencies);
          acceptSignal.throwIfAborted();
          const transaction = beginAcceptStage(this.#root, 1, complete);
          state = "accepted";
          let pending = true;
          const settle = (action: () => void): void => {
            if (!pending) return;
            try { action(); } finally { pending = false; release(); }
          };
          return Object.freeze({
            environment,
            commit: () => settle(transaction.commit),
            rollback: () => settle(transaction.rollback),
          });
        },
        discard: (): void => {
          if (state !== "staged") return;
          try { cleanupGenerationCandidate(this.#root, 1); } finally { release(); }
        },
      });
    } catch (error) {
      try { cleanupGenerationCandidate(this.#root, 1); } finally { this.#busy = false; }
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    if (this.#busy) fail("FADENO_BUILD_TRANSACTION_STATE");
    this.#closed = true;
    this.#releaseBuildLock();
  }

  #begin(): void {
    if (this.#closed || this.#busy) fail("FADENO_BUILD_TRANSACTION_STATE");
    this.#busy = true;
  }
}

export async function runProjectBuildCommand(
  arguments_: readonly string[],
  context: ProjectBuildCommandContext,
): Promise<ProjectBuildCommandResult> {
  const parsed = parsePrivateBuildDevArguments(arguments_, context.cwd);
  if (!parsed || parsed.command !== "build") return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });
  const requestedProjectRoot = parsed.projectRoot;
  let projectRoot = requestedProjectRoot;
  let ownsProject = false;
  let analyzer: PrivateProjectAnalyzer | null = null;
  let releaseBuildLock: (() => void) | null = null;
  try {
    analyzer = new PrivateProjectAnalyzer(requestedProjectRoot);
    projectRoot = realpathSync(requestedProjectRoot);
    ownsProject = true;
    releaseBuildLock = acquireBuildLock(projectRoot);
    recoverBuildTransaction(projectRoot);
    const processEnvironment = context.processEnvironment ?? process.env;
    const environment = capturePrivateEnvironment(projectRoot, processEnvironment);
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
    const dependencies = await captureRuntimeDependencies(projectRoot);
    assertRuntimePackagesDeclared(generation, dependencies.closures);
    const complete = prepareManifest(projectRoot, generation, refresh, closures[0]!.identity, dependencies.closures);
    await assertGenerationFresh(projectRoot, generation, environment, processEnvironment, closures);
    await assertRuntimeDependenciesCurrent(projectRoot, dependencies);
    context.beforeAcceptStage?.(join(projectRoot, ".fadeno", "build-stage", "generation-1"));
    const verification = await verifyEquivalentGeneration(projectRoot, generation, environment, processEnvironment, closures);
    assertRuntimePackagesDeclared(verification, dependencies.closures);
    await assertRuntimeDependenciesCurrent(projectRoot, dependencies);
    acceptStage(projectRoot, 1, complete);
    const fileCount = complete.files.length;
    return Object.freeze({
      exitCode: 0 as const,
      stdout: `Fadeno production build completed: ${fileCount} files written to dist.\n`,
      stderr: "",
    });
  } catch (error) {
    if (ownsProject) {
      try { cleanupBuildCandidate(projectRoot); } catch {
        const incident = context.createIncidentId?.() ?? randomUUID();
        return Object.freeze({
          exitCode: 3 as const,
          stdout: "",
          stderr: `FADENO_BUILD_INTERNAL: Production build could not complete.\n  incident: ${incident}\n`,
        });
      }
    }
    if (error instanceof FadenoDiagnosticError) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: formatDiagnosticHuman(error) });
    }
    if (error instanceof AnalyzerRootError) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: formatPrivateProjectRootFailure(error) });
    }
    if (error instanceof TypeError && error.message === "FADENO_BUILD_TRANSACTION_STATE") {
      const incident = context.createIncidentId?.() ?? randomUUID();
      return Object.freeze({
        exitCode: 3 as const,
        stdout: "",
        stderr: `FADENO_BUILD_INTERNAL: Production build could not complete.\n  incident: ${incident}\n`,
      });
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
    let cleanupFailed = false;
    if (analyzer) {
      try { await analyzer.close(); } catch { cleanupFailed = true; }
    }
    if (releaseBuildLock) {
      try { releaseBuildLock(); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      const incident = context.createIncidentId?.() ?? randomUUID();
      return Object.freeze({
        exitCode: 3 as const,
        stdout: "",
        stderr: `FADENO_BUILD_INTERNAL: Production build could not complete.\n  incident: ${incident}\n`,
      });
    }
  }
}
