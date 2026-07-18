import { spawnSync } from "node:child_process";

import {
  runRegistryOrganizationPreflight,
  runRegistryPreflight,
  type RegistryCommand,
  type RegistryCommandResult,
} from "./lib/a0-registry.ts";

type Options =
  | Readonly<{ candidate: string | null; organization: null }>
  | Readonly<{ candidate: string; organization: string }>;

function argumentsOptions(arguments_: readonly string[]): Options {
  if (arguments_.length === 0) return Object.freeze({ candidate: null, organization: null });
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if ((flag !== "--candidate" && flag !== "--organization") || !value || values.has(flag)) {
      throw new Error("Usage: pnpm capture:a0-registry [--organization <scope> --candidate <package-name>]");
    }
    values.set(flag, value);
  }
  const candidate = values.get("--candidate") ?? null;
  const organization = values.get("--organization") ?? null;
  if (organization !== null && candidate === null) {
    throw new Error("Usage: pnpm capture:a0-registry [--organization <scope> --candidate <package-name>]");
  }
  return Object.freeze({ candidate, organization });
}

function run(command: RegistryCommand): RegistryCommandResult {
  const result = spawnSync(command.executable, command.arguments, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error) return Object.freeze({ exitCode: null, stdout: "", stderr: result.error.message });
  return Object.freeze({ exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
}

const options = argumentsOptions(process.argv.slice(2));
const result = options.organization === null
  ? runRegistryPreflight(options.candidate, run)
  : runRegistryOrganizationPreflight(options.organization, options.candidate, run);
console.log(JSON.stringify(result, null, 2));
if (result.blocker !== null) process.exitCode = 2;
