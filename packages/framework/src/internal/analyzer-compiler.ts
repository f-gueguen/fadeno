import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { version as typescriptVersion } from "typescript";

const maximumCompilerOutputBytes = 4_194_304;
const maximumInventoryEntries = 20_000;
const maximumInventoryBytes = 268_435_456;

export type PrivateCompilerCommand = Readonly<{
  executable: string;
  argumentsPrefix: readonly string[];
}>;

export type PrivateCompilerValidation = Readonly<{
  runId: string;
  requestId: string;
  generation: number;
  publicationOperationId: string;
  artifactSourceSha256: string;
  compilerVersion: string;
  inventorySha256: string;
  inputSha256: string;
}>;

type PrivateCompilerInputIdentity = Readonly<{
  path: string;
  size: number;
  sha256: string;
}>;

export type PrivateCompilerValidationRequest = Readonly<{
  requestId: string;
  generation: number;
  publicationOperationId: string;
  artifactSourceSha256: string;
  signal: AbortSignal;
}>;

export interface PrivateCompilerValidatorOptions {
  readonly command?: PrivateCompilerCommand;
  readonly onSpawn?: (pid: number) => void;
  readonly onClose?: (pid: number, code: number | null, signal: NodeJS.Signals | null) => void;
}

export class PrivateCompilerValidationError extends TypeError {
  readonly code:
    | "FADENO_ANALYZER_COMPILER_CONFIG"
    | "FADENO_ANALYZER_COMPILER_DIAGNOSTIC"
    | "FADENO_ANALYZER_COMPILER_INPUT"
    | "FADENO_ANALYZER_COMPILER_OUTPUT"
    | "FADENO_ANALYZER_COMPILER_OUTPUT_LIMIT"
    | "FADENO_ANALYZER_COMPILER_PROCESS";
  readonly runId: string;
  readonly diagnosticCodes: readonly number[];

  constructor(code: PrivateCompilerValidationError["code"], runId: string, diagnosticCodes: readonly number[] = []) {
    super(code);
    this.name = "PrivateCompilerValidationError";
    this.code = code;
    this.runId = runId;
    this.diagnosticCodes = Object.freeze([...diagnosticCodes]);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stockCompilerCommand(): PrivateCompilerCommand {
  const require = createRequire(import.meta.url);
  const parser = dirname(require.resolve("typescript/package.json"));
  const parserRequire = createRequire(join(parser, "package.json"));
  const executablePackage = dirname(parserRequire.resolve(
    `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
  ));
  const executable = join(executablePackage, "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
  if (!existsSync(executable) || !lstatSync(executable).isFile()) {
    throw new TypeError("FADENO_ANALYZER_COMPILER_PROCESS");
  }
  return Object.freeze({ executable, argumentsPrefix: Object.freeze([]) });
}

async function fileSha256(
  path: string,
  expectedBytes: number,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path, { signal });
  let bytes = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    bytes += (chunk as Buffer).byteLength;
    if (bytes > expectedBytes || bytes > maximumBytes) {
      stream.destroy();
      throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
    }
    hash.update(chunk as Buffer);
  }
  if (bytes !== expectedBytes) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
  return hash.digest("hex");
}

async function projectInventory(root: string, signal: AbortSignal | undefined, runId: string): Promise<string> {
  const hash = createHash("sha256");
  let entries = 0;
  let discoveredEntries = 0;
  let bytes = 0;
  const record = (entry: string): void => {
    entries += 1;
    if (entries > maximumInventoryEntries) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
    hash.update(entry);
    hash.update("\n");
  };
  const visit = async (directory: string, prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    const names: string[] = [];
    for await (const entry of await opendir(directory)) {
      signal?.throwIfAborted();
      if (prefix === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
      discoveredEntries += 1;
      if (discoveredEntries > maximumInventoryEntries) {
        throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
      }
      names.push(entry.name);
    }
    for (const name of names.sort(compareText)) {
      signal?.throwIfAborted();
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const status = await lstat(absolute);
      if (status.isSymbolicLink()) {
        throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
      } else if (status.isDirectory()) {
        record(`${path}\0directory`);
        await visit(absolute, path);
      } else if (status.isFile()) {
        if (status.size > maximumInventoryBytes - bytes) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
        const fileHash = await fileSha256(absolute, status.size, maximumInventoryBytes - bytes, signal);
        const after = await lstat(absolute);
        if (!after.isFile() || after.size !== status.size || after.dev !== status.dev || after.ino !== status.ino || after.mtimeMs !== status.mtimeMs) {
          throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
        }
        bytes += status.size;
        record(`${path}\0file\0${status.size}\0${fileHash}`);
      } else {
        record(`${path}\0other`);
      }
    }
  };
  await visit(root, "");
  return hash.digest("hex");
}

function diagnosticCodes(output: string): readonly number[] {
  return Object.freeze([...output.matchAll(/\berror TS(\d+):/gu)]
    .map((match) => Number.parseInt(match[1]!, 10))
    .filter((value) => Number.isSafeInteger(value))
    .sort((left, right) => left - right));
}

function ownedRoot(projectRoot: string): string {
  const requestedRoot = resolve(projectRoot);
  if (!existsSync(requestedRoot) || lstatSync(requestedRoot).isSymbolicLink() || !lstatSync(requestedRoot).isDirectory()) {
    throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
  }
  const root = realpathSync(requestedRoot);
  const config = join(root, "tsconfig.json");
  if (!existsSync(config) || lstatSync(config).isSymbolicLink() || !lstatSync(config).isFile() || relative(root, config).startsWith("..")) {
    throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
  }
  return root;
}

function isContained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function hasOwnedAncestor(path: string, roots: ReadonlySet<string>): boolean {
  let current = dirname(path);
  while (dirname(current) !== current) {
    if (roots.has(current)) return true;
    current = dirname(current);
  }
  return roots.has(current);
}

function dependencyRoots(root: string, runId: string): readonly string[] {
  const directory = join(root, "node_modules");
  if (!existsSync(directory)) return Object.freeze([]);
  const canonicalDirectory = realpathSync(directory);
  if (!lstatSync(canonicalDirectory).isDirectory() || basename(canonicalDirectory) !== "node_modules") {
    throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
  }
  const roots = new Set<string>();
  const pending = [directory];
  const visitedDirectories = new Set<string>();
  let packages = 0;
  const enqueueNearestDependencyDirectory = (packageRoot: string): void => {
    let current = dirname(packageRoot);
    while (dirname(current) !== current) {
      if (basename(current) === "node_modules") {
        pending.push(current);
        return;
      }
      current = dirname(current);
    }
  };
  const addPackage = (path: string, expectedName: string): void => {
    if (!existsSync(path)) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    const canonical = realpathSync(path);
    const manifest = join(canonical, "package.json");
    if (!lstatSync(canonical).isDirectory() || !existsSync(manifest) || lstatSync(manifest).isSymbolicLink() || !lstatSync(manifest).isFile()) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
    let name: unknown;
    try { name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name; } catch {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
    if (name !== expectedName) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    if (roots.has(canonical)) return;
    roots.add(canonical);
    packages += 1;
    if (packages > maximumInventoryEntries) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    const nested = join(canonical, "node_modules");
    if (existsSync(nested)) pending.push(nested);
    enqueueNearestDependencyDirectory(canonical);
  };
  while (pending.length > 0) {
    const current = pending.pop()!;
    const canonical = realpathSync(current);
    if (visitedDirectories.has(canonical)) continue;
    if (!lstatSync(canonical).isDirectory() || basename(canonical) !== "node_modules") {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
    visitedDirectories.add(canonical);
    for (const name of readdirSync(current).sort(compareText)) {
      if (name === ".bin" || name.startsWith(".")) continue;
      const path = join(current, name);
      if (name.startsWith("@")) {
        const scope = realpathSync(path);
        if (!lstatSync(scope).isDirectory()) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
        for (const packageName of readdirSync(path).sort(compareText)) {
          if (packageName.startsWith(".")) continue;
          addPackage(join(path, packageName), `${name}/${packageName}`);
        }
      } else {
        addPackage(path, name);
      }
    }
  }
  return Object.freeze([...roots]);
}

async function compilerInputIdentity(
  path: string,
  remainingBytes: number,
  runId: string,
  signal?: AbortSignal,
): Promise<PrivateCompilerInputIdentity> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size > remainingBytes) {
    throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
  }
  const fileHash = await fileSha256(path, before.size, remainingBytes, signal);
  const after = await lstat(path);
  if (!after.isFile() || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
    throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
  }
  return Object.freeze({ path, size: before.size, sha256: fileHash });
}

function inputIdentitySha256(inputs: readonly PrivateCompilerInputIdentity[]): string {
  const hash = createHash("sha256");
  for (const input of inputs) {
    hash.update(`${input.path}\0${input.size}\0${input.sha256}\n`);
  }
  return hash.digest("hex");
}

async function compilerInputSnapshot(
  root: string,
  output: string,
  runId: string,
  compilerInputRoot: string | null,
  signal?: AbortSignal,
): Promise<Readonly<{ inputs: readonly PrivateCompilerInputIdentity[]; sha256: string }>> {
  const dependencies = new Set(compilerInputRoot
    ? [...dependencyRoots(root, runId), compilerInputRoot]
    : dependencyRoots(root, runId));
  const paths = new Set<string>();
  for (const line of output.split(/\r?\n/gu)) {
    if (line === "") continue;
    if (!isAbsolute(line) || !existsSync(line) || lstatSync(line).isSymbolicLink() || !lstatSync(line).isFile()) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
    const input = line;
    const logical = resolve(input);
    const canonical = realpathSync(logical);
    const projectOwned = isContained(root, canonical);
    const dependencyOwned = hasOwnedAncestor(canonical, dependencies);
    if (!projectOwned && !dependencyOwned) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
    paths.add(canonical);
  }
  if (paths.size === 0 || paths.size > maximumInventoryEntries) {
    throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
  }
  const inputs: PrivateCompilerInputIdentity[] = [];
  let bytes = 0;
  for (const path of [...paths].sort(compareText)) {
    signal?.throwIfAborted();
    const input = await compilerInputIdentity(path, maximumInventoryBytes - bytes, runId, signal);
    bytes += input.size;
    inputs.push(input);
  }
  return Object.freeze({ inputs: Object.freeze(inputs), sha256: inputIdentitySha256(inputs) });
}

async function refreshCompilerInputSnapshot(
  expected: readonly PrivateCompilerInputIdentity[],
  runId: string,
  signal: AbortSignal,
): Promise<string> {
  const inputs: PrivateCompilerInputIdentity[] = [];
  let bytes = 0;
  for (const prior of expected) {
    signal.throwIfAborted();
    if (!existsSync(prior.path)) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    const input = await compilerInputIdentity(prior.path, maximumInventoryBytes - bytes, runId, signal);
    bytes += input.size;
    inputs.push(input);
  }
  return inputIdentitySha256(inputs);
}

export class PrivateCompilerValidator {
  readonly #root: string;
  readonly #command: PrivateCompilerCommand;
  readonly #compilerInputRoot: string | null;
  readonly #onSpawn?: PrivateCompilerValidatorOptions["onSpawn"];
  readonly #onClose?: PrivateCompilerValidatorOptions["onClose"];
  #closed = false;
  #closePromise: Promise<void> | null = null;
  #active: Readonly<{
    abort: AbortController;
    result: Promise<PrivateCompilerValidation>;
  }> | null = null;
  readonly #validatedInputs = new WeakMap<PrivateCompilerValidation, readonly PrivateCompilerInputIdentity[]>();

  constructor(projectRoot: string, options: PrivateCompilerValidatorOptions = {}) {
    this.#root = ownedRoot(projectRoot);
    this.#command = options.command ?? stockCompilerCommand();
    this.#compilerInputRoot = options.command ? null : dirname(dirname(this.#command.executable));
    this.#onSpawn = options.onSpawn;
    this.#onClose = options.onClose;
  }

  ownsProject(projectRoot: string): boolean {
    try { return ownedRoot(projectRoot) === this.#root; } catch { return false; }
  }

  validate(request: PrivateCompilerValidationRequest): Promise<PrivateCompilerValidation> {
    if (this.#closed || this.#active) throw new TypeError("FADENO_ANALYZER_COMPILER_STATE");
    request.signal.throwIfAborted();
    if (ownedRoot(this.#root) !== this.#root) throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
    const runId = `${randomUUID()}:compiler-run`;
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const result = this.#execute({ ...request, signal }, runId).finally(() => {
      this.#active = null;
    });
    this.#active = Object.freeze({ abort, result });
    return result;
  }

  async assertCurrent(validation: PrivateCompilerValidation, signal: AbortSignal): Promise<void> {
    if (this.#closed || this.#active) throw new TypeError("FADENO_ANALYZER_COMPILER_STATE");
    signal.throwIfAborted();
    if (ownedRoot(this.#root) !== this.#root) throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
    if (await projectInventory(this.#root, signal, validation.runId) !== validation.inventorySha256) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", validation.runId);
    }
    const inputs = this.#validatedInputs.get(validation);
    if (!inputs || await refreshCompilerInputSnapshot(inputs, validation.runId, signal) !== validation.inputSha256) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", validation.runId);
    }
  }

  async #execute(
    request: PrivateCompilerValidationRequest,
    runId: string,
  ): Promise<PrivateCompilerValidation> {
    const before = await projectInventory(this.#root, request.signal, runId);
    request.signal.throwIfAborted();
    const config = join(this.#root, "tsconfig.json");
    const child = spawn(this.#command.executable, [
      ...this.#command.argumentsPrefix,
      "--project", config,
      "--noEmit",
      "--pretty", "false",
      "--incremental", "false",
      "--listFiles",
    ], {
      cwd: this.#root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const pid = child.pid;
    let output = "";
    let outputBytes = 0;
    let outputLimited = false;
    let processError: Error | null = null;
    let terminationTimer: NodeJS.Timeout | null = null;
    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      terminationTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1_000);
      terminationTimer.unref();
    };
    const capture = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumCompilerOutputBytes) {
        outputLimited = true;
        terminate();
        return;
      }
      output += chunk.toString("utf8");
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", (error) => { processError = error; });
    const abort = (): void => terminate();
    request.signal.addEventListener("abort", abort, { once: true });
    if (pid !== undefined) {
      try { this.#onSpawn?.(pid); } catch { /* observation cannot control compiler ownership */ }
    }
    const outcome = await new Promise<Readonly<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>>((accept) => {
      child.once("close", (code, signal) => accept(Object.freeze({ code, signal })));
    });
    if (terminationTimer) clearTimeout(terminationTimer);
    request.signal.removeEventListener("abort", abort);
    if (pid !== undefined) {
      try { this.#onClose?.(pid, outcome.code, outcome.signal); } catch { /* observation cannot alter settlement */ }
    }
    const after = await projectInventory(this.#root, undefined, runId);
    if (after !== before) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_OUTPUT", runId);
    request.signal.throwIfAborted();
    if (outputLimited) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_OUTPUT_LIMIT", runId);
    if (processError) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_PROCESS", runId);
    const codes = diagnosticCodes(output);
    if (outcome.code !== 0) {
      throw new PrivateCompilerValidationError(
        codes.length > 0 ? "FADENO_ANALYZER_COMPILER_DIAGNOSTIC" : "FADENO_ANALYZER_COMPILER_PROCESS",
        runId,
        codes,
      );
    }
    const inputSnapshot = await compilerInputSnapshot(
      this.#root,
      output,
      runId,
      this.#compilerInputRoot,
      request.signal,
    );
    const validation: PrivateCompilerValidation = Object.freeze({
      runId,
      requestId: request.requestId,
      generation: request.generation,
      publicationOperationId: request.publicationOperationId,
      artifactSourceSha256: request.artifactSourceSha256,
      compilerVersion: typescriptVersion,
      inventorySha256: after,
      inputSha256: inputSnapshot.sha256,
    });
    this.#validatedInputs.set(validation, inputSnapshot.inputs);
    return validation;
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = (async () => {
      if (this.#active) {
        this.#active.abort.abort();
        try { await this.#active.result; } catch { /* close drains terminal compiler state */ }
      }
    })();
    return this.#closePromise;
  }
}
