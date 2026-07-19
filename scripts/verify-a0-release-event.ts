import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createA0DocumentationArtifactReceipt,
  createA0DocumentationManifest,
  validateA0DocumentationArtifactReceipt,
  validateA0DocumentationArtifactTree,
  validateA0DocumentationManifest,
  type A0DocumentationManifest,
} from "./lib/a0-docs-artifact.ts";
import { A0_FIRST_ALPHA_TAG, A0_FIRST_ALPHA_VERSION } from "./lib/a0-release-identity.ts";
import { a0ReleaseEventAssets, validateA0ReleaseEvent } from "./lib/a0-release-event.ts";

type JsonRecord = Record<string, unknown>;

function run(command: string, arguments_: readonly string[], cwd: string): void {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`FADENO_A0_RELEASE_EVENT_COMMAND:${command}\n${result.stdout}${result.stderr}`);
  }
}

function requiredString(value: JsonRecord, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) throw new TypeError("FADENO_A0_RELEASE_EVENT_ASSET");
  return result;
}

async function download(url: string): Promise<Buffer> {
  const token = process.env["GITHUB_TOKEN"];
  if (!token) throw new TypeError("FADENO_A0_RELEASE_EVENT_TOKEN");
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "User-Agent": "fadeno-a0-release-event-verifier",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new TypeError(`FADENO_A0_RELEASE_EVENT_DOWNLOAD:${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const root = process.cwd();
const eventPath = process.env["GITHUB_EVENT_PATH"];
if (!eventPath) throw new TypeError("FADENO_A0_RELEASE_EVENT_PATH");
const event = JSON.parse(readFileSync(eventPath, "utf8")) as unknown;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: root, encoding: "utf8" }).trim();
const tagCommit = execFileSync("git", ["rev-parse", `${A0_FIRST_ALPHA_TAG}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const expectedReleaseNotes = readFileSync(join(root, `docs/releases/${A0_FIRST_ALPHA_VERSION}.md`), "utf8");
const eventErrors = validateA0ReleaseEvent({ event, sourceCommit, tagCommit, expectedReleaseNotes });
if (eventErrors.length > 0) throw new Error(eventErrors.join("\n"));

const filename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
const assets = a0ReleaseEventAssets(event);
const findAsset = (name: string): JsonRecord => {
  const asset = assets.find((value) => value["name"] === name);
  if (!asset) throw new TypeError("FADENO_A0_RELEASE_EVENT_ASSET");
  return asset;
};
const archiveBytes = await download(requiredString(findAsset(filename), "url"));
const receiptBytes = await download(requiredString(findAsset(`${filename}.json`), "url"));
const receipt = JSON.parse(receiptBytes.toString("utf8")) as unknown;
const manifest = JSON.parse(readFileSync(join(root, "evidence/a0/release/docs-manifest.json"), "utf8")) as A0DocumentationManifest;
const expectedReceipt = createA0DocumentationArtifactReceipt(
  sourceCommit,
  createHash("sha256").update(archiveBytes).digest("hex"),
  manifest,
);
const receiptErrors = validateA0DocumentationArtifactReceipt(receipt, expectedReceipt);
if (receiptErrors.length > 0) throw new Error(receiptErrors.join("\n"));

const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-release-event-"));
try {
  const archive = join(temporary, filename);
  const extracted = join(temporary, "extracted");
  writeFileSync(archive, archiveBytes);
  mkdirSync(extracted);
  run("tar", ["-xzf", archive, "-C", extracted], root);
  const extractedRoot = join(extracted, `fadeno-docs-${A0_FIRST_ALPHA_VERSION}`);
  const treeErrors = validateA0DocumentationArtifactTree(extractedRoot, manifest);
  const reconstructed = createA0DocumentationManifest(extractedRoot, new Set(manifest.files.map(({ path }) => path)));
  const manifestErrors = validateA0DocumentationManifest(manifest, reconstructed);
  const errors = [...treeErrors, ...manifestErrors];
  if (errors.length > 0) throw new Error(errors.join("\n"));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`A0 release event passed (${A0_FIRST_ALPHA_TAG}, exact notes and closed documentation assets, ${sourceCommit})`);
