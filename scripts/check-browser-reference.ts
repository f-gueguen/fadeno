import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonDocument } from "./lib/experiment-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localCi = readFileSync(join(root, "scripts/local-ci.ts"), "utf8");
const reference = readJsonDocument(join(root, "experiments/reference-environment.json"));

if (
  reference.host.provider !== "github-actions" ||
  reference.container.runtimeImage !==
    "mcr.microsoft.com/playwright@sha256:111dde95859f2c659291cb60e698f9048a8fc30b35b4ddb7c90f9cb5b73062d9" ||
  localCi.includes("FADENO_EXPECT_REFERENCE") ||
  localCi.includes("--qualify")
) {
  throw new Error("local merge validation must not alter or impersonate the frozen K0 reference");
}

console.log("browser reference contract passed (frozen hosted evidence remains non-local)");
