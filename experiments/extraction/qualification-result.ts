import { copyFileSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import {
  sha256File,
  validateArtifactRecords,
  validateManifestSemantics,
} from "../../scripts/lib/experiment-contract.ts";
import {
  assertSchema,
  createContractValidators,
  loadExperimentRegistry,
  loadReferenceEnvironment,
} from "../../scripts/lib/experiment-validation.ts";
import {
  browserManifestEnvironment,
} from "../browser-preflight.ts";
import type { BrowserPreflightResult } from "../browser-preflight.ts";
import type { ExtractionDecision } from "./qualification-proof.ts";

type ArtifactRecord = Readonly<{ path: string; sha256: string; bytes: number }>;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactRecord(runDirectory: string, path: string): ArtifactRecord {
  return {
    path: relative(runDirectory, path).split(sep).join("/"),
    sha256: sha256File(path),
    bytes: statSync(path).size,
  };
}

function copyArtifact(
  runDirectory: string,
  source: string,
  destination: string,
): ArtifactRecord {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return artifactRecord(runDirectory, destination);
}

function files(root: string): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else found.push(path);
    }
  }
  return found.sort();
}

export function extractionQualificationRunId(startedAt: string, sourceCommit: string): string {
  const timestamp = `${startedAt.slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
  return `${timestamp}-${sourceCommit.slice(0, 7)}-a1`;
}

export function publishExtractionQualificationEvidence(options: Readonly<{
  root: string;
  runDirectory: string;
  runId: string;
  sourceCommit: string;
  startedAt: string;
  completedAt: string;
  preflight: BrowserPreflightResult;
  decision: ExtractionDecision;
  accepted: readonly string[];
}>): Readonly<{ manifestPath: string; runRecordPath: string }> {
  const { root, runDirectory, runId, sourceCommit, startedAt, completedAt,
    preflight, decision, accepted } = options;
  const lock = copyArtifact(
    runDirectory,
    join(root, "pnpm-lock.yaml"),
    join(runDirectory, "artifacts/pnpm-lock.yaml"),
  );
  const corpus = copyArtifact(
    runDirectory,
    join(root, "experiments/extraction/qualification-contract.golden.json"),
    join(runDirectory, "artifacts/qualification-contract.json"),
  );
  const evidenceArtifacts = files(runDirectory)
    .filter((path) => !path.endsWith("/manifest.json") && !path.endsWith("/run.json"))
    .map((path) => artifactRecord(runDirectory, path));
  const runRecordPath = join(runDirectory, "run.json");
  writeJson(runRecordPath, {
    schemaVersion: 1,
    run: { id: runId, attempt: 1, startedAt, completedAt, status: "passed" },
    source: {
      repository: "https://github.com/f-gueguen/fadeno",
      commit: sourceCommit,
      dirty: false,
    },
    command: ["pnpm", "experiment:extraction", "--", "--qualify"],
    decision,
    accepted,
    matrix: { engines: 3, acceptedClasses: accepted.length, interactionOrdinals: 100,
      identityCases: 17, rejectedBoundaries: 10, retries: 0 },
    artifacts: evidenceArtifacts,
  });
  const artifacts = [...evidenceArtifacts, artifactRecord(runDirectory, runRecordPath)];
  const reference = loadReferenceEnvironment(root);
  const manifest = {
    $schema: "https://fadeno.dev/schemas/experiment/result-manifest-v1.json",
    schemaVersion: 1,
    experiment: { id: "extraction", contractVersion: 1 },
    run: { id: runId, attempt: 1, startedAt, completedAt, status: "passed" },
    source: {
      repository: "https://github.com/f-gueguen/fadeno",
      commit: sourceCommit,
      dirty: false,
    },
    environment: browserManifestEnvironment(preflight, reference),
    dependencyLock: { path: "pnpm-lock.yaml", artifact: lock.path, sha256: lock.sha256 },
    command: { cwd: ".", argv: ["pnpm", "experiment:extraction", "--", "--qualify"] },
    workload: {
      dataset: {
        id: "h2-bounded-extraction-corpus-v1",
        sourcePath: "experiments/extraction/qualification-contract.golden.json",
        artifact: corpus.path,
        sha256: corpus.sha256,
      },
      warmupIterations: 0,
      measuredIterations: 100,
      concurrency: 1,
    },
    measurements: [
      { name: "accepted-interaction-class-count", unit: "count", values: [accepted.length] },
      { name: "identity-case-count", unit: "count", values: [17] },
      { name: "rejected-boundary-count", unit: "count", values: [10] },
      { name: "retry-count", unit: "count", values: [0] },
    ],
    failures: [],
    artifacts,
    validator: {
      name: "fadeno-experiment-contract",
      version: 1,
      schemaId: "https://fadeno.dev/schemas/experiment/result-manifest-v1.json",
    },
    redaction: { policy: "fadeno-no-secrets-v1", fieldsRemoved: [] },
    conclusion: {
      status: decision === "go" ? "pass" : "fail",
      summary: `The locked private extraction corpus completed with a ${decision.toUpperCase()} decision: ${accepted.length} accepted interaction classes, 10 rejected boundaries, and zero retries.`,
    },
  };
  const validators = createContractValidators(root);
  assertSchema(validators.manifest, manifest, "extraction qualification manifest");
  const registry = loadExperimentRegistry(root, validators);
  validateManifestSemantics(manifest, reference, registry);
  const temporaryManifest = join(runDirectory, "manifest.tmp.json");
  writeJson(temporaryManifest, manifest);
  validateArtifactRecords(manifest, temporaryManifest, root);
  const manifestPath = join(runDirectory, "manifest.json");
  renameSync(temporaryManifest, manifestPath);
  return { manifestPath, runRecordPath };
}
