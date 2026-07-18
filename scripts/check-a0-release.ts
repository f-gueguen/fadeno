import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadA0ReleaseContext, validateA0Release } from "./lib/a0-release-contract.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0Release(loadA0ReleaseContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-release-"));
try {
  mkdirSync(join(temporary, ".changeset"), { recursive: true });
  mkdirSync(join(temporary, "packages/framework"), { recursive: true });
  cpSync(join(root, ".changeset/config.json"), join(temporary, ".changeset/config.json"));
  cpSync(join(root, "packages/framework/package.json"), join(temporary, "packages/framework/package.json"));
  writeFileSync(join(temporary, "package.json"), JSON.stringify({ name: "fadeno-release-plan", private: true, packageManager: "pnpm@11.7.0" }, null, 2));
  writeFileSync(join(temporary, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: temporary, encoding: "utf8" });
  execFileSync("git", ["config", "user.name", "Fadeno release fixture"], { cwd: temporary, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "release-fixture@fadeno.invalid"], { cwd: temporary, encoding: "utf8" });
  execFileSync("git", ["add", "."], { cwd: temporary, encoding: "utf8" });
  execFileSync("git", ["commit", "--quiet", "--message", "seed"], { cwd: temporary, encoding: "utf8" });
  execFileSync("git", ["switch", "--create", "candidate"], { cwd: temporary, encoding: "utf8" });
  cpSync(join(root, ".changeset/early-fadeno-alpha.md"), join(temporary, ".changeset/early-fadeno-alpha.md"));
  execFileSync(join(root, "node_modules/.bin/changeset"), ["pre", "enter", "alpha"], { cwd: temporary, encoding: "utf8" });
  execFileSync(join(root, "node_modules/.bin/changeset"), ["status", "--output", "release-plan.json"], { cwd: temporary, encoding: "utf8" });
  const plan = JSON.parse(readFileSync(join(temporary, "release-plan.json"), "utf8")) as { releases?: Array<{ name?: string; newVersion?: string; type?: string }> };
  const release = plan.releases?.find(({ name }) => name === "@fadeno/framework");
  if (release?.newVersion !== "0.1.0-alpha.0" || release.type !== "minor") throw new Error("FADENO_A0_FIRST_ALPHA_PLAN");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const refusal = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "scripts/assert-a0-publication.ts"], { cwd: root, encoding: "utf8" });
if (refusal.status === 0 || !`${refusal.stdout}${refusal.stderr}`.includes("FADENO_RELEASE_PRERELEASE_VERSION")) {
  throw new Error("FADENO_A0_SEED_PUBLICATION_NOT_REFUSED");
}

console.log("A0 release contract passed (public seed, first alpha plan, package/SBOM, workflow, refusal/recovery, rollback)");
