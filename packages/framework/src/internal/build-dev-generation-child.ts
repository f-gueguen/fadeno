import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { API } from "typescript/unstable/sync";

import {
  assertPrivateBuildCompilerContract,
  assertPrivateRuntimeIdentity,
  capturePrivateEnvironment,
  capturePrivateRuntimeIdentity,
  type PrivateRuntimeIdentity,
} from "./build-dev-decision.ts";

const maximumRequestBytes = 256 * 1024;
const maximumCompilerOutputBytes = 1024 * 1024;

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
  const bytes = readFileSync(0);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumRequestBytes) fail("FADENO_BUILD_CHILD_REQUEST");
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

function projectInputPaths(projectRoot: string, directory = projectRoot): readonly string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name);
    const relativePath = relative(projectRoot, path).split("\\").join("/");
    if (relativePath === "dist" || relativePath === "node_modules" || relativePath === ".fadeno/build-stage") continue;
    if (entry.isSymbolicLink()) fail("FADENO_BUILD_CHILD_INPUT");
    if (entry.isDirectory()) paths.push(...projectInputPaths(projectRoot, path));
    else if (entry.isFile()) paths.push(relativePath);
    else fail("FADENO_BUILD_CHILD_INPUT");
  }
  return Object.freeze(paths);
}

function structuredDiagnostics(projectRoot: string): readonly StructuredDiagnostic[] {
  const api = new API({ cwd: projectRoot });
  const config = join(projectRoot, "tsconfig.json");
  const snapshot = api.updateSnapshot({ openProjects: [{ uri: pathToFileURL(config).href }] });
  try {
    const projects = snapshot.getProjects();
    if (projects.length !== 1) fail("FADENO_BUILD_CHILD_COMPILER");
    const program = projects[0]!.program;
    const raw = [
      ...program.getConfigFileParsingDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ] as readonly Readonly<{
      code: number;
      category: number;
      fileName?: string;
      pos?: number;
      end?: number;
      text: string;
    }>[];
    const diagnostics = raw.map((diagnostic): StructuredDiagnostic => {
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
    return Object.freeze(diagnostics);
  } finally {
    snapshot.dispose();
    api.close();
  }
}

function outputPaths(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail("FADENO_BUILD_CHILD_OUTPUT");
    if (entry.isDirectory()) paths.push(...outputPaths(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).split("\\").join("/"));
    else fail("FADENO_BUILD_CHILD_OUTPUT");
  }
  return paths;
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

function main(): void {
  const input = request();
  const projectRoot = ownedRoot(input.projectRoot, "FADENO_BUILD_CHILD_PROJECT");
  if (resolve(input.projectRoot) !== projectRoot) fail("FADENO_BUILD_CHILD_PROJECT");
  for (const closure of input.runtimeClosures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
  const environment = capturePrivateEnvironment(projectRoot, process.env);
  if (environment.sha256 !== input.environmentSha256) fail("FADENO_BUILD_CHILD_ENVIRONMENT");
  const configBytes = readFileSync(join(projectRoot, "tsconfig.json"));
  if (configBytes.byteLength > maximumRequestBytes) fail("FADENO_BUILD_CHILD_TSCONFIG");
  let config: unknown;
  try { config = JSON.parse(configBytes.toString("utf8")); } catch { fail("FADENO_BUILD_CHILD_TSCONFIG"); }
  assertPrivateBuildCompilerContract(config);
  const stageRoot = prepareStage(projectRoot, input.stageRoot, input.generation);
  const sourcePaths = projectInputPaths(projectRoot);
  const before = capturePrivateRuntimeIdentity(projectRoot, sourcePaths);
  const diagnostics = structuredDiagnostics(projectRoot);
  const afterAnalysis = capturePrivateRuntimeIdentity(projectRoot, sourcePaths);
  if (afterAnalysis.sha256 !== before.sha256 || !readFileSync(join(projectRoot, "tsconfig.json")).equals(configBytes)) {
    fail("FADENO_BUILD_CHILD_STALE_INPUT");
  }
  if (diagnostics.length > 0) {
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
      diagnostics,
    }))}\n`);
    return;
  }
  emit(projectRoot, stageRoot);
  const after = capturePrivateRuntimeIdentity(projectRoot, sourcePaths);
  if (after.sha256 !== before.sha256) fail("FADENO_BUILD_CHILD_STALE_INPUT");
  for (const closure of input.runtimeClosures) assertPrivateRuntimeIdentity(closure.root, closure.identity);
  if (capturePrivateEnvironment(projectRoot, process.env).sha256 !== environment.sha256) fail("FADENO_BUILD_CHILD_ENVIRONMENT");
  const output = capturePrivateRuntimeIdentity(stageRoot, outputPaths(stageRoot));
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
    output,
    operationSha256,
    diagnostics: Object.freeze([]),
  }))}\n`);
}

try { main(); } catch (error) {
  const identity = error instanceof Error && /^FADENO_/u.test(error.message) ? error.message : "FADENO_BUILD_CHILD_INTERNAL";
  process.stderr.write(`${identity}\n`);
  process.exitCode = 3;
}
