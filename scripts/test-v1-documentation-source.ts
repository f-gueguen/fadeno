import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkV1DocumentationAuthority } from "./lib/v1-documentation-authority.ts";

const root = mkdtempSync(join(tmpdir(), "fadeno-documentation-authority-"));
const tracked = new Set([
  "examples/authority.json",
  "examples/adapter-smoke/package.json",
  "examples/v1-app/documentation-source.json",
  "examples/v1-app/package.json",
  "examples/v1-app/src/page.tsx",
  "examples/v1-app/expected/result.json",
]);

try {
  mkdirSync(join(root, "examples/adapter-smoke"), { recursive: true });
  mkdirSync(join(root, "examples/v1-app/src"), { recursive: true });
  mkdirSync(join(root, "examples/v1-app/expected"), { recursive: true });
  mkdirSync(join(root, "examples/v1-app/scenarios"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { verify: "true" } }));
  writeFileSync(join(root, "examples/adapter-smoke/package.json"), "{}");
  writeFileSync(join(root, "examples/v1-app/package.json"), "{}");
  writeFileSync(join(root, "examples/v1-app/src/page.tsx"), "export default () => 'ok';\n");
  writeFileSync(join(root, "examples/v1-app/expected/result.json"), "{}\n");
  writeFileSync(join(root, "examples/authority.json"), JSON.stringify({
    schemaVersion: 1,
    canonicalApplication: "v1-app",
    supportingExamples: [{ path: "adapter-smoke", role: "package-adapter-smoke" }],
  }));
  const manifest = {
    schemaVersion: 1,
    applicationRoots: ["package.json", "src"],
    scenarioRoot: "scenarios",
    verificationGates: ["verify"],
    evidence: Object.fromEntries(
      ["success", "failure", "correction", "flow", "recovery", "staleRemoval"].map((kind) => [kind, ["expected/result.json"]]),
    ),
  };
  writeFileSync(join(root, "examples/v1-app/documentation-source.json"), JSON.stringify(manifest));
  const validErrors = checkV1DocumentationAuthority(root, tracked);
  if (validErrors.length > 0) throw new Error(`valid authority refused:\n${validErrors.join("\n")}`);

  manifest.evidence.failure = [];
  writeFileSync(join(root, "examples/v1-app/documentation-source.json"), JSON.stringify(manifest));
  const invalidErrors = checkV1DocumentationAuthority(root, tracked);
  if (!invalidErrors.includes("documentation evidence category is empty: failure")) {
    throw new Error("empty failure evidence was not refused");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 documentation source authority mutation tests passed");
