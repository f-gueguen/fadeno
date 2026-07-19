import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { A0_FIRST_ALPHA_TAG, A0_FIRST_ALPHA_VERSION } from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0DocumentationFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

export type A0DocumentationManifest = Readonly<{
  schemaVersion: 1;
  packageVersion: typeof A0_FIRST_ALPHA_VERSION;
  sourceTag: typeof A0_FIRST_ALPHA_TAG;
  artifactFilename: string;
  aggregateSha256: string;
  files: readonly A0DocumentationFile[];
}>;

export type A0DocumentationArtifactReceipt = Readonly<{
  schemaVersion: 1;
  packageVersion: typeof A0_FIRST_ALPHA_VERSION;
  sourceTag: typeof A0_FIRST_ALPHA_TAG;
  sourceCommit: string;
  artifactFilename: string;
  artifactSha256: string;
  documentationAggregateSha256: string;
  fileCount: number;
}>;

const digestPattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePath(path: string): boolean {
  return path.length > 0
    && !isAbsolute(path)
    && !path.includes("\\")
    && normalize(path) === path
    && relative(".", path) === path
    && path !== ".."
    && !path.startsWith(`..${sep}`);
}

export function isA0DocumentationPath(path: string): boolean {
  return (!path.includes("/") && path.endsWith(".md"))
    || path === "packages/framework/README.md"
    || path === "packages/framework/CHANGELOG.md"
    || (path.startsWith("docs/") && path.endsWith(".md"));
}

export function a0DocumentationFiles(root: string, tracked: ReadonlySet<string>): readonly A0DocumentationFile[] {
  const files = [...tracked].filter(isA0DocumentationPath).sort().map((path) => {
    if (!safePath(path)) throw new TypeError(`FADENO_A0_DOCS_PATH:${path}`);
    const absolute = join(root, path);
    const status = lstatSync(absolute);
    if (!status.isFile() || status.isSymbolicLink()) throw new TypeError(`FADENO_A0_DOCS_FILE:${path}`);
    const bytes = readFileSync(absolute);
    return Object.freeze({
      path,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });
  if (!files.some(({ path }) => path === "docs/releases/0.1.0-alpha.0.md")) {
    throw new TypeError("FADENO_A0_DOCS_RELEASE_NOTES");
  }
  return Object.freeze(files);
}

export function createA0DocumentationManifest(root: string, tracked: ReadonlySet<string>): A0DocumentationManifest {
  const files = a0DocumentationFiles(root, tracked);
  const aggregateSha256 = createHash("sha256")
    .update(files.map(({ path, bytes, sha256 }) => `${path}\0${bytes}\0${sha256}\n`).join(""))
    .digest("hex");
  return Object.freeze({
    schemaVersion: 1,
    packageVersion: A0_FIRST_ALPHA_VERSION,
    sourceTag: A0_FIRST_ALPHA_TAG,
    artifactFilename: `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`,
    aggregateSha256,
    files,
  });
}

export function validateA0DocumentationManifest(
  value: unknown,
  expected: A0DocumentationManifest,
): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return Object.freeze(["A0 documentation manifest must be an object"]);
  if (Object.keys(value).sort().join("\0") !== [
    "aggregateSha256", "artifactFilename", "files", "packageVersion", "schemaVersion", "sourceTag",
  ].sort().join("\0")) errors.push("A0 documentation manifest keys drifted");
  if (value["schemaVersion"] !== 1
    || value["packageVersion"] !== A0_FIRST_ALPHA_VERSION
    || value["sourceTag"] !== A0_FIRST_ALPHA_TAG
    || value["artifactFilename"] !== `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`) {
    errors.push("A0 documentation identity drifted");
  }
  if (value["aggregateSha256"] !== expected.aggregateSha256 || !digestPattern.test(String(value["aggregateSha256"]))) {
    errors.push("A0 documentation aggregate drifted");
  }
  if (JSON.stringify(value["files"]) !== JSON.stringify(expected.files)) {
    errors.push("A0 documentation files drifted");
  }
  return Object.freeze(errors);
}

export function createA0DocumentationArtifactReceipt(
  sourceCommit: string,
  artifactSha256: string,
  manifest: A0DocumentationManifest,
): A0DocumentationArtifactReceipt {
  if (!commitPattern.test(sourceCommit) || !digestPattern.test(artifactSha256)) {
    throw new TypeError("FADENO_A0_DOCS_RECEIPT_IDENTITY");
  }
  return Object.freeze({
    schemaVersion: 1,
    packageVersion: A0_FIRST_ALPHA_VERSION,
    sourceTag: A0_FIRST_ALPHA_TAG,
    sourceCommit,
    artifactFilename: manifest.artifactFilename,
    artifactSha256,
    documentationAggregateSha256: manifest.aggregateSha256,
    fileCount: manifest.files.length,
  });
}

export function validateA0DocumentationArtifactReceipt(
  value: unknown,
  expected: A0DocumentationArtifactReceipt,
): readonly string[] {
  if (!isRecord(value)) return Object.freeze(["A0 documentation artifact receipt must be an object"]);
  if (Object.keys(value).sort().join("\0") !== Object.keys(expected).sort().join("\0")
    || JSON.stringify(value) !== JSON.stringify(expected)) {
    return Object.freeze(["A0 documentation artifact receipt drifted"]);
  }
  return Object.freeze([]);
}

function artifactTreePaths(root: string): readonly string[] {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (!safePath(path)) throw new TypeError(`FADENO_A0_DOCS_ARTIFACT_PATH:${path}`);
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) throw new TypeError(`FADENO_A0_DOCS_ARTIFACT_LINK:${path}`);
      if (status.isDirectory()) visit(absolute);
      else if (status.isFile()) paths.push(path);
      else throw new TypeError(`FADENO_A0_DOCS_ARTIFACT_ENTRY:${path}`);
    }
  };
  visit(root);
  return Object.freeze(paths.sort());
}

export function validateA0DocumentationArtifactTree(
  root: string,
  manifest: A0DocumentationManifest,
): readonly string[] {
  try {
    const actual = artifactTreePaths(root);
    const expected = manifest.files.map(({ path }) => path).slice().sort();
    return JSON.stringify(actual) === JSON.stringify(expected)
      ? Object.freeze([])
      : Object.freeze(["A0 documentation artifact tree drifted"]);
  } catch {
    return Object.freeze(["A0 documentation artifact tree is unsafe"]);
  }
}
