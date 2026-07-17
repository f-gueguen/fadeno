import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
try {
  const archive = join(temporary, "source.tar");
  run("git", ["archive", "--format=tar", "-o", archive, sourceCommit], root);
  const source = join(temporary, "source");
  mkdirSync(source);
  run("tar", ["-xf", archive, "-C", source], temporary);
  assert.equal(treeSha256(source), identity.identity.sourceTreeSha256);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const summary = deriveFeedbackEvidenceSummary(raw, resultId, contract.schedule.order, contract.phases);
assert.deepEqual(summary, json(join(resultDirectory, "summary.json")));
const manifest = json(join(resultDirectory, "manifest.json"));
assert.deepEqual(manifest, {
  schema: "fadeno.private.feedback-evidence",
  version: 1,
  resultId,
  sourceCommit,
  contractSha256,
  files: ["identity.json", "raw.json", "summary.json"].map((path) => ({ path, sha256: sha256(readFileSync(join(resultDirectory, path))) })),
  conclusion: "baseline-only-no-budget",
});

console.log(`V1 analyzer feedback evidence passed (${resultId}, 10 samples, baseline only)`);
