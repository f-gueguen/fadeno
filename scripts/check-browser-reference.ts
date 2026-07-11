import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyFrozenReference } from "./lib/browser-reference-contract.ts";
import { readJsonDocument } from "./lib/experiment-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "experiments/reference-environment.json");
const reference = readJsonDocument(path);
verifyFrozenReference(
  readFileSync(path),
  readFileSync(join(root, "experiments/reference-environment.sha256"), "utf8"),
);
if (
  reference.host.provider !== "github-actions" ||
  reference.container.runtimeImage !==
    "mcr.microsoft.com/playwright@sha256:111dde95859f2c659291cb60e698f9048a8fc30b35b4ddb7c90f9cb5b73062d9"
) throw new Error("frozen browser reference identity differs");

console.log("browser reference contract passed (whole frozen hosted document remains unchanged)");
