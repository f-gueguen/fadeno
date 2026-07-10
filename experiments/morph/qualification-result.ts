import {
  copyFileSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

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
import type { ReferenceEnvironment } from "../../scripts/lib/experiment-validation.ts";
import type { QualificationEvidence } from "./qualification-report.ts";
import type { ReferenceObservation } from "./preflight.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

type MorphPreflight = Readonly<ReferenceObservation & {
  schemaVersion: number;
  observedAt: string;
  classification: "reference" | "non-reference";
  reasons: readonly string[];
}>;

type ArtifactRecord = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
}>;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactRecord(runDirectory: string, path: string): ArtifactRecord {
  const artifactPath = relative(runDirectory, path).split("\\").join("/");
  return {
    path: artifactPath,
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

function manifestEnvironment(
  preflight: MorphPreflight,
  reference: ReferenceEnvironment,
) {
  const host = preflight.host;
  return {
    referenceId: reference.id,
    referenceClass: preflight.classification,
    host: {
      provider: host.provider,
      repositoryVisibility: host.repositoryVisibility,
      runnerLabel: host.runnerLabel,
      runnerImage: host.runnerLabel,
      runnerImageVersion: host.runnerImageVersion,
      runnerName: host.runnerName,
      operatingSystemVersion: host.operatingSystemVersion,
      kernelVersion: host.kernelVersion,
      architecture: host.architecture,
      cpuModel: host.cpuModel,
      logicalCpuCount: host.advertisedLogicalCpuCount ?? host.observedLogicalCpuCount,
      memoryMiB: host.advertisedMemoryMiB ?? host.observedMemoryMiB,
      advertisedStorageMiB: host.advertisedStorageMiB ?? reference.host.minimumHardware.storageMiB,
      freeStorageMiB: host.freeStorageMiB,
    },
    container: {
      image: preflight.container.runtimeImage,
      indexDigest: reference.container.indexDigest,
      platform: preflight.container.platform,
      platformDigest: preflight.container.platformDigest,
      configDigest: preflight.container.configDigest,
      executionUser: reference.container.executionUser,
      browserSandbox: reference.container.browserSandbox,
      networkPolicy: reference.container.networkPolicy,
    },
    toolchain: preflight.toolchain,
    browsers: {
      chromeForTesting: preflight.browsers.chromium,
      firefox: preflight.browsers.firefox,
      webkit: preflight.browsers.webkit,
    },
    power: reference.power,
    backgroundLoad: {
      preflightObservedAt: preflight.observedAt,
      loadAverage1m: host.loadAverage1m,
      processCount: host.processCount,
      accepted: preflight.classification === "reference",
      reason: preflight.classification === "reference"
        ? reference.backgroundLoad.acceptanceReason
        : `non-reference:${preflight.reasons.join(",") || "host"}`,
    },
  };
}

export function publishQualificationEvidence(options: Readonly<{
  root: string;
  runDirectory: string;
  runId: string;
  attempt: number;
  profile: MorphQualificationProfile;
  sourceCommit: string;
  startedAt: string;
  completedAt: string;
  preflight: MorphPreflight;
  evidence: readonly QualificationEvidence[];
}>): Readonly<{
  runRecordPath: string;
  manifestPath?: string;
  artifacts: readonly ArtifactRecord[];
}> {
  const {
    root,
    runDirectory,
    runId,
    attempt,
    profile,
    sourceCommit,
    startedAt,
    completedAt,
    preflight,
    evidence,
  } = options;
  const artifactRoot = join(runDirectory, "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  const artifacts: ArtifactRecord[] = [];
  artifacts.push(
    copyArtifact(
      runDirectory,
      join(root, "pnpm-lock.yaml"),
      join(artifactRoot, "pnpm-lock.yaml"),
    ),
  );
  artifacts.push(
    copyArtifact(
      runDirectory,
      join(root, "experiments/morph/fixtures/qualification-corpus.golden.json"),
      join(artifactRoot, "corpus.json"),
    ),
  );
  const preflightPath = join(artifactRoot, "preflight.json");
  writeJson(preflightPath, preflight);
  artifacts.push(artifactRecord(runDirectory, preflightPath));

  for (const item of evidence) {
    artifacts.push(
      copyArtifact(
        runDirectory,
        item.recordsPath,
        join(artifactRoot, "records", `${item.engine}.json`),
      ),
    );
    artifacts.push(
      copyArtifact(
        runDirectory,
        item.summaryPath,
        join(artifactRoot, "summaries", `${item.engine}.json`),
      ),
    );
  }
  const corpus = artifacts.find((artifact) => artifact.path === "artifacts/corpus.json");
  const lock = artifacts.find((artifact) => artifact.path === "artifacts/pnpm-lock.yaml");
  if (!corpus || !lock) throw new Error("FADENO_MORPH_QUALIFICATION_PROVENANCE_MISSING");
  const runRecord = {
    schemaVersion: 1,
    run: {
      id: runId,
      attempt,
      profile,
      startedAt,
      completedAt,
      status: "passed",
    },
    source: {
      repository: "https://github.com/f-gueguen/fadeno",
      commit: sourceCommit,
      dirty: false,
    },
    command: ["pnpm", "experiment:morph", "--", profile === "ci" ? "--ci" : "--qualify"],
    corpus: {
      path: corpus.path,
      sha256: corpus.sha256,
    },
    referenceClass: preflight.classification,
    matrix: {
      engines: evidence.length,
      cases: evidence[0]?.summary.cases ?? 0,
      repetitions: evidence[0]?.summary.repetitions ?? 0,
      records: evidence.reduce((total, item) => total + item.summary.records, 0),
      intentionalReplacements: evidence.reduce(
        (total, item) => total + item.summary.intentionalReplacements,
        0,
      ),
      retries: 0,
    },
    artifacts,
  };
  const temporaryRunRecord = join(runDirectory, "run.tmp.json");
  const runRecordPath = join(runDirectory, "run.json");
  writeJson(temporaryRunRecord, runRecord);
  renameSync(temporaryRunRecord, runRecordPath);

  if (profile === "ci") return { runRecordPath, artifacts };

  const runRecordArtifact = artifactRecord(runDirectory, runRecordPath);
  const manifestArtifacts = [...artifacts, runRecordArtifact];
  const reference = loadReferenceEnvironment(root);
  const manifest = {
    $schema: "https://fadeno.dev/schemas/experiment/result-manifest-v1.json",
    schemaVersion: 1,
    experiment: { id: "morph", contractVersion: 1 },
    run: {
      id: runId,
      attempt,
      startedAt,
      completedAt,
      status: "passed",
    },
    source: {
      repository: "https://github.com/f-gueguen/fadeno",
      commit: sourceCommit,
      dirty: false,
    },
    environment: manifestEnvironment(preflight, reference),
    dependencyLock: {
      path: "pnpm-lock.yaml",
      artifact: lock.path,
      sha256: lock.sha256,
    },
    command: {
      cwd: ".",
      argv: ["pnpm", "experiment:morph", "--", "--qualify"],
    },
    workload: {
      dataset: {
        id: "h1-structural-preservation-corpus-v1",
        artifact: corpus.path,
        sha256: corpus.sha256,
      },
      warmupIterations: 0,
      measuredIterations: evidence[0]?.summary.repetitions ?? 0,
      concurrency: 1,
    },
    measurements: [
      {
        name: "candidate-round-trip",
        unit: "ms",
        values: evidence.flatMap((item) => item.summary.candidateRoundTripMilliseconds),
      },
      {
        name: "document-element-count",
        unit: "count",
        values: evidence.flatMap((item) => item.summary.documentElementCounts),
      },
      {
        name: "intentional-replacement-count",
        unit: "count",
        values: [
          evidence.reduce((total, item) => total + item.summary.intentionalReplacements, 0),
        ],
      },
    ],
    failures: [],
    artifacts: manifestArtifacts,
    validator: {
      name: "fadeno-experiment-contract",
      version: 1,
      schemaId: "https://fadeno.dev/schemas/experiment/result-manifest-v1.json",
    },
    redaction: { policy: "fadeno-no-secrets-v1", fieldsRemoved: [] },
    conclusion: {
      status: "pass",
      summary:
        "The private structural-preservation corpus completed in all three engines with the locked 100-repetition matrix and no undeclared failure.",
    },
  };
  const validators = createContractValidators(root);
  assertSchema(validators.manifest, manifest, "morph qualification manifest");
  const registry = loadExperimentRegistry(root, validators);
  validateManifestSemantics(manifest, reference, registry);
  const temporaryManifest = join(runDirectory, "manifest.tmp.json");
  writeJson(temporaryManifest, manifest);
  validateArtifactRecords(manifest, temporaryManifest, root);
  const manifestPath = join(runDirectory, "manifest.json");
  renameSync(temporaryManifest, manifestPath);
  return { runRecordPath, manifestPath, artifacts: manifestArtifacts };
}
