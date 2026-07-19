import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createA0DocumentationManifest,
  validateA0DocumentationManifest,
} from "./lib/a0-docs-artifact.ts";

const root = process.cwd();
const output = join(root, "evidence/a0/release/docs-manifest.json");
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const manifest = createA0DocumentationManifest(root, tracked);
const normalized = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = JSON.parse(readFileSync(output, "utf8")) as unknown;
  const errors = validateA0DocumentationManifest(current, manifest);
  if (errors.length > 0 || readFileSync(output, "utf8") !== normalized) throw new Error(errors.join("\n") || "FADENO_A0_DOCS_MANIFEST_BYTES");
} else {
  writeFileSync(output, normalized, "utf8");
}
console.log(`A0 documentation manifest passed (${manifest.files.length} files, ${manifest.aggregateSha256.slice(0, 12)})`);
