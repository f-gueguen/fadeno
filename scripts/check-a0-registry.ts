import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateRegistryCaptureSource, validateRegistryDiscovery } from "./lib/a0-registry.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const requiredPaths = [
  "evidence/a0/registry-discovery.json",
  "evidence/a0/registry-preflight/authentication-required.json",
  "evidence/a0/registry-preflight/owned-package.json",
  "scripts/capture-a0-registry.ts",
];
for (const path of requiredPaths) {
  if (!tracked.has(path)) throw new Error(`A0 registry evidence is not tracked: ${path}`);
}
const errors = [
  ...validateRegistryDiscovery(JSON.parse(readFileSync(join(root, requiredPaths[0]), "utf8")) as unknown),
  ...validateRegistryCaptureSource(readFileSync(join(root, "scripts/capture-a0-registry.ts"), "utf8")),
];
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 registry preflight passed (read-only operations, blocked identity, no publication)");
