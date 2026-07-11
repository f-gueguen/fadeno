import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { senseSeededServerImport } from "./boundary-sensor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const experimentRoot = join(root, "experiments/extraction");

export function executeExtractionHarness(): void {
  const rejectedOutput = join(root, "output/playwright/extraction-rejected");
  rmSync(rejectedOutput, { recursive: true, force: true });
  const diagnostic = senseSeededServerImport(
    join(experimentRoot, "fixtures/rejected/server-secret.ts"),
  );
  const serialized = JSON.stringify(diagnostic);
  if (
    diagnostic.source !== "server-secret.ts" ||
    diagnostic.range.line !== 1 ||
    diagnostic.range.column !== 24 ||
    serialized.includes(process.env.FADENO_EXTRACTION_SECRET_CANARY ?? "never-present-canary") ||
    existsSync(rejectedOutput)
  ) {
    throw new Error("FADENO_EXTRACTION_REJECTED_CONTROL");
  }

  const output = join(root, "output/playwright/extraction");
  rmSync(output, { recursive: true, force: true });
  const require = createRequire(import.meta.url);
  const cli = require.resolve("@playwright/test/cli");
  const result = spawnSync(
    process.execPath,
    [cli, "test", "--config", join(experimentRoot, "playwright.config.ts")],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FADENO_EXTRACTION_OUTPUT: output },
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`FADENO_EXTRACTION_ACCEPTED_CONTROL: ${result.status ?? result.signal}`);
  }
  console.log(`extraction rejected seed: ${diagnostic.id} at ${diagnostic.source}:${diagnostic.range.line}:${diagnostic.range.column}`);
}
