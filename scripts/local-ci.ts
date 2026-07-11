import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertStableLocalCiSnapshot, LOCAL_CI_STEPS } from "./lib/local-ci-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function gitOutput(args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_LOCAL_CI_GIT:${args.join(" ")}`);
  return result.stdout.trim();
}

function gitHead(root: string): string {
  void root;
  return gitOutput(["rev-parse", "HEAD"]);
}

function gitStatus(root: string): string {
  void root;
  return gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]);
}

function assertRepository(expectedHead: string, stage: string): void {
  assertStableLocalCiSnapshot(expectedHead, gitHead(root), gitStatus(root), stage);
}

function run(): void {
  if (process.argv.length !== 2) {
    console.error(`FADENO_LOCAL_CI_USAGE: unsupported arguments: ${process.argv.slice(2).join(" ")}`);
    process.exitCode = 64;
    return;
  }
  const startHead = gitHead(root);
  assertRepository(startHead, "start");
  for (const step of LOCAL_CI_STEPS) {
    const result = spawnSync("pnpm", [...step.args], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`FADENO_LOCAL_CI_STEP:${step.name}`);
    assertRepository(startHead, step.name);
  }
  console.log(`local CI passed at ${startHead}`);
}

try {
  run();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
