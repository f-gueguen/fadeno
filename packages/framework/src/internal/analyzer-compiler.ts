import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import { version as typescriptVersion } from "typescript";

const maximumCompilerOutputBytes = 262_144;
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

function projectInventory(root: string): string {
  const entries: string[] = [];
  let bytes = 0;
  const visit = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort(compareText)) {
      if (prefix === "" && (name === ".git" || name === "node_modules")) continue;
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) {
        entries.push(`${path}\0link\0${readlinkSync(absolute)}`);
      } else if (status.isDirectory()) {
        entries.push(`${path}\0directory`);
        visit(absolute, path);
      } else if (status.isFile()) {
        bytes += status.size;
        if (bytes > maximumInventoryBytes) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
        entries.push(`${path}\0file\0${status.size}\0${sha256(readFileSync(absolute))}`);
      } else {
        entries.push(`${path}\0other`);
      }
      if (entries.length > maximumInventoryEntries) throw new TypeError("FADENO_ANALYZER_COMPILER_INVENTORY");
    }
  };
  visit(root, "");
  return sha256(entries.join("\n"));
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

export class PrivateCompilerValidator {
  readonly #root: string;
  readonly #command: PrivateCompilerCommand;
  readonly #onSpawn?: PrivateCompilerValidatorOptions["onSpawn"];
  readonly #onClose?: PrivateCompilerValidatorOptions["onClose"];
  #closed = false;
  #active: Readonly<{
    child: ChildProcess;
    result: Promise<PrivateCompilerValidation>;
    terminate(): void;
  }> | null = null;

  constructor(projectRoot: string, options: PrivateCompilerValidatorOptions = {}) {
    this.#root = ownedRoot(projectRoot);
    this.#command = options.command ?? stockCompilerCommand();
    this.#onSpawn = options.onSpawn;
    this.#onClose = options.onClose;
  }

  validate(request: PrivateCompilerValidationRequest): Promise<PrivateCompilerValidation> {
    if (this.#closed || this.#active) throw new TypeError("FADENO_ANALYZER_COMPILER_STATE");
    request.signal.throwIfAborted();
    if (ownedRoot(this.#root) !== this.#root) throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
    const runId = `${randomUUID()}:compiler-run`;
    const before = projectInventory(this.#root);
    const config = join(this.#root, "tsconfig.json");
    const child = spawn(this.#command.executable, [
      ...this.#command.argumentsPrefix,
      "--project", config,
      "--noEmit",
      "--pretty", "false",
      "--incremental", "false",
    ], {
      cwd: this.#root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const pid = child.pid;
    if (pid !== undefined) this.#onSpawn?.(pid);
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
    const result = new Promise<PrivateCompilerValidation>((accept, refuse) => {
      child.once("close", (code, signal) => {
        if (terminationTimer) clearTimeout(terminationTimer);
        request.signal.removeEventListener("abort", abort);
        if (pid !== undefined) this.#onClose?.(pid, code, signal);
        try {
          const after = projectInventory(this.#root);
          if (after !== before) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_OUTPUT", runId);
          request.signal.throwIfAborted();
          if (outputLimited) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_OUTPUT_LIMIT", runId);
          if (processError) throw new PrivateCompilerValidationError("FADENO_ANALYZER_COMPILER_PROCESS", runId);
          const codes = diagnosticCodes(output);
          if (code !== 0) {
            throw new PrivateCompilerValidationError(
              codes.length > 0 ? "FADENO_ANALYZER_COMPILER_DIAGNOSTIC" : "FADENO_ANALYZER_COMPILER_PROCESS",
              runId,
              codes,
            );
          }
          accept(Object.freeze({
            runId,
            requestId: request.requestId,
            generation: request.generation,
            publicationOperationId: request.publicationOperationId,
            artifactSourceSha256: request.artifactSourceSha256,
            compilerVersion: typescriptVersion,
            inventorySha256: after,
          }));
        } catch (error) {
          refuse(error);
        }
      });
    }).finally(() => {
      this.#active = null;
    });
    this.#active = Object.freeze({ child, result, terminate });
    return result;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#active) {
      this.#active.terminate();
      try { await this.#active.result; } catch { /* close drains terminal compiler state */ }
    }
  }
}
