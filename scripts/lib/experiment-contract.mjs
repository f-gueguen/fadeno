import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export const MAX_JSON_BYTES = 1024 * 1024;

export class ContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message) {
  throw new ContractError(code, message);
}

function scanObjectKeys(text) {
  let position = 0;

  function skipWhitespace() {
    while (/\s/u.test(text[position] ?? "")) position += 1;
  }

  function readString() {
    const start = position;
    position += 1;
    while (position < text.length) {
      if (text[position] === "\\") {
        position += 2;
        continue;
      }
      if (text[position] === '"') {
        position += 1;
        return JSON.parse(text.slice(start, position));
      }
      position += 1;
    }
    fail("FADENO_K0_JSON_SYNTAX", "unterminated JSON string");
  }

  function scanPrimitive() {
    while (position < text.length && !/[\s,\]}]/u.test(text[position])) {
      position += 1;
    }
  }

  function scanArray() {
    position += 1;
    skipWhitespace();
    if (text[position] === "]") {
      position += 1;
      return;
    }
    while (position < text.length) {
      scanValue();
      skipWhitespace();
      if (text[position] === "]") {
        position += 1;
        return;
      }
      position += 1;
    }
  }

  function scanObject() {
    position += 1;
    skipWhitespace();
    if (text[position] === "}") {
      position += 1;
      return;
    }

    const keys = new Set();
    while (position < text.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) {
        fail("FADENO_K0_JSON_DUPLICATE_KEY", `duplicate JSON key: ${key}`);
      }
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        fail("FADENO_K0_JSON_PROTOTYPE_KEY", `forbidden JSON key: ${key}`);
      }
      keys.add(key);

      skipWhitespace();
      position += 1;
      scanValue();
      skipWhitespace();
      if (text[position] === "}") {
        position += 1;
        return;
      }
      position += 1;
    }
  }

  function scanValue() {
    skipWhitespace();
    if (text[position] === "{") return scanObject();
    if (text[position] === "[") return scanArray();
    if (text[position] === '"') {
      readString();
      return;
    }
    scanPrimitive();
  }

  scanValue();
}

export function parseJsonBuffer(buffer, label, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_JSON_BYTES;
  if (!Buffer.isBuffer(buffer)) {
    fail("FADENO_K0_JSON_INPUT", `${label}: expected a Buffer`);
  }
  if (buffer.byteLength > maxBytes) {
    fail(
      "FADENO_K0_JSON_TOO_LARGE",
      `${label}: ${buffer.byteLength} bytes exceeds ${maxBytes}`,
    );
  }
  if (
    buffer.byteLength >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    fail("FADENO_K0_JSON_BOM", `${label}: UTF-8 BOM is forbidden`);
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("FADENO_K0_JSON_ENCODING", `${label}: invalid UTF-8`);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("FADENO_K0_JSON_SYNTAX", `${label}: invalid JSON syntax`);
  }

  scanObjectKeys(text);
  return value;
}

export function readJsonDocument(path, options = {}) {
  return parseJsonBuffer(readFileSync(path), path, options);
}

export function assertSafeRelativePath(path, label = "path") {
  if (typeof path !== "string" || path.length === 0 || path.length > 240) {
    fail("FADENO_K0_PATH_INVALID", `${label}: invalid length`);
  }
  if (isAbsolute(path) || path.includes("\\") || path.includes("\0")) {
    fail("FADENO_K0_PATH_INVALID", `${label}: absolute or platform path is forbidden`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("FADENO_K0_PATH_ESCAPE", `${label}: non-normalized path is forbidden`);
  }
  return path;
}

export function assertContainedArtifact(root, artifactPath) {
  assertSafeRelativePath(artifactPath, "artifact path");
  const rootReal = realpathSync(root);
  const candidate = join(rootReal, artifactPath);
  let candidateReal;
  try {
    lstatSync(candidate);
    candidateReal = realpathSync(candidate);
  } catch {
    fail("FADENO_K0_ARTIFACT_MISSING", `artifact does not exist: ${artifactPath}`);
  }
  const relativePath = relative(rootReal, candidateReal);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    fail("FADENO_K0_PATH_ESCAPE", `artifact escapes result root: ${artifactPath}`);
  }
  if (!statSync(candidateReal).isFile()) {
    fail("FADENO_K0_ARTIFACT_TYPE", `artifact is not a file: ${artifactPath}`);
  }
  return candidateReal;
}

export function sha256File(path) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = openSync(path, "r");
  try {
    let bytesRead;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function validateArtifactRecords(manifest, manifestPath) {
  const resultRoot = dirname(manifestPath);
  const paths = new Set();
  for (const artifact of manifest.artifacts ?? []) {
    if (paths.has(artifact.path)) {
      fail("FADENO_K0_ARTIFACT_DUPLICATE", `duplicate artifact path: ${artifact.path}`);
    }
    paths.add(artifact.path);
    const path = assertContainedArtifact(resultRoot, artifact.path);
    const size = statSync(path).size;
    const digest = sha256File(path);
    if (size !== artifact.bytes) {
      fail(
        "FADENO_K0_ARTIFACT_SIZE",
        `${artifact.path}: expected ${artifact.bytes} bytes, found ${size}`,
      );
    }
    if (digest !== artifact.sha256) {
      fail(
        "FADENO_K0_ARTIFACT_HASH",
        `${artifact.path}: expected ${artifact.sha256}, found ${digest}`,
      );
    }
  }
  for (const failure of manifest.failures ?? []) {
    if (failure.artifact && !paths.has(failure.artifact)) {
      fail(
        "FADENO_K0_ARTIFACT_MISSING",
        `failure references an unrecorded artifact: ${failure.artifact}`,
      );
    }
  }
}

export function validateManifestSemantics(manifest, referenceEnvironment, registry) {
  if (Date.parse(manifest.run.completedAt) < Date.parse(manifest.run.startedAt)) {
    fail("FADENO_K0_TIME_ORDER", "run.completedAt precedes run.startedAt");
  }
  if (manifest.environment.referenceId !== referenceEnvironment.id) {
    fail("FADENO_K0_ENVIRONMENT_MISMATCH", "manifest reference environment differs");
  }
  if (!registry.experiments.some((entry) => entry.id === manifest.experiment.id)) {
    fail("FADENO_K0_EXPERIMENT_UNKNOWN", "manifest experiment is absent from registry");
  }
  if (
    manifest.environment.container.indexDigest !==
      referenceEnvironment.container.indexDigest ||
    manifest.environment.container.platformDigest !==
      referenceEnvironment.container.platformDigest ||
    manifest.environment.container.configDigest !==
      referenceEnvironment.container.configDigest
  ) {
    fail("FADENO_K0_ENVIRONMENT_MISMATCH", "manifest container digest differs");
  }
  for (const name of ["node", "pnpm", "playwright"]) {
    if (manifest.environment.toolchain[name] !== referenceEnvironment.toolchain[name]) {
      fail("FADENO_K0_ENVIRONMENT_MISMATCH", `manifest ${name} version differs`);
    }
  }
  for (const name of ["chromeForTesting", "firefox", "webkit"]) {
    if (manifest.environment.browsers[name] !== referenceEnvironment.browsers[name]) {
      fail("FADENO_K0_ENVIRONMENT_MISMATCH", `manifest ${name} version differs`);
    }
  }
  if (
    manifest.environment.referenceClass === "reference" &&
    !manifest.environment.backgroundLoad.accepted
  ) {
    fail(
      "FADENO_K0_ENVIRONMENT_MISMATCH",
      "reference run cannot accept failed background-load preflight",
    );
  }
  const expectedConclusion = {
    passed: "pass",
    failed: "fail",
    inconclusive: "inconclusive",
  }[manifest.run.status];
  if (manifest.conclusion.status !== expectedConclusion) {
    fail("FADENO_K0_CONCLUSION_MISMATCH", "run and conclusion statuses disagree");
  }
  const measurementNames = new Set();
  for (const measurement of manifest.measurements) {
    if (measurementNames.has(measurement.name)) {
      fail(
        "FADENO_K0_MEASUREMENT_DUPLICATE",
        `duplicate measurement name: ${measurement.name}`,
      );
    }
    measurementNames.add(measurement.name);
  }
}

export function normalizeRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.experiments)) {
    fail("FADENO_K0_REGISTRY_INVALID", "registry shape is invalid");
  }
  const seen = new Set();
  let priorId = "";
  for (const [index, entry] of registry.experiments.entries()) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      entry.directory !== entry.id ||
      entry.command !== `pnpm experiment:${entry.id}`
    ) {
      fail("FADENO_K0_REGISTRY_INVALID", `registry entry ${index} is invalid`);
    }
    if (seen.has(entry.id) || entry.id.localeCompare(priorId) <= 0) {
      fail("FADENO_K0_REGISTRY_INVALID", "registry IDs must be unique and sorted");
    }
    seen.add(entry.id);
    priorId = entry.id;
    assertSafeRelativePath(entry.directory, `experiment ${entry.id} directory`);
  }
  return registry.experiments;
}

export function stableRegistryListing(registry) {
  const experiments = normalizeRegistry(registry).map((entry) => ({
    id: entry.id,
    hypothesis: entry.hypothesis,
    command: entry.command,
    harnessSlice: entry.harnessSlice,
    qualificationSlice: entry.qualificationSlice,
    status: entry.status,
  }));
  return `${JSON.stringify({ schemaVersion: 1, experiments }, null, 2)}\n`;
}

export function evaluateExperimentCommand(registry, args) {
  if (args.length === 1 && args[0] === "--list") {
    return { exitCode: 0, stdout: stableRegistryListing(registry), stderr: "" };
  }
  if (args.length > 0) {
    return {
      exitCode: 64,
      stdout: "",
      stderr: `FADENO_K0_002: unsupported argument: ${args.join(" ")}\n`,
    };
  }
  return {
    exitCode: 2,
    stdout: "",
    stderr:
      "FADENO_K0_001: experiment execution is unavailable in K0-01; use --list to inspect the approved plan.\n",
  };
}

export function registryLoadFailureResult(error) {
  if (!(error instanceof ContractError)) throw error;
  return {
    exitCode: 65,
    stdout: "",
    stderr: `FADENO_K0_003: experiment registry is invalid (${error.code}).\n`,
  };
}
