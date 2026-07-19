import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { A0_FIRST_ALPHA_VERSION, A0_PACKAGE_NAME } from "./lib/a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "packages/framework");
const output = join(packageRoot, "sbom.spdx.json");
const raw = JSON.parse(execFileSync("npm", ["sbom", "--sbom-format", "spdx", "--omit", "dev"], {
  cwd: packageRoot,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})) as unknown;
if (!isRecord(raw) || raw["spdxVersion"] !== "SPDX-2.3" || !Array.isArray(raw["packages"])) {
  throw new Error("FADENO_A0_SBOM_INVALID_SOURCE");
}
const packages = raw["packages"] as JsonRecord[];
const framework = packages.find((entry) => entry["name"] === A0_PACKAGE_NAME);
const compiler = packages.find((entry) => entry["name"] === "typescript");
if (framework?.["versionInfo"] !== A0_FIRST_ALPHA_VERSION || compiler?.["versionInfo"] !== "7.0.2") {
  throw new Error("FADENO_A0_SBOM_DEPENDENCY_GRAPH");
}

raw["documentNamespace"] = `https://fadeno.dev/sbom/framework/${A0_FIRST_ALPHA_VERSION}`;
raw["creationInfo"] = {
  created: "2026-07-18T00:00:00Z",
  creators: ["Tool: npm/cli", "Tool: Fadeno deterministic SBOM normalizer"],
};
for (const entry of packages) {
  if (entry["name"] === "typescript") entry["packageFileName"] = "node_modules/typescript";
}
packages.sort((left, right) => String(left["SPDXID"]).localeCompare(String(right["SPDXID"])));
if (Array.isArray(raw["relationships"])) {
  (raw["relationships"] as JsonRecord[]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
const normalized = `${JSON.stringify(raw, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== normalized) throw new Error("FADENO_A0_SBOM_STALE");
} else {
  writeFileSync(output, normalized, "utf8");
}

console.log(`A0 SPDX SBOM passed (${A0_PACKAGE_NAME}@${A0_FIRST_ALPHA_VERSION}, typescript@7.0.2, deterministic normalization)`);
