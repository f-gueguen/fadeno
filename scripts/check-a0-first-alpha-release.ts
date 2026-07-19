import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadA0FirstAlphaReleaseContext,
  validateA0FirstAlphaRelease,
} from "./lib/a0-first-alpha-release.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0FirstAlphaRelease(loadA0FirstAlphaReleaseContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

const clean = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim() === "";
if (clean) {
  const output = mkdtempSync(join(tmpdir(), "fadeno-a0-docs-check-"));
  try {
    const result = spawnSync(process.execPath, [
      "--no-warnings", "--experimental-strip-types", "scripts/build-a0-docs-artifact.ts", "--ref", "HEAD", "--output", output,
    ], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || result.signal !== null) throw new Error(`FADENO_A0_DOCS_ARTIFACT_CHECK\n${result.stdout}${result.stderr}`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

console.log(`A0 first-alpha release source passed (0.1.0-alpha.1 recovery, documentation artifact ${clean ? "replayed" : "deferred until clean commit"})`);
