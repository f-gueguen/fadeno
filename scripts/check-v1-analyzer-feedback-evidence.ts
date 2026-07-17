import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveFeedbackEvidenceSummary } from "./lib/v1-analyzer-feedback-evidence.ts";
import { sha256, verifyFeedbackContract, verifyFeedbackRun } from "./lib/v1-analyzer-feedback-verifier.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const expectedRoot = join(root, "evidence/v1-analyzer-feedback/results");

function run(command: string, arguments_: readonly string[], cwd: string): Buffer {
  const result = spawnSync(command, arguments_, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new TypeError(`FADENO_FEEDBACK_EVIDENCE_COMMAND:${command}`);
  return result.stdout;
}

function treeSha256(directory: string): string {
  const files: { path: string; mode: number; sha256: string }[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(directory, path).split("\\").join("/"),
        mode: lstatSync(path).mode & 0o777,
        sha256: sha256(readFileSync(path)),
      });
      else throw new TypeError("FADENO_FEEDBACK_EVIDENCE_SOURCE_ENTRY");
    }
  };
  visit(directory);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return sha256(JSON.stringify(files));
}

function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 1) throw new TypeError("FADENO_FEEDBACK_EVIDENCE_ARGUMENTS");
const resultDirectory = resolve(root, arguments_[0]!);
const containment = relative(expectedRoot, resultDirectory);
if (containment.length === 0 || containment.startsWith("..") || basename(resultDirectory) !== containment) {
  throw new TypeError("FADENO_FEEDBACK_EVIDENCE_PATH");
}
const resultId = basename(resultDirectory);
const redactionPath = join(resultDirectory, "redaction.json");
if (existsSync(redactionPath)) {
  assert.deepEqual(readdirSync(resultDirectory), ["redaction.json"]);
  const redaction = json(redactionPath);
  assert.deepEqual(Object.keys(redaction).sort(), [
    "code",
    "disposition",
    "priorDisposition",
    "resultId",
    "retrySelection",
    "schema",
    "sourceCommit",
    "timingsAreBaseline",
    "version",
  ].sort());
  assert.equal(redaction.schema, "fadeno.private.feedback-redaction");
  assert.equal(redaction.version, 1);
  assert.equal(redaction.resultId, resultId);
  assert.match(redaction.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.ok(resultId.includes(`-${redaction.sourceCommit.slice(0, 7)}-`));
  assert.equal(redaction.code, "FADENO_FEEDBACK_ENVIRONMENT_VALUE_FINGERPRINT");
  assert.ok([
    "refused-before-timing-interpretation",
    "accepted-before-review",
  ].includes(redaction.priorDisposition));
  assert.equal(redaction.disposition, "sensitive-identity-removed-before-merge");
  assert.equal(redaction.timingsAreBaseline, false);
  assert.equal(redaction.retrySelection, false);
  console.log(`V1 analyzer feedback redaction passed (${resultId}, sensitive identity removed, no timing interpretation)`);
  process.exit(0);
}
const contractBytes = readFileSync(join(root, "fixtures/v1-analyzer/feedback-contract.json"));
const contractSha256 = sha256(contractBytes);
const contract = verifyFeedbackContract(JSON.parse(contractBytes.toString("utf8")) as unknown);
const raw = json(join(resultDirectory, "raw.json"));
const identity = json(join(resultDirectory, "identity.json"));
assert.deepEqual(Object.keys(identity).sort(), ["attempts", "contractSha256", "deepTiming", "identity", "schema", "version"].sort());
assert.equal(identity.schema, "fadeno.private.feedback-identity");
assert.equal(identity.version, 1);
assert.equal(identity.contractSha256, contractSha256);
assert.equal(identity.attempts, 14);
assert.equal(identity.deepTiming, true);
verifyFeedbackRun(raw, contract, contractSha256, identity.identity);

const sourceCommit = identity.identity.sourceCommit as string;
assert.match(sourceCommit, /^[0-9a-f]{40}$/u);
assert.ok(resultId.includes(`-${sourceCommit.slice(0, 7)}-`));
const temporary = mkdtempSync(join(tmpdir(), "fadeno-feedback-evidence-"));
let reconstructedSourceTreeSha256 = "";
try {
  const archive = join(temporary, "source.tar");
  run("git", ["archive", "--format=tar", "-o", archive, sourceCommit], root);
  const source = join(temporary, "source");
  mkdirSync(source);
  run("tar", ["-xf", archive, "-C", source], temporary);
  reconstructedSourceTreeSha256 = treeSha256(source);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const refusalPath = join(resultDirectory, "refusal.json");
if (existsSync(refusalPath)) {
  assert.deepEqual(readdirSync(resultDirectory).sort(), ["identity.json", "raw.json", "refusal.json"]);
  assert.notEqual(reconstructedSourceTreeSha256, identity.identity.sourceTreeSha256);
  assert.deepEqual(json(refusalPath), {
    schema: "fadeno.private.feedback-refusal",
    version: 1,
    resultId,
    sourceCommit,
    code: "FADENO_FEEDBACK_SOURCE_TREE_IDENTITY",
    recordedSourceTreeSha256: identity.identity.sourceTreeSha256,
    reconstructedSourceTreeSha256,
    disposition: "refused-before-timing-interpretation",
    timingsAreBaseline: false,
    retrySelection: false,
  });
  console.log(`V1 analyzer feedback refusal passed (${resultId}, source identity rejected, no timing interpretation)`);
} else {
  assert.deepEqual(readdirSync(resultDirectory).sort(), ["host.json", "identity.json", "manifest.json", "raw.json", "summary.json"]);
  assert.equal(reconstructedSourceTreeSha256, identity.identity.sourceTreeSha256);
  const host = json(join(resultDirectory, "host.json"));
  assert.deepEqual(Object.keys(host).sort(), ["architecture", "cpuModel", "logicalCpuCount", "osRelease", "osVersion", "platform", "runtimeVersion", "schema", "totalMemoryBytes", "version"].sort());
  assert.equal(host.schema, "fadeno.private.feedback-host");
  assert.equal(host.version, 1);
  assert.equal(host.platform, identity.identity.platform);
  assert.equal(host.architecture, identity.identity.architecture);
  assert.equal(host.runtimeVersion, identity.identity.runtimeVersion);
  for (const key of ["cpuModel", "osRelease", "osVersion"]) assert.equal(typeof host[key], "string");
  for (const key of ["logicalCpuCount", "totalMemoryBytes"]) assert.ok(Number.isSafeInteger(host[key]) && host[key] > 0);
  const summary = deriveFeedbackEvidenceSummary(raw, resultId, contract.schedule.order, contract.phases);
  assert.deepEqual(summary, json(join(resultDirectory, "summary.json")));
  const manifest = json(join(resultDirectory, "manifest.json"));
  assert.deepEqual(manifest, {
    schema: "fadeno.private.feedback-evidence",
    version: 1,
    resultId,
    sourceCommit,
    contractSha256,
    files: ["host.json", "identity.json", "raw.json", "summary.json"].map((path) => ({ path, sha256: sha256(readFileSync(join(resultDirectory, path))) })),
    conclusion: "baseline-only-no-budget",
  });
  console.log(`V1 analyzer feedback evidence passed (${resultId}, 10 samples, baseline only)`);
}
