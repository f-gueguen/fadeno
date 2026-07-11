import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalCiStep } from "./lib/local-ci-contract.ts";
import { runLocalCi } from "./lib/local-ci-runner.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function gitOutput(args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_LOCAL_CI_GIT:${args.join(" ")}`);
  return result.stdout.trim();
}

try {
  runLocalCi({
    gitHead: () => gitOutput(["rev-parse", "HEAD"]),
    gitStatus: () => gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]),
    runStep: (step: LocalCiStep) => {
      const result = spawnSync("pnpm", [...step.args], { cwd: root, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`FADENO_LOCAL_CI_STEP:${step.name}`);
    },
    report: (message) => console.log(message),
  }, process.argv.slice(2));
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof Error && error.message.startsWith("FADENO_LOCAL_CI_USAGE:")
    ? 64
    : 1;
}
