import { spawnSync } from "node:child_process";

import { runRegistryPreflight, type RegistryCommand, type RegistryCommandResult } from "./lib/a0-registry.ts";

function candidateArgument(arguments_: readonly string[]): string | null {
  if (arguments_.length === 0) return null;
  if (arguments_.length === 2 && arguments_[0] === "--candidate" && arguments_[1]) return arguments_[1];
  throw new Error("Usage: pnpm capture:a0-registry [--candidate <existing-package-name>]");
}

function run(command: RegistryCommand): RegistryCommandResult {
  const result = spawnSync(command.executable, command.arguments, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error) return Object.freeze({ exitCode: null, stdout: "", stderr: result.error.message });
  return Object.freeze({ exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
}

const result = runRegistryPreflight(candidateArgument(process.argv.slice(2)), run);
console.log(JSON.stringify(result, null, 2));
if (result.blocker !== null) process.exitCode = 2;
