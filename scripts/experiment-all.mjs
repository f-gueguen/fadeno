import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  evaluateExperimentCommand,
  registryLoadFailureResult,
} from "./lib/experiment-contract.mjs";
import { loadExperimentRegistry } from "./lib/experiment-validation.mjs";

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
process.exit(result.exitCode);
