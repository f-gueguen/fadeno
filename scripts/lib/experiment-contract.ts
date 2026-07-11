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
import { spawnSync } from "node:child_process";

export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 128;
const MAX_LOCKFILE_BYTES = 4 * 1024 * 1024;
const MAX_INTEGRATED_ARTIFACT_BYTES = 4 * 1024 * 1024;

export class ContractError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.details = details;
  }
}

export function validateSourceIntegrationAttestations(document: any): void {
  if (
    document?.schemaVersion !== 1 || !Array.isArray(document.attestations) ||
    Object.keys(document).sort().join(",") !== "attestations,schemaVersion"
  ) fail("FADENO_K0_SOURCE_INTEGRATION_ATTESTATION", "attestation document differs");
  const identities = new Set<string>();
  const expectedKeys = [
    "experimentId",
    "integratedCommit",
    "manifestPath",
    "method",
    "pullRequest",
    "repository",
    "resultRunId",
    "sourceCommit",
  ].join(",");
  const manifestPaths = new Set<string>();
  for (const item of document.attestations) {
    const identity = `${item?.experimentId}:${item?.sourceCommit}:${item?.resultRunId}`;
    if (
      !item || Object.keys(item).sort().join(",") !== expectedKeys ||
      item.method !== "squash" ||
      !Number.isSafeInteger(item.pullRequest) || item.pullRequest < 1 ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(item.repository) ||
      !/^[a-z][a-z0-9-]*$/u.test(item.experimentId) ||
      typeof item.manifestPath !== "string" ||
      item.manifestPath.includes("\\") || item.manifestPath.startsWith("/") ||
      item.manifestPath.split("/").includes("..") || !item.manifestPath.endsWith("/manifest.json") ||
      !/^[0-9a-f]{40}$/u.test(item.sourceCommit) ||
      !/^[0-9a-f]{40}$/u.test(item.integratedCommit) ||
      item.sourceCommit === item.integratedCommit ||
      typeof item.resultRunId !== "string" ||
      !item.resultRunId.includes(item.sourceCommit.slice(0, 7)) ||
      identities.has(identity) || manifestPaths.has(item.manifestPath)
    ) fail("FADENO_K0_SOURCE_INTEGRATION_ATTESTATION", "attestation entry differs");
    identities.add(identity);
    manifestPaths.add(item.manifestPath);
  }
}

function fail(code: string, message: string): never {
  throw new ContractError(code, message);
}

function scanObjectKeys(text: string): void {
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
    while (position < text.length && !/[\s,\]}]/u.test(text[position] ?? "")) {
      position += 1;
    }
  }

  function scanArray(depth: number): void {
    position += 1;
    skipWhitespace();
    if (text[position] === "]") {
      position += 1;
      return;
    }
    while (position < text.length) {
      scanValue(depth + 1);
      skipWhitespace();
      if (text[position] === "]") {
        position += 1;
        return;
      }
      position += 1;
    }
  }

  function scanObject(depth: number): void {
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
      scanValue(depth + 1);
      skipWhitespace();
      if (text[position] === "}") {
        position += 1;
        return;
      }
      position += 1;
    }
  }

  function scanValue(depth = 0) {
    if (depth > MAX_JSON_DEPTH) {
      fail("FADENO_K0_JSON_DEPTH", `JSON nesting exceeds ${MAX_JSON_DEPTH}`);
    }
    skipWhitespace();
    if (text[position] === "{") return scanObject(depth);
    if (text[position] === "[") return scanArray(depth);
    if (text[position] === '"') {
      readString();
      return;
    }
    scanPrimitive();
  }

  scanValue();
}

export function parseJsonBuffer(
  buffer: Buffer,
  label: string,
  options: { maxBytes?: number } = {},
) {
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

export function readJsonDocument(path: string, options: { maxBytes?: number } = {}) {
  return parseJsonBuffer(readFileSync(path), path, options);
}

export function assertSafeRelativePath(path: string, label = "path"): string {
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

export function assertContainedArtifact(root: string, artifactPath: string): string {
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

export function sha256File(path: string): string {
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

export function validateAttestedSourceIntegration(
  manifest: any,
  manifestPath: string,
  repositoryRoot: string,
  attestations: any,
): string {
  validateSourceIntegrationAttestations(attestations);
  const canonicalRoot = realpathSync(repositoryRoot);
  const canonicalManifest = realpathSync(manifestPath);
  const repositoryManifestPath = relative(canonicalRoot, canonicalManifest).split(sep).join("/");
  if (
    repositoryManifestPath.startsWith("../") ||
    repositoryManifestPath === ".." ||
    isAbsolute(repositoryManifestPath)
  ) fail("FADENO_K0_SOURCE_INTEGRATION_ATTESTATION", "manifest path escapes repository");
  const attestation = attestations.attestations.find((item: any) =>
    item.sourceCommit === manifest.source.commit &&
    item.resultRunId === manifest.run.id &&
    item.repository === manifest.source.repository &&
    item.experimentId === manifest.experiment.id &&
    item.manifestPath === repositoryManifestPath
  );
  if (!attestation) {
    fail("FADENO_K0_SOURCE_COMMIT_UNAPPROVED", "source integration is not attested");
  }
  const integratedObject = spawnSync(
    "git",
    ["cat-file", "-e", `${attestation.integratedCommit}^{commit}`],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const integratedAncestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", attestation.integratedCommit, "origin/main"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const integratedSubject = spawnSync(
    "git",
    ["show", "-s", "--format=%s", attestation.integratedCommit],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (
    integratedObject.status !== 0 || integratedAncestor.status !== 0 ||
    integratedSubject.status !== 0 ||
    !integratedSubject.stdout.trim().endsWith(`(#${attestation.pullRequest})`)
  ) fail("FADENO_K0_SOURCE_INTEGRATION_UNAPPROVED", "integrated source is not approved");
  const manifestAtIntegration = spawnSync(
    "git",
    ["show", `${attestation.integratedCommit}:${repositoryManifestPath}`],
    { cwd: repositoryRoot, encoding: "buffer", maxBuffer: MAX_JSON_BYTES },
  );
  const manifestBody = readFileSync(canonicalManifest);
  if (
    manifestAtIntegration.status !== 0 || manifestAtIntegration.error ||
    !manifestAtIntegration.stdout.equals(manifestBody)
  ) fail("FADENO_K0_SOURCE_INTEGRATION_RESULT", "integrated manifest differs");
  for (const artifact of manifest.artifacts) {
    if (artifact.bytes > MAX_INTEGRATED_ARTIFACT_BYTES) {
      fail("FADENO_K0_SOURCE_INTEGRATION_RESULT", "integrated artifact exceeds limit");
    }
    const repositoryArtifactPath = relative(
      canonicalRoot,
      join(dirname(canonicalManifest), artifact.path),
    ).split(sep).join("/");
    const artifactAtIntegration = spawnSync(
      "git",
      ["show", `${attestation.integratedCommit}:${repositoryArtifactPath}`],
      { cwd: repositoryRoot, encoding: "buffer", maxBuffer: MAX_INTEGRATED_ARTIFACT_BYTES },
    );
    if (
      artifactAtIntegration.status !== 0 || artifactAtIntegration.error ||
      artifactAtIntegration.stdout.byteLength !== artifact.bytes ||
      createHash("sha256").update(artifactAtIntegration.stdout).digest("hex") !== artifact.sha256
    ) fail("FADENO_K0_SOURCE_INTEGRATION_RESULT", "integrated artifact differs");
  }
  return attestation.integratedCommit;
}

export function validateSourceIntegrationAttestationInventory(
  attestations: any,
  repositoryRoot: string,
): void {
  validateSourceIntegrationAttestations(attestations);
  for (const attestation of attestations.attestations) {
    const manifestPath = join(repositoryRoot, attestation.manifestPath);
    const manifest = readJsonDocument(manifestPath);
    if (
      manifest.experiment?.id !== attestation.experimentId ||
      manifest.run?.id !== attestation.resultRunId ||
      manifest.source?.repository !== attestation.repository ||
      manifest.source?.commit !== attestation.sourceCommit
    ) fail("FADENO_K0_SOURCE_INTEGRATION_ATTESTATION", "attestation is not bound to manifest");
    const sourceAncestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", attestation.sourceCommit, "HEAD"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    if (sourceAncestor.status === 0) {
      fail("FADENO_K0_SOURCE_INTEGRATION_ATTESTATION", "ancestor source needs no attestation");
    }
    validateAttestedSourceIntegration(manifest, manifestPath, repositoryRoot, attestations);
  }
}

function validateSourceProvenance(
  manifest: any,
  manifestPath: string,
  repositoryRoot: string,
): void {
  if (!repositoryRoot) {
    fail("FADENO_K0_REPOSITORY_CONTEXT", "repository root is required for provenance");
  }
  const lockArtifact = manifest.artifacts.find(
    (artifact: any) => artifact.path === manifest.dependencyLock.artifact,
  );
  if (lockArtifact.bytes > MAX_LOCKFILE_BYTES) {
    fail("FADENO_K0_LOCK_TOO_LARGE", "dependency lock exceeds provenance limit");
  }
  const commit = manifest.source.commit;
  const objectCheck = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const ancestorCheck = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  let effectiveCommit = commit;
  if (objectCheck.status !== 0 || ancestorCheck.status !== 0) {
    const attestations = readJsonDocument(
      join(repositoryRoot, "experiments/source-integration-attestations.json"),
    );
    validateSourceIntegrationAttestations(attestations);
    const repositoryManifestPath = relative(
      realpathSync(repositoryRoot),
      realpathSync(manifestPath),
    ).split(sep).join("/");
    const hasMatchingAttestation = attestations.attestations.some((item: any) =>
      item.sourceCommit === commit && item.resultRunId === manifest.run.id &&
      item.repository === manifest.source.repository &&
      item.experimentId === manifest.experiment.id &&
      item.manifestPath === repositoryManifestPath
    );
    if (!hasMatchingAttestation) {
      fail(
        objectCheck.status !== 0
          ? "FADENO_K0_SOURCE_COMMIT_UNKNOWN"
          : "FADENO_K0_SOURCE_COMMIT_UNAPPROVED",
        objectCheck.status !== 0
          ? "source commit is absent from repository history"
          : "source commit is not an ancestor of HEAD",
      );
    }
    effectiveCommit = validateAttestedSourceIntegration(
      manifest,
      manifestPath,
      repositoryRoot,
      attestations,
    );
  }
  const lockAtCommit = spawnSync(
    "git",
    ["show", `${effectiveCommit}:${manifest.dependencyLock.path}`],
    {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: MAX_LOCKFILE_BYTES,
    },
  );
  if (lockAtCommit.status !== 0 || lockAtCommit.error) {
    fail("FADENO_K0_LOCK_SOURCE_MISSING", "dependency lock is unavailable at source commit");
  }
  const sourceLockDigest = createHash("sha256").update(lockAtCommit.stdout).digest("hex");
  if (sourceLockDigest !== manifest.dependencyLock.sha256) {
    fail("FADENO_K0_LOCK_SOURCE_MISMATCH", "recorded lock differs from source commit");
  }
  const datasetSourcePath = manifest.workload?.dataset?.sourcePath;
  if (datasetSourcePath) {
    const datasetAtCommit = spawnSync("git", ["show", `${effectiveCommit}:${datasetSourcePath}`], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: MAX_JSON_BYTES,
    });
    if (datasetAtCommit.status !== 0 || datasetAtCommit.error) {
      fail("FADENO_K0_DATASET_SOURCE_MISSING", "workload dataset is unavailable at source commit");
    }
    const sourceDatasetDigest = createHash("sha256").update(datasetAtCommit.stdout).digest("hex");
    if (sourceDatasetDigest !== manifest.workload.dataset.sha256) {
      fail("FADENO_K0_DATASET_SOURCE_MISMATCH", "recorded dataset differs from source commit");
    }
  }
}

export function validateArtifactRecords(
  manifest: any,
  manifestPath: string,
  repositoryRoot: string,
): void {
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
  for (const [label, provenance] of [
    ["dependency lock", manifest.dependencyLock],
    ["workload dataset", manifest.workload?.dataset],
  ]) {
    const artifact = (manifest.artifacts ?? []).find(
      (candidate: any) => candidate.path === provenance?.artifact,
    );
    if (!artifact || artifact.sha256 !== provenance.sha256) {
      fail(
        "FADENO_K0_PROVENANCE_MISMATCH",
        `${label} hash is not backed by its recorded artifact`,
      );
    }
  }
  validateSourceProvenance(manifest, manifestPath, repositoryRoot);
}

const SECRET_PATTERNS = [
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*\S+/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:cookie|set-cookie)\s*[:=]\s*\S+/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|session(?:id|_id|[-_ ]?token)?)\s*[:=]\s*\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/u,
];

function assertNoSecrets(value: unknown, path = "manifest"): void {
  if (typeof value === "string") {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      fail("FADENO_K0_SECRET_DETECTED", `${path}: secret-shaped value is forbidden`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoSecrets(child, `${path}.${key}`);
    }
  }
}

export function validateManifestSemantics(
  manifest: any,
  referenceEnvironment: any,
  registry: any,
): void {
  assertNoSecrets(manifest);
  if (Date.parse(manifest.run.completedAt) < Date.parse(manifest.run.startedAt)) {
    fail("FADENO_K0_TIME_ORDER", "run.completedAt precedes run.startedAt");
  }
  if (manifest.environment.referenceId !== referenceEnvironment.id) {
    fail("FADENO_K0_ENVIRONMENT_MISMATCH", "manifest reference environment differs");
  }
  const registryEntry = registry.experiments.find(
    (entry: any) => entry.id === manifest.experiment.id,
  );
  if (!registryEntry) {
    fail("FADENO_K0_EXPERIMENT_UNKNOWN", "manifest experiment is absent from registry");
  }
  const expectedCommand = [
    "pnpm",
    registryEntry.command.slice("pnpm ".length),
    "--",
    "--qualify",
  ];
  if (JSON.stringify(manifest.command.argv) !== JSON.stringify(expectedCommand)) {
    fail("FADENO_K0_COMMAND_MISMATCH", "manifest command differs from the registry");
  }
  const runIdentity = /^([0-9]{8}T[0-9]{6}Z)-([a-f0-9]{7,40})-a([1-9][0-9]*)$/u.exec(
    manifest.run.id,
  );
  const startedAtIdentity = `${manifest.run.startedAt
    .slice(0, 19)
    .replaceAll("-", "")
    .replaceAll(":", "")}Z`;
  if (
    !runIdentity ||
    runIdentity[1] !== startedAtIdentity ||
    !manifest.source.commit.startsWith(runIdentity[2]) ||
    manifest.run.attempt !== Number(runIdentity[3])
  ) {
    fail("FADENO_K0_RUN_IDENTITY_MISMATCH", "run ID disagrees with commit or attempt");
  }
  const environmentProjection = [
    ["container.image", manifest.environment.container.image, referenceEnvironment.container.runtimeImage],
    ["container.indexDigest", manifest.environment.container.indexDigest, referenceEnvironment.container.indexDigest],
    ["container.platform", manifest.environment.container.platform, referenceEnvironment.container.platform],
    ["container.platformDigest", manifest.environment.container.platformDigest, referenceEnvironment.container.platformDigest],
    ["container.configDigest", manifest.environment.container.configDigest, referenceEnvironment.container.configDigest],
    ["container.executionUser", manifest.environment.container.executionUser, referenceEnvironment.container.executionUser],
    ["container.browserSandbox", manifest.environment.container.browserSandbox, referenceEnvironment.container.browserSandbox],
    ["container.networkPolicy", manifest.environment.container.networkPolicy, referenceEnvironment.container.networkPolicy],
    ["toolchain.node", manifest.environment.toolchain.node, referenceEnvironment.toolchain.node],
    ["toolchain.pnpm", manifest.environment.toolchain.pnpm, referenceEnvironment.toolchain.pnpm],
    ["toolchain.playwright", manifest.environment.toolchain.playwright, referenceEnvironment.toolchain.playwright],
    ["browsers.chromeForTesting", manifest.environment.browsers.chromeForTesting, referenceEnvironment.browsers.chromeForTesting],
    ["browsers.firefox", manifest.environment.browsers.firefox, referenceEnvironment.browsers.firefox],
    ["browsers.webkit", manifest.environment.browsers.webkit, referenceEnvironment.browsers.webkit],
    ["power.policy", manifest.environment.power.policy, referenceEnvironment.power.policy],
    ["power.telemetry", manifest.environment.power.telemetry, referenceEnvironment.power.telemetry],
  ];
  for (const [field, actual, expected] of environmentProjection) {
    if (actual !== expected) {
      fail("FADENO_K0_ENVIRONMENT_MISMATCH", `manifest ${field} differs`);
    }
  }
  const host = manifest.environment.host;
  const load = manifest.environment.backgroundLoad;
  const referenceHost = referenceEnvironment.host;
  const preflightAgeMilliseconds =
    Date.parse(manifest.run.startedAt) - Date.parse(load.preflightObservedAt);
  const referenceEligible =
    host.provider === referenceHost.provider &&
    host.repositoryVisibility === referenceHost.repositoryVisibility &&
    host.runnerLabel === referenceHost.runnerLabel &&
    host.runnerImage === referenceHost.runnerLabel &&
    host.architecture === referenceHost.architecture &&
    host.logicalCpuCount === referenceHost.minimumHardware.logicalCpuCount &&
    host.memoryMiB === referenceHost.minimumHardware.memoryMiB &&
    host.advertisedStorageMiB === referenceHost.minimumHardware.storageMiB &&
    host.freeStorageMiB >= referenceEnvironment.storage.minimumFreeMiB &&
    load.loadAverage1m <= referenceEnvironment.backgroundLoad.maxLoadAverage1m &&
    load.processCount <= referenceEnvironment.backgroundLoad.maxProcessCount &&
    load.accepted === true &&
    load.reason === referenceEnvironment.backgroundLoad.acceptanceReason &&
    preflightAgeMilliseconds >= 0 &&
    preflightAgeMilliseconds <=
      referenceEnvironment.backgroundLoad.maxPreflightAgeSeconds * 1000;
  if (manifest.environment.referenceClass === "reference" && !referenceEligible) {
    fail(
      "FADENO_K0_ENVIRONMENT_MISMATCH",
      "reference run does not satisfy the derived host and preflight policy",
    );
  }
  const conclusionByRunStatus: Record<string, string> = {
    passed: "pass",
    failed: "fail",
    inconclusive: "inconclusive",
  };
  const expectedConclusion = conclusionByRunStatus[String(manifest.run.status)];
  if (manifest.conclusion.status !== expectedConclusion) {
    fail("FADENO_K0_CONCLUSION_MISMATCH", "run and conclusion statuses disagree");
  }
  if (
    manifest.run.status === "passed" &&
    (manifest.measurements.length === 0 ||
      manifest.artifacts.length === 0)
  ) {
    fail("FADENO_K0_EVIDENCE_EMPTY", "passed run lacks coherent recorded evidence");
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

export function assertRegistrySemantics(registry: any): any[] {
  const seen = new Set();
  let priorId = "";
  for (const [index, entry] of registry.experiments.entries()) {
    if (
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

export function stableRegistryListing(registry: any): string {
  const experiments = assertRegistrySemantics(registry).map((entry: any) => ({
    id: entry.id,
    hypothesis: entry.hypothesis,
    command: entry.command,
    harnessSlice: entry.harnessSlice,
    qualificationSlice: entry.qualificationSlice,
    status: entry.status,
    ...(entry.status === "qualified"
      ? { decision: entry.decision, decisionAdr: entry.decisionAdr }
      : {}),
  }));
  return `${JSON.stringify({ schemaVersion: 1, experiments }, null, 2)}\n`;
}

export function evaluateExperimentCommand(registry: any, args: string[]) {
  if (args[0] === "--") args = args.slice(1);
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
      "FADENO_K0_001: aggregate execution is unavailable until all four harnesses exist; use --list to inspect the approved plan.\n",
  };
}

export function registryLoadFailureResult(error: unknown) {
  if (!(error instanceof ContractError)) throw error;
  return {
    exitCode: 65,
    stdout: "",
    stderr: `FADENO_K0_003: experiment registry is invalid (${error.code}).\n`,
  };
}
