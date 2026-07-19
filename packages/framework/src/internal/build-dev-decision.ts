import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const maximumIdentityFiles = 4_096;
const maximumIdentityFileBytes = 64 * 1024 * 1024;
const maximumIdentityBytes = 128 * 1024 * 1024;
const maximumEnvironmentFileBytes = 1024 * 1024;
const environmentDecoder = new TextDecoder("utf-8", { fatal: true });

export type PrivateBuildDevCommand = Readonly<
  | { command: "build"; projectRoot: string }
  | { command: "dev"; projectRoot: string; port: number }
>;

export type PrivateRuntimeIdentity = Readonly<{
  schemaVersion: 1;
  files: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  sha256: string;
}>;

export type PrivateEnvironmentSnapshot = Readonly<{
  values: Readonly<Record<string, string>>;
  sha256: string;
}>;

export type PrivateDevelopmentState =
  | "starting"
  | "ready"
  | "preparing"
  | "switching"
  | "stopping"
  | "stopped"
  | "forced";

export type PrivateDevelopmentTransition = Readonly<{
  state: PrivateDevelopmentState;
  acceptedGeneration: number | null;
  candidateGeneration: number | null;
  exitCode: 0 | 3 | null;
  output: string;
}>;

function contained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownedOrdinaryDirectory(path: string, diagnostic: string): string {
  const logicalRoot = resolve(path);
  try {
    const metadata = lstatSync(logicalRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new TypeError(diagnostic);
    return realpathSync(logicalRoot);
  } catch (error) {
    if (error instanceof TypeError && error.message === diagnostic) throw error;
    throw new TypeError(diagnostic);
  }
}

function readStableOwnedFile(root: string, path: string, maximumBytes: number, diagnostic: string): Buffer {
  try {
    if (!contained(root, path)) throw new TypeError(diagnostic);
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile() || before.size > maximumBytes || realpathSync(path) !== path) {
      throw new TypeError(diagnostic);
    }
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (
      after.isSymbolicLink() || !after.isFile() || bytes.byteLength !== before.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || realpathSync(path) !== path
    ) {
      throw new TypeError(diagnostic);
    }
    return bytes;
  } catch (error) {
    if (error instanceof TypeError && error.message === diagnostic) throw error;
    throw new TypeError(diagnostic);
  }
}

function parsePort(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]{0,4}$/u.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port <= 65_535 ? port : null;
}

export function parsePrivateBuildDevArguments(
  arguments_: readonly string[],
  cwd: string,
): PrivateBuildDevCommand | null {
  if (!Array.isArray(arguments_) || (arguments_[0] !== "build" && arguments_[0] !== "dev")) return null;
  let projectRoot: string | null = null;
  let port: number | null = null;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--project-root") {
      const value = arguments_[++index];
      if (!value || projectRoot !== null) return null;
      projectRoot = resolve(cwd, value);
    } else if (argument === "--port" && arguments_[0] === "dev") {
      if (port !== null) return null;
      port = parsePort(arguments_[++index]);
      if (port === null) return null;
    } else {
      return null;
    }
  }
  if (projectRoot === null) return null;
  return arguments_[0] === "build"
    ? Object.freeze({ command: "build", projectRoot })
    : port === null
      ? null
      : Object.freeze({ command: "dev", projectRoot, port });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function assertPrivateBuildCompilerContract(document: unknown): void {
  const root = object(document);
  const compilerOptions = object(root?.["compilerOptions"]);
  if (!root || !compilerOptions || root["extends"] !== undefined || root["references"] !== undefined) {
    throw new TypeError("FADENO_BUILD_TSCONFIG");
  }
  const required = {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    rootDir: ".",
    outDir: "dist",
    jsx: "react-jsx",
    jsxImportSource: "@fadeno/framework",
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    isolatedModules: true,
  } as const;
  for (const [name, expected] of Object.entries(required)) {
    if (compilerOptions[name] !== expected) throw new TypeError("FADENO_BUILD_TSCONFIG");
  }
  for (const name of [
    "baseUrl",
    "declarationDir",
    "outFile",
    "paths",
    "plugins",
    "tsBuildInfoFile",
  ]) {
    if (compilerOptions[name] !== undefined) throw new TypeError("FADENO_BUILD_TSCONFIG");
  }
  for (const name of [
    "composite",
    "declaration",
    "declarationMap",
    "emitDeclarationOnly",
    "incremental",
    "inlineSourceMap",
    "noEmit",
    "sourceMap",
  ]) {
    if (compilerOptions[name] === true) throw new TypeError("FADENO_BUILD_TSCONFIG");
  }
}

function normalizedRelativePath(path: string): string | null {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path)) return null;
  const normalized = path.split("/").join(sep);
  if (normalized.split(sep).some((component) => component === "" || component === "." || component === "..")) return null;
  return normalized;
}

export function capturePrivateRuntimeIdentity(
  packageRoot: string,
  relativePaths: readonly string[],
): PrivateRuntimeIdentity {
  const root = ownedOrdinaryDirectory(packageRoot, "FADENO_BUILD_RUNTIME_IDENTITY");
  if (relativePaths.length === 0 || relativePaths.length > maximumIdentityFiles) {
    throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
  }
  const unique = [...new Set(relativePaths)].sort(compareText);
  if (unique.length !== relativePaths.length) throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
  let total = 0;
  const files = unique.map((relativePath) => {
    const normalized = normalizedRelativePath(relativePath);
    if (!normalized) throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
    const path = resolve(root, normalized);
    const bytes = readStableOwnedFile(root, path, maximumIdentityFileBytes, "FADENO_BUILD_RUNTIME_IDENTITY");
    if (total > maximumIdentityBytes - bytes.byteLength) {
      throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
    }
    total += bytes.byteLength;
    return Object.freeze({ path: relativePath, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  });
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return Object.freeze({ schemaVersion: 1 as const, files: Object.freeze(files), sha256: hash.digest("hex") });
}

export function assertPrivateRuntimeIdentity(packageRoot: string, expected: PrivateRuntimeIdentity): void {
  if (
    expected?.schemaVersion !== 1 || !Array.isArray(expected.files) || expected.files.length === 0 ||
    typeof expected.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(expected.sha256)
  ) throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
  const paths: string[] = [];
  for (const file of expected.files) {
    if (
      !file || typeof file.path !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
    paths.push(file.path);
  }
  const actual = capturePrivateRuntimeIdentity(packageRoot, paths);
  if (
    actual.sha256 !== expected.sha256 || actual.files.length !== expected.files.length ||
    actual.files.some((file, index) => {
      const wanted = expected.files[index];
      return !wanted || file.path !== wanted.path || file.bytes !== wanted.bytes || file.sha256 !== wanted.sha256;
    })
  ) throw new TypeError("FADENO_BUILD_RUNTIME_IDENTITY");
}

export function parsePrivateEnvironmentFile(source: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match || Object.hasOwn(values, match[1]!)) throw new TypeError(`FADENO_BUILD_ENV:${index + 1}`);
    let value = match[2]!.trim();
    const quote = value[0];
    if (quote === "\"" || quote === "'") {
      if (value.length < 2 || value.at(-1) !== quote) throw new TypeError(`FADENO_BUILD_ENV:${index + 1}`);
      value = value.slice(1, -1);
    } else if (value.includes("\"") || value.includes("'")) {
      throw new TypeError(`FADENO_BUILD_ENV:${index + 1}`);
    }
    if (/\$\{|\r|\n/u.test(value)) throw new TypeError(`FADENO_BUILD_ENV:${index + 1}`);
    values[match[1]!] = value;
  }
  return Object.freeze(values);
}

function decodePrivateEnvironmentFile(bytes: Uint8Array): string {
  try {
    return environmentDecoder.decode(bytes);
  } catch {
    throw new TypeError("FADENO_BUILD_ENV");
  }
}

export function capturePrivateEnvironment(
  projectRoot: string,
  processValues: Readonly<Record<string, string | undefined>>,
): PrivateEnvironmentSnapshot {
  const root = ownedOrdinaryDirectory(projectRoot, "FADENO_BUILD_ENV");
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of [".env", ".env.local"]) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      Object.assign(values, parsePrivateEnvironmentFile(
        decodePrivateEnvironmentFile(
          readStableOwnedFile(root, path, maximumEnvironmentFileBytes, "FADENO_BUILD_ENV"),
        ),
      ));
    }
  }
  for (const [name, value] of Object.entries(processValues)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError("FADENO_BUILD_ENV");
    if (value !== undefined && typeof value !== "string") throw new TypeError("FADENO_BUILD_ENV");
    if (value !== undefined) values[name] = value;
  }
  const ordered = Object.fromEntries(Object.entries(values).sort(([left], [right]) => compareText(left, right)));
  const sha256 = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  return Object.freeze({ values: Object.freeze(ordered), sha256 });
}

export class PrivateDevelopmentDecisionModel {
  readonly #shutdownDeadlineMs: number;
  readonly #origin: string;
  #state: PrivateDevelopmentState = "starting";
  #acceptedGeneration: number | null = null;
  #candidateGeneration: number | null = null;
  #shutdownAt: number | null = null;
  #exitCode: 0 | 3 | null = null;

  constructor(shutdownDeadlineMs: number, port: number) {
    if (!Number.isSafeInteger(shutdownDeadlineMs) || shutdownDeadlineMs < 1 || shutdownDeadlineMs > 60_000) {
      throw new TypeError("FADENO_DEV_SHUTDOWN_CONFIG");
    }
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new TypeError("FADENO_DEV_ADDRESS");
    this.#shutdownDeadlineMs = shutdownDeadlineMs;
    this.#origin = `http://127.0.0.1:${port}`;
  }

  ready(generation: number): PrivateDevelopmentTransition {
    if (this.#state !== "starting" || generation !== 1) throw new TypeError("FADENO_DEV_STATE");
    this.#state = "ready";
    this.#acceptedGeneration = generation;
    return this.#snapshot(`Fadeno development server ready at ${this.#origin}.\n`);
  }

  prepare(generation: number): PrivateDevelopmentTransition {
    if (
      this.#state !== "ready" || this.#acceptedGeneration === null || !Number.isSafeInteger(generation) ||
      generation <= this.#acceptedGeneration
    ) {
      throw new TypeError("FADENO_DEV_STATE");
    }
    this.#state = "preparing";
    this.#candidateGeneration = generation;
    return this.#snapshot("");
  }

  refuseCandidate(): PrivateDevelopmentTransition {
    if (this.#state !== "preparing" && this.#state !== "switching") throw new TypeError("FADENO_DEV_STATE");
    this.#state = "ready";
    this.#candidateGeneration = null;
    return this.#snapshot("Fadeno development diagnostics published; last accepted generation remains active.\n");
  }

  candidateReady(): PrivateDevelopmentTransition {
    if (this.#state !== "preparing" || this.#candidateGeneration === null) throw new TypeError("FADENO_DEV_STATE");
    this.#state = "switching";
    return this.#snapshot("");
  }

  acceptCandidate(): PrivateDevelopmentTransition {
    if (this.#state !== "switching" || this.#candidateGeneration === null) throw new TypeError("FADENO_DEV_STATE");
    this.#acceptedGeneration = this.#candidateGeneration;
    this.#candidateGeneration = null;
    this.#state = "ready";
    return this.#snapshot("Fadeno development diagnostics cleared; new generation active.\n");
  }

  signal(now: number): PrivateDevelopmentTransition {
    if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER) throw new TypeError("FADENO_DEV_STATE");
    if (this.#state === "stopping") {
      this.#state = "forced";
      this.#exitCode = 3;
      return this.#snapshot("Fadeno development shutdown forced.\n");
    }
    if (this.#state === "stopped" || this.#state === "forced") return this.#snapshot("");
    this.#state = "stopping";
    this.#candidateGeneration = null;
    this.#shutdownAt = now + this.#shutdownDeadlineMs;
    return this.#snapshot("Fadeno development shutdown started.\n");
  }

  tick(now: number): PrivateDevelopmentTransition {
    if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER) throw new TypeError("FADENO_DEV_STATE");
    if (this.#state === "stopping" && this.#shutdownAt !== null && now >= this.#shutdownAt) {
      this.#state = "forced";
      this.#exitCode = 3;
      return this.#snapshot("Fadeno development shutdown deadline exceeded.\n");
    }
    return this.#snapshot("");
  }

  drained(): PrivateDevelopmentTransition {
    if (this.#state !== "stopping") throw new TypeError("FADENO_DEV_STATE");
    this.#state = "stopped";
    this.#exitCode = 0;
    return this.#snapshot("Fadeno development server stopped.\n");
  }

  snapshot(): PrivateDevelopmentTransition { return this.#snapshot(""); }

  #snapshot(output: string): PrivateDevelopmentTransition {
    return Object.freeze({
      state: this.#state,
      acceptedGeneration: this.#acceptedGeneration,
      candidateGeneration: this.#candidateGeneration,
      exitCode: this.#exitCode,
      output,
    });
  }
}
