import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { runSeededBoundaryPipeline } from "./boundary-pipeline.ts";
import type { ExtractionRunReport } from "./contract.ts";
import { verifyExtractionRunReport } from "./evidence-proof.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const experimentRoot = join(root, "experiments/extraction");

export function executeExtractionHarness(): void {
  const output = join(root, "output/playwright/extraction");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const canary = process.env.FADENO_EXTRACTION_SECRET_CANARY ?? `fadeno-canary-${randomUUID()}`;
  let writerStarted = false;
  let serverStarted = false;
  let browserStarted = false;
  const diagnostic = runSeededBoundaryPipeline({
    handler: {
      sourceName: "rejected/server-secret.ts",
      source: readFileSync(
        join(experimentRoot, "fixtures/rejected/server-secret.ts"),
        "utf8",
      ),
    },
    serverCapability: { secret: canary },
    emitBrowserArtifact(source) {
      writerStarted = true;
      writeFileSync(join(output, "forbidden-browser-artifact.js"), source);
    },
    startServer() { serverStarted = true; },
    startBrowser() { browserStarted = true; },
  });
  if (!diagnostic) throw new Error("FADENO_EXTRACTION_SEEDED_REJECTION_MISSING");
  const serialized = JSON.stringify(diagnostic);
  if (
    diagnostic.source !== "rejected/server-secret.ts" ||
    diagnostic.range.line !== 1 ||
    diagnostic.range.column !== 24 ||
    serialized.includes(canary) ||
    writerStarted ||
    serverStarted ||
    browserStarted
  ) {
    throw new Error("FADENO_EXTRACTION_REJECTED_CONTROL");
  }
  writeFileSync(
    join(output, "rejected-diagnostic.json"),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
  );

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
  verifyExtractionRunReport(
    readJsonDocument(join(output, "run-report.json")) as ExtractionRunReport,
    (path) => readFileSync(join(output, path)),
  );
  const evidenceText = [serialized, result.stdout ?? "", result.stderr ?? ""];
  const pending = [output];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else evidenceText.push(readFileSync(path, "utf8"));
    }
  }
  if (evidenceText.some((value) => value.includes(canary))) {
    throw new Error("FADENO_EXTRACTION_SECRET_CANARY_LEAK");
  }
  console.log(`extraction rejected seed: ${diagnostic.id} at ${diagnostic.source}:${diagnostic.range.line}:${diagnostic.range.column}`);
}
