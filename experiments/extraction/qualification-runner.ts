import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runBrowserPreflight } from "../browser-preflight.ts";
import type { BrowserPreflightResult } from "../browser-preflight.ts";
import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { inspectExperimentSource } from "../../scripts/lib/experiment-source.ts";
import {
  assertContainedOutput,
  emitAcceptedHandler,
  ExtractionCandidate,
  runQualificationBoundary,
} from "./candidate.ts";
import type { GeneratedHandler } from "./candidate.ts";
import {
  EXTRACTION_ACCEPTED_CLASSES,
  EXTRACTION_REJECTION_CLASSES,
} from "./fixtures/catalog.ts";
import {
  EXTRACTION_DIAGNOSTIC_EXPECTATIONS,
} from "./qualification-contract.ts";
import {
  verifyExtractionQualificationReport,
} from "./qualification-report.ts";
import type { ExtractionQualificationReport } from "./qualification-report.ts";
import type { GeneratedInventory } from "./qualification-proof.ts";
import { decideExtractionObservations } from "./qualification-proof.ts";
import {
  extractionQualificationRunId,
  publishExtractionQualificationEvidence,
} from "./qualification-result.ts";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const root = join(experimentRoot, "../..");

function sourceIdentity(requireClean: boolean): Readonly<{ commit: string; dirty: boolean }> {
  return inspectExperimentSource(root, { requireClean });
}

function generatedInventory(
  files: readonly GeneratedHandler[],
  generatedRoot: string,
): GeneratedInventory {
  return {
    schemaVersion: 1,
    files: files.map((file) => ({
      fixtureId: file.fixtureId,
      path: `generated/${relative(generatedRoot, file.path).split(sep).join("/")}`,
      sha256: file.sha256,
      bytes: file.bytes,
      handlerIdentity: file.handlerIdentity,
    })),
  };
}

function exactFiles(rootDirectory: string): string[] {
  const files: string[] = [];
  const pending = [rootDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("FADENO_EXTRACTION_QUALIFICATION_SYMLINK");
      if (entry.isDirectory()) pending.push(path);
      else files.push(relative(rootDirectory, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

export function observeOutputSafety(controlRoot: string): boolean {
  if (process.env.FADENO_EXTRACTION_SEEDED_OUTPUT_SAFETY_FAILURE === "1") return false;
  const outside = join(controlRoot, "outside");
  const contained = join(controlRoot, "contained");
  mkdirSync(outside, { recursive: true });
  mkdirSync(contained, { recursive: true });
  const rejects = (rootPath: string, destination: string): boolean => {
    try {
      assertContainedOutput(rootPath, destination);
      return false;
    } catch (error: unknown) {
      return error instanceof Error && error.message.startsWith("FADENO_EXTRACTION_OUTPUT_");
    }
  };
  const traversal = rejects(contained, join(contained, "../escape.js"));
  const linkedRoot = join(controlRoot, "linked-root");
  symlinkSync(outside, linkedRoot, "dir");
  const rootSymlink = rejects(linkedRoot, join(linkedRoot, "escape.js"));
  const linkedAncestor = join(controlRoot, "linked-ancestor");
  symlinkSync(outside, linkedAncestor, "dir");
  const nestedRoot = join(linkedAncestor, "not-created");
  const ancestorSymlink = rejects(nestedRoot, join(nestedRoot, "escape.js"));
  const intermediateTarget = join(outside, "existing");
  mkdirSync(intermediateTarget);
  const intermediateLink = join(controlRoot, "intermediate-link");
  symlinkSync(outside, intermediateLink, "dir");
  const intermediateRoot = join(intermediateLink, "existing", "not-created");
  const intermediateSymlink = rejects(
    intermediateRoot,
    join(intermediateRoot, "escape.js"),
  );
  return traversal && rootSymlink && ancestorSymlink && intermediateSymlink;
}

export function assertNoQualificationCanary(
  bodies: readonly (string | Buffer)[],
  canaries: readonly string[],
): void {
  if (canaries.some((canary) => bodies.some((body) => body.includes(canary)))) {
    throw new Error("FADENO_EXTRACTION_QUALIFICATION_CANARY_LEAK");
  }
}

export async function executeExtractionQualification(options: Readonly<{
  requireClean: boolean;
  requireReference: boolean;
}>): Promise<void> {
  const source = sourceIdentity(options.requireClean);
  const outputRoot = join(root, "output/playwright/extraction-qualification");
  const runnerOutput = join(root, "output/playwright/extraction-qualification-runner");
  const comparisonRoot = join(root, "output/playwright/extraction-qualification-compare");
  rmSync(outputRoot, { recursive: true, force: true });
  rmSync(runnerOutput, { recursive: true, force: true });
  rmSync(comparisonRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const generatedRoot = join(outputRoot, "generated");
  const comparisonGenerated = join(comparisonRoot, "generated");

  const diagnostics = [];
  const canaries: string[] = [];
  let rejectedBoundariesPass = true;
  let deterministicGenerationPass = true;
  let inventory: GeneratedInventory;
  const candidate = new ExtractionCandidate();
  try {
    for (const fixtureId of EXTRACTION_REJECTION_CLASSES) {
    const canary = `fadeno-${fixtureId}-${randomUUID()}`;
    canaries.push(canary);
    let writerStarted = false;
    let serverStarted = false;
    let browserStarted = false;
    try {
      const diagnostic = runQualificationBoundary(candidate.analyze(fixtureId), canary, {
        emitBrowserArtifact() { writerStarted = true; },
        startServer() { serverStarted = true; },
        startBrowser() { browserStarted = true; },
      });
      const expected = EXTRACTION_DIAGNOSTIC_EXPECTATIONS[fixtureId];
      if (process.env.FADENO_EXTRACTION_SEEDED_BOUNDARY_FAILURE === fixtureId) {
        throw new Error(`seeded boundary failure: ${fixtureId}`);
      }
      if (
        !diagnostic ||
        diagnostic.id !== expected.id ||
        diagnostic.message !== expected.message ||
        diagnostic.explanation !== expected.explanation ||
        diagnostic.correction !== expected.correction ||
        JSON.stringify(diagnostic).includes(canary) ||
        writerStarted || serverStarted || browserStarted
      ) throw new Error("boundary observation differs");
      diagnostics.push({ status: "passed", fixtureId, ...diagnostic });
    } catch (error: unknown) {
      rejectedBoundariesPass = false;
      diagnostics.push({
        status: "failed",
        fixtureId,
        failure: error instanceof Error ? error.message : String(error),
        writerStarted,
        serverStarted,
        browserStarted,
      });
    }
  }
  writeFileSync(
    join(outputRoot, "rejected-diagnostics.json"),
    `${JSON.stringify({ schemaVersion: 1, diagnostics }, null, 2)}\n`,
  );

  const generated: GeneratedHandler[] = [];
  const comparison: GeneratedHandler[] = [];
  for (const fixtureId of EXTRACTION_ACCEPTED_CLASSES) {
    const analysis = candidate.analyze(fixtureId);
    generated.push(emitAcceptedHandler(analysis, generatedRoot));
    comparison.push(emitAcceptedHandler(analysis, comparisonGenerated));
  }
  for (let index = 0; index < generated.length; index += 1) {
    const first = generated[index]!;
    const second = comparison[index]!;
    if (
      first.fixtureId !== second.fixtureId ||
      first.sha256 !== second.sha256 ||
      first.bytes !== second.bytes ||
      first.handlerIdentity !== second.handlerIdentity ||
      !readFileSync(first.path).equals(readFileSync(second.path))
    ) deterministicGenerationPass = false;
  }
  inventory = generatedInventory(generated, generatedRoot);
  writeFileSync(
    join(generatedRoot, "inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  } finally {
    candidate[Symbol.dispose]();
  }
  const outputSafetyPass = observeOutputSafety(
    join(comparisonRoot, "output-safety-control"),
  );

  const preflight = options.requireReference
    ? await runBrowserPreflight(root, {
        requireReference: true,
        maxReferenceWaitMilliseconds: Number(process.env.FADENO_PREFLIGHT_WAIT_MS) || 0,
      })
    : { schemaVersion: 1, classification: "local", observedAt: new Date().toISOString() };
  const startedAt = new Date().toISOString();
  writeFileSync(join(outputRoot, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`);
  writeFileSync(join(outputRoot, "source.json"), `${JSON.stringify({
    schemaVersion: 1,
    repository: "https://github.com/f-gueguen/fadeno",
    ...source,
  }, null, 2)}\n`);

  const require = createRequire(import.meta.url);
  const cli = require.resolve("@playwright/test/cli");
  const child = spawnSync(
    process.execPath,
    [cli, "test", "--config", join(experimentRoot, "qualification.playwright.config.ts")],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        FADENO_EXTRACTION_GENERATED: generatedRoot,
        FADENO_EXTRACTION_QUALIFICATION_OUTPUT: outputRoot,
        FADENO_EXTRACTION_QUALIFICATION_RUNNER_OUTPUT: runnerOutput,
      },
    },
  );
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  if (child.status !== 0 || child.error || child.signal) {
    throw new Error(`FADENO_EXTRACTION_QUALIFICATION_CHILD: ${child.status ?? child.signal}`);
  }
  const observations = verifyExtractionQualificationReport(
    readJsonDocument(join(outputRoot, "qualification-report.json")) as
      ExtractionQualificationReport,
    inventory,
    (path) => readFileSync(join(outputRoot, path)),
  );
  const identityPass = [...observations.values()].every((observation) =>
    observation.fixtures.every((fixture) =>
      fixture.status === "passed" || fixture.failureStage !== "identity"
    )
  );
  const outcome = decideExtractionObservations(observations, {
    rejectedBoundariesPass,
    identityPass,
    deterministicGenerationPass,
    outputSafetyPass,
  });
  writeFileSync(join(outputRoot, "decision.json"), `${JSON.stringify({
    schemaVersion: 1,
    ...outcome,
    rejectedBoundariesPass,
    identityPass,
    deterministicGenerationPass,
    outputSafetyPass,
  }, null, 2)}\n`);
  const expectedFiles = [
    ...EXTRACTION_ACCEPTED_CLASSES.map((fixtureId) => `generated/${fixtureId}.js`),
    "generated/inventory.json",
    "decision.json",
    "preflight.json",
    "qualification-observations/chromium.json",
    "qualification-observations/firefox.json",
    "qualification-observations/webkit.json",
    "qualification-report.json",
    "rejected-diagnostics.json",
    "source.json",
  ].sort();
  if (JSON.stringify(exactFiles(outputRoot)) !== JSON.stringify(expectedFiles)) {
    throw new Error("FADENO_EXTRACTION_QUALIFICATION_EVIDENCE_SET");
  }
  const evidence = exactFiles(outputRoot).map((path) =>
    readFileSync(join(outputRoot, path), "utf8")
  );
  const transient = existsSync(runnerOutput) ? exactFiles(runnerOutput).map((path) =>
    readFileSync(join(runnerOutput, path), "utf8")
  ) : [];
  let canarySensorRejectedControl = false;
  try {
    assertNoQualificationCanary([`negative-control:${canaries[0]}`], canaries);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "FADENO_EXTRACTION_QUALIFICATION_CANARY_LEAK"
    ) canarySensorRejectedControl = true;
  }
  if (!canarySensorRejectedControl) {
    throw new Error("FADENO_EXTRACTION_QUALIFICATION_CANARY_SENSOR_CONTROL");
  }
  assertNoQualificationCanary([...evidence, ...transient], canaries);
  inspectExperimentSource(root, {
    requireClean: options.requireClean,
    expectedCommit: source.commit,
  });
  if (options.requireReference) {
    const published = publishExtractionQualificationEvidence({
      root,
      runDirectory: outputRoot,
      runId: extractionQualificationRunId(startedAt, source.commit),
      sourceCommit: source.commit,
      startedAt,
      completedAt: new Date().toISOString(),
      preflight: preflight as BrowserPreflightResult,
      decision: outcome.decision,
      accepted: outcome.accepted,
    });
    console.log(`extraction qualification manifest published (${published.manifestPath})`);
  }
  rmSync(runnerOutput, { recursive: true, force: true });
  rmSync(comparisonRoot, { recursive: true, force: true });
  console.log(
    `extraction qualification completed with ${outcome.decision} decision (${outcome.accepted.length} accepted; 10 rejected boundaries)`,
  );
}
