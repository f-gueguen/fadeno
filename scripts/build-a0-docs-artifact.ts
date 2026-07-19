import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  createA0DocumentationArtifactReceipt,
  createA0DocumentationManifest,
  validateA0DocumentationArtifactTree,
  validateA0DocumentationManifest,
  type A0DocumentationManifest,
} from "./lib/a0-docs-artifact.ts";
import { A0_FIRST_ALPHA_TAG, A0_FIRST_ALPHA_VERSION } from "./lib/a0-release-identity.ts";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal !== null) throw new TypeError(`FADENO_A0_DOCS_COMMAND:${command}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

const root = process.cwd();
const ref = argument("--ref") ?? A0_FIRST_ALPHA_TAG;
const requestedOutput = argument("--output");
if (!requestedOutput) throw new TypeError("FADENO_A0_DOCS_ARTIFACT_USAGE");
const sourceCommit = execFileSync("git", ["rev-parse", `${ref}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new TypeError("FADENO_A0_DOCS_SOURCE_COMMIT");
const manifest = JSON.parse(execFileSync("git", ["show", `${sourceCommit}:evidence/a0/release/docs-manifest.json`], {
  cwd: root,
  encoding: "utf8",
})) as A0DocumentationManifest;
if (!Array.isArray(manifest.files)) throw new TypeError("FADENO_A0_DOCS_MANIFEST");
const output = resolve(requestedOutput);
if (existsSync(output) && readdirSync(output).length > 0) throw new TypeError("FADENO_A0_DOCS_OUTPUT_EXISTS");
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-docs-artifact-"));
try {
  const filename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
  const first = join(temporary, `first-${filename}`);
  const second = join(temporary, `second-${filename}`);
  const prefix = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}/`;
  const paths = manifest.files.map((entry: { path?: unknown }) => {
    if (typeof entry.path !== "string") throw new TypeError("FADENO_A0_DOCS_MANIFEST");
    return entry.path;
  });
  for (const destination of [first, second]) {
    run("git", ["archive", "--format=tar.gz", `--prefix=${prefix}`, `--output=${destination}`, sourceCommit, "--", ...paths], root);
  }
  const firstBytes = readFileSync(first);
  const secondBytes = readFileSync(second);
  if (!firstBytes.equals(secondBytes)) throw new TypeError("FADENO_A0_DOCS_NONDETERMINISTIC");
  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  run("tar", ["-xzf", first, "-C", extracted], root);
  const extractedRoot = join(extracted, prefix.slice(0, -1));
  const tracked = new Set<string>(paths);
  const reconstructed = createA0DocumentationManifest(extractedRoot, tracked);
  const errors = [
    ...validateA0DocumentationArtifactTree(extractedRoot, manifest),
    ...validateA0DocumentationManifest(manifest, reconstructed),
  ];
  if (errors.length > 0) throw new TypeError(errors.join("\n"));
  const artifact = join(output, filename);
  writeFileSync(artifact, firstBytes);
  const receipt = createA0DocumentationArtifactReceipt(
    sourceCommit,
    createHash("sha256").update(firstBytes).digest("hex"),
    manifest,
  );
  if (receipt.artifactFilename !== basename(artifact)) throw new TypeError("FADENO_A0_DOCS_ARTIFACT_FILENAME");
  writeFileSync(join(output, `${filename}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`A0 documentation artifact passed (${filename}, ${paths.length} files, ${sourceCommit})`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
