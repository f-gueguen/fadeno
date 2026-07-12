import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  evaluateExperimentCommand,
  registryLoadFailureResult,
} from "./lib/experiment-contract.ts";
import { loadExperimentRegistry } from "./lib/experiment-validation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let result;

try {
  result = evaluateExperimentCommand(loadExperimentRegistry(root), args);
} catch (error) {
  result = registryLoadFailureResult(error);
}

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.executeQualified) {
  const verifiers: readonly (readonly [string, ...string[]])[] = [
    ["scripts/check-morph-harness.ts"],
    ["scripts/check-extraction-qualification.ts"],
    ["scripts/check-type-spine-qualification-evidence.ts", "experiments/type-spine/results/20260712T022123Z-122ba57-a1"],
    ["scripts/check-revalidation-qualification-evidence.ts"],
  ];
  try {
    for (const [script, ...scriptArgs] of verifiers) {
      process.stdout.write(execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...scriptArgs], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }));
    }
    console.log("all K0 qualification evidence passed (H1 NARROW, H2 GO, H3 NARROW, H4 GO)");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
process.exit(result.exitCode);
