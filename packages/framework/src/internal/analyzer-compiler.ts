import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
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

async function fileSha256(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path, { signal });
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function projectInventory(root: string, signal: AbortSignal | undefined, runId: string): Promise<string> {
  const hash = createHash("sha256");
  let entries = 0;
  let bytes = 0;
  const record = (entry: string): void => {
    entries += 1;
    if (entries > maximumInventoryEntries) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
    hash.update(entry);
    hash.update("\n");
  };
  const visit = async (directory: string, prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    for (const name of (await readdir(directory)).sort(compareText)) {
      signal?.throwIfAborted();
      if (prefix === "" && (name === ".git" || name === "node_modules")) continue;
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const status = await lstat(absolute);
      if (status.isSymbolicLink()) {
        throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
      } else if (status.isDirectory()) {
        record(`${path}\0directory`);
        await visit(absolute, path);
      } else if (status.isFile()) {
        bytes += status.size;
        if (bytes > maximumInventoryBytes) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
        record(`${path}\0file\0${status.size}\0${await fileSha256(absolute, signal)}`);
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

function dependencyRoots(root: string): readonly string[] {
  const directory = join(root, "node_modules");
  if (!existsSync(directory)) return Object.freeze([]);
  const canonicalDirectory = realpathSync(directory);
  if (!lstatSync(canonicalDirectory).isDirectory()) return Object.freeze([]);
  const roots = new Set<string>([canonicalDirectory]);
  const addPackages = (container: string): void => {
    for (const name of readdirSync(container)) {
      if (name === ".bin" || name.startsWith(".")) continue;
      const path = join(container, name);
      if (!existsSync(path)) continue;
      const canonical = realpathSync(path);
      if (!lstatSync(canonical).isDirectory()) continue;
      roots.add(canonical);
    }
  };
  for (const name of readdirSync(directory)) {
    if (name === ".bin" || name.startsWith(".")) continue;
    const path = join(directory, name);
    if (!existsSync(path) || !lstatSync(realpathSync(path)).isDirectory()) continue;
    if (name.startsWith("@")) addPackages(path);
    else roots.add(realpathSync(path));
  }
  for (const dependency of [...roots]) {
    let current = dependency;
    while (dirname(current) !== current) {
      if (basename(current) === ".pnpm") {
        roots.add(current);
        break;
      }
      current = dirname(current);
    }
  }
  return Object.freeze([...roots]);
}

function assertCompilerInputOwnership(
  root: string,
  output: string,
  runId: string,
  compilerInputRoot: string | null,
): void {
  const dependencies = new Set(compilerInputRoot
    ? [...dependencyRoots(root), compilerInputRoot]
    : dependencyRoots(root));
  const inputs = new Set(output.split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => isAbsolute(line) && existsSync(line) && lstatSync(line).isFile()));
  if (inputs.size === 0) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
  for (const input of inputs) {
    const logical = resolve(input);
    const canonical = realpathSync(logical);
    const projectOwned = isContained(root, canonical);
    const dependencyOwned = hasOwnedAncestor(canonical, dependencies);
    if (!projectOwned && !dependencyOwned) {
      throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_INPUT", runId);
    }
  }
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
    assertCompilerInputOwnership(this.#root, output, runId, this.#compilerInputRoot);
    return Object.freeze({
      runId,
      requestId: request.requestId,
      generation: request.generation,
      publicationOperationId: request.publicationOperationId,
      artifactSourceSha256: request.artifactSourceSha256,
      compilerVersion: typescriptVersion,
      inventorySha256: after,
    });
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
