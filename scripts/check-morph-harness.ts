import {
  existsSync,
  cpSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getMorphFixture, stableMorphInventory } from "../experiments/morph/fixtures/catalog.ts";
import {
  MORPH_QUALIFICATION_CASES,
  MORPH_QUALIFICATION_OPERATIONS,
  MORPH_QUALIFICATION_PROFILES,
  MORPH_QUALIFICATION_STATES,
  stableMorphQualificationCorpus,
} from "../experiments/morph/fixtures/qualification-corpus.ts";
import {
  MorphHarnessError,
  verifyHarnessReport,
} from "../experiments/morph/harness-report.ts";
import { MORPH_PROJECTS } from "../experiments/morph/contract.ts";
import {
  assertBrowserCompatibility,
  classifyReferenceHost,
} from "../experiments/morph/preflight.ts";
import { readJsonDocument } from "./lib/experiment-contract.ts";
import {
  createSyntheticPng,
  createSyntheticPngChunk,
  createSyntheticTraceZip,
} from "./lib/synthetic-browser-artifacts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];
const goldenInventory = readFileSync(
  join(root, "experiments/morph/fixtures/inventory.golden.json"),
  "utf8",
);
const goldenQualificationCorpus = readFileSync(
  join(root, "experiments/morph/fixtures/qualification-corpus.golden.json"),
  "utf8",
);
const runnerSource = readFileSync(join(root, "experiments/morph/harness-runner.ts"), "utf8");
const qualificationRunnerSource = readFileSync(
  join(root, "experiments/morph/qualification-runner.ts"),
  "utf8",
);
const harnessSpecSource = readFileSync(
  join(root, "experiments/morph/tests/harness.spec.ts"),
  "utf8",
);
const candidateSpecSource = readFileSync(
  join(root, "experiments/morph/tests/candidate.spec.ts"),
  "utf8",
);
const qualificationSpecSource = readFileSync(
  join(root, "experiments/morph/tests/qualification.spec.ts"),
  "utf8",
);
const candidateSource = readFileSync(join(root, "experiments/morph/candidate.ts"), "utf8");
const playwrightConfigSource = readFileSync(
  join(root, "experiments/morph/playwright.config.ts"),
  "utf8",
);
const referenceActionSource = readFileSync(
  join(root, ".github/actions/morph-reference/action.yml"),
  "utf8",
);
const decisionGateOffset = qualificationRunnerSource.indexOf(
  "verifyAcceptedQualificationFailure(root, outcome, profile)",
);
const publicationOffset = qualificationRunnerSource.indexOf("publishQualificationEvidence({");
if (
  decisionGateOffset < 0 ||
  publicationOffset < 0 ||
  decisionGateOffset > publicationOffset
) {
  recordFailure("qualification runner: failed outcome must be decision-gated before publication");
}

type ReportAttachment = {
  name: string;
  contentType: string;
  path: string;
  bytes: number;
};

type ReportResult = {
  project: string;
  title: string;
  status: string;
  expectedStatus: string;
  errors: string[];
  attachments: ReportAttachment[];
};

function recordFailure(message: string): void {
  failures.push(message);
}

function expectHarnessError(name: string, code: string, action: () => void): void {
  try {
    action();
    recordFailure(`${name}: expected ${code}`);
  } catch (error: unknown) {
    if (!(error instanceof MorphHarnessError) || error.code !== code) {
      const received = error instanceof Error ? error.message : String(error);
      recordFailure(`${name}: expected ${code}, received ${received}`);
    }
  }
}

function requireResult(results: readonly ReportResult[], index: number): ReportResult {
  const result = results[index];
  if (!result) throw new Error(`missing synthetic result ${index}`);
  return result;
}

function requireAttachment(result: ReportResult, name: string): ReportAttachment {
  const attachment = result.attachments.find((item) => item.name === name);
  if (!attachment) throw new Error(`missing synthetic ${result.project}/${name}`);
  return attachment;
}

function attachmentFile(root: string, attachment: ReportAttachment): string {
  return join(root, attachment.path);
}

const validPngs = new Map<string, Buffer>([
  ["chromium", createSyntheticPng(40)],
  ["firefox", createSyntheticPng(80)],
  ["webkit", createSyntheticPng(120)],
]);
const validPng = validPngs.get("chromium");
if (!validPng) throw new Error("synthetic Chromium PNG missing");

const packageJson = readJsonDocument(join(root, "package.json"));
const registry = readJsonDocument(join(root, "experiments/registry.json"));
if (packageJson.devDependencies?.["@playwright/test"] !== "1.61.0") {
  recordFailure("package.json: @playwright/test must be pinned to 1.61.0");
}
if (
  packageJson.scripts?.["experiment:morph"] !==
  "node --no-warnings --experimental-strip-types experiments/morph/run.ts"
) {
  recordFailure("package.json: experiment:morph command differs");
}
const morphRegistryEntry = registry.experiments.find((entry: { id?: string }) => entry.id === "morph");
if (!morphRegistryEntry || !["available", "qualified"].includes(morphRegistryEntry.status)) {
  recordFailure("experiment registry: morph harness is unavailable");
}
if (
  morphRegistryEntry?.status === "qualified" &&
  (morphRegistryEntry.decision !== "narrow" ||
    morphRegistryEntry.decisionAdr !== "docs/adr/0014-narrow-structural-preservation.md")
) {
  recordFailure("experiment registry: morph qualification decision differs");
}
if (existsSync(join(root, "experiments/morph/package.json"))) {
  recordFailure("experiments/morph: package boundary is forbidden");
}
if (stableMorphQualificationCorpus() !== goldenQualificationCorpus) {
  recordFailure("K0-04 qualification corpus differs from its checked JSON projection");
}
const qualificationCaseIds = MORPH_QUALIFICATION_CASES.map((fixture) => fixture.id);
if (
  new Set(qualificationCaseIds).size !== qualificationCaseIds.length ||
  qualificationCaseIds.some((id) => !/^[a-z][a-z0-9-]*$/u.test(id))
) {
  recordFailure("K0-04 qualification case IDs must be unique stable identifiers");
}
if (
  JSON.stringify(MORPH_QUALIFICATION_CASES.map((fixture) => fixture.state)) !==
  JSON.stringify(MORPH_QUALIFICATION_STATES)
) {
  recordFailure("K0-04 qualification corpus must cover each locked state exactly once");
}
if (
  JSON.stringify([...new Set(MORPH_QUALIFICATION_CASES.map((fixture) => fixture.operation))]) !==
  JSON.stringify(MORPH_QUALIFICATION_OPERATIONS)
) {
  recordFailure("K0-04 qualification corpus structural operation set differs");
}
if (
  JSON.stringify(MORPH_QUALIFICATION_PROFILES) !==
    JSON.stringify([
      { id: "ci", repetitions: 20 },
      { id: "qualification", repetitions: 100 },
    ]) ||
  MORPH_QUALIFICATION_CASES.some(
    (fixture) => fixture.targetIdentity.trim() === "" || fixture.description.trim() === "",
  )
) {
  recordFailure("K0-04 qualification profile or case metadata differs");
}
if (
  runnerSource.includes("FADENO_MORPH_OUTPUT_ROOT") ||
  !runnerSource.includes('join(root, "output/playwright/morph")')
) {
  recordFailure("morph runner: output cleanup root must remain repository-controlled");
}
if (harnessSpecSource.includes("candidate.ts")) {
  recordFailure("K0-02 harness controls must not import the K0-03 candidate");
}
if (!candidateSpecSource.includes('from "../candidate.ts"')) {
  recordFailure("K0-03 candidate spec must import the private candidate directly");
}
if (
  !playwrightConfigSource.includes('qualificationProfile\n    ? "qualification.spec.ts"') ||
  !playwrightConfigSource.includes('fixtureId === "intentional-replacement"') ||
  !playwrightConfigSource.includes('? "candidate.spec.ts"') ||
  !playwrightConfigSource.includes(': "harness.spec.ts"')
) {
  recordFailure("Playwright config must isolate K0-02, K0-03, and K0-04 specs");
}
if (!qualificationSpecSource.includes('from "../candidate.ts"')) {
  recordFailure("K0-04 qualification spec must drive the private candidate directly");
}
for (const forbiddenStateRestoration of [
  ".focus(",
  ".blur(",
  ".setSelectionRange(",
  ".showModal(",
  ".showPopover(",
  ".hidePopover(",
  ".play(",
  ".pause(",
  ".scrollTo(",
  ".scrollTop =",
  ".scrollLeft =",
  ".currentTime =",
  ".checked =",
  ".value =",
]) {
  if (candidateSource.includes(forbiddenStateRestoration)) {
    recordFailure(`private candidate restores browser state through ${forbiddenStateRestoration}`);
  }
}
for (const file of readdirSync(join(root, "experiments/morph/results"))) {
  if (file !== "README.md") recordFailure(`experiments/morph/results: unexpected ${file}`);
}

const commandRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-list-"));
try {
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", join(root, "experiments/morph/run.ts"), "--", "--list"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: join(commandRoot, "missing-browsers"),
      },
    },
  );
  if (
    result.status !== 0 ||
    result.stdout !== goldenInventory ||
    stableMorphInventory() !== goldenInventory ||
    result.stderr !== "" ||
    existsSync(join(commandRoot, "output"))
  ) {
    recordFailure(`morph --list contract failed: ${JSON.stringify(result)}`);
  }
  for (const unsupportedArguments of [
    ["--list", "--verify-harness"],
    ["--"],
    ["--fixture"],
    ["--fixture", "unknown"],
    ["--fixture", "intentional-replacement", "extra"],
    ["--fixture", "intentional-replacement", "--fixture", "intentional-replacement"],
  ]) {
    const unsupported = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-strip-types",
        join(root, "experiments/morph/run.ts"),
        ...unsupportedArguments,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (
      unsupported.status !== 64 ||
      unsupported.stdout !== "" ||
      unsupported.stderr !==
        `FADENO_MORPH_USAGE: unsupported arguments: ${unsupportedArguments.join(" ")}\n`
    ) {
      recordFailure(`morph usage contract failed: ${JSON.stringify(unsupported)}`);
    }
  }
} finally {
  rmSync(commandRoot, { recursive: true, force: true });
}

const reference = readJsonDocument(join(root, "experiments/reference-environment.json"));
const browserVersions = {
  chromium: reference.browsers.chromeForTesting,
  firefox: reference.browsers.firefox,
  webkit: reference.browsers.webkit,
};
const referenceObservation = {
  host: {
    provider: reference.host.provider,
    repositoryVisibility: reference.host.repositoryVisibility,
    runnerLabel: reference.host.runnerLabel,
    runnerImageVersion: "20260705.232.1",
    runnerName: "GitHub Actions 42",
    operatingSystemVersion: "ubuntu24",
    kernelVersion: "6.17.0-1018-azure",
    architecture: reference.host.architecture,
    cpuModel: "AMD EPYC 7763 64-Core Processor",
    observedLogicalCpuCount: reference.host.minimumHardware.logicalCpuCount,
    observedMemoryMiB: reference.host.minimumHardware.memoryMiB,
    advertisedLogicalCpuCount: reference.host.minimumHardware.logicalCpuCount,
    advertisedMemoryMiB: reference.host.minimumHardware.memoryMiB,
    advertisedStorageMiB: reference.host.minimumHardware.storageMiB,
    freeStorageMiB: reference.storage.minimumFreeMiB,
    loadAverage1m: reference.backgroundLoad.maxLoadAverage1m,
    processCount: reference.backgroundLoad.maxProcessCount,
  },
  container: {
    runtimeImage: reference.container.runtimeImage,
    platform: reference.container.platform,
    platformDigest: reference.container.platformDigest,
    configDigest: reference.container.configDigest,
  },
  toolchain: {
    node: reference.toolchain.node,
    pnpm: reference.toolchain.pnpm,
    playwright: reference.toolchain.playwright,
  },
  browsers: browserVersions,
};
if (classifyReferenceHost(referenceObservation, reference).classification !== "reference") {
  recordFailure("reference host boundary unexpectedly rejected");
}
const localObservation = {
  ...referenceObservation,
  host: { ...referenceObservation.host, provider: "local" },
};
if (classifyReferenceHost(localObservation, reference).classification !== "non-reference") {
  recordFailure("non-reference host was not downgraded");
}
for (const [name, mutation] of [
  ["runner image", { host: { ...referenceObservation.host, runnerImageVersion: "unknown" } }],
  ["runner identity", { host: { ...referenceObservation.host, runnerName: "unknown" } }],
  ["node", { toolchain: { ...referenceObservation.toolchain, node: "0" } }],
  ["pnpm", { toolchain: { ...referenceObservation.toolchain, pnpm: "0" } }],
  ["platform digest", { container: { ...referenceObservation.container, platformDigest: "sha256:0" } }],
  ["config digest", { container: { ...referenceObservation.container, configDigest: "sha256:0" } }],
] as const) {
  const mutated = { ...referenceObservation, ...mutation };
  if (classifyReferenceHost(mutated, reference).classification !== "non-reference") {
    recordFailure(`${name}: reference mismatch was accepted`);
  }
}
assertBrowserCompatibility(browserVersions, reference, reference.toolchain.playwright);
expectHarnessError("browser version mismatch", "FADENO_MORPH_BROWSER_VERSION", () => {
  assertBrowserCompatibility({ ...browserVersions, webkit: "0" }, reference, "1.61.0");
});

const reportRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-report-"));
try {
  const fixture = getMorphFixture("seeded-undeclared-state-loss");
  if (!fixture.diagnostic) throw new Error("seeded failure diagnostic is required");
  const fixtureDiagnostic = fixture.diagnostic;
  const syntheticTraces = new Map<string, Buffer>();
  const results: ReportResult[] = MORPH_PROJECTS.map((project): ReportResult => {
    const directory = join(reportRoot, project);
    mkdirSync(directory, { recursive: true });
    const operation = join(directory, "operation.json");
    const states = join(directory, "before-after.json");
    const screenshot = join(directory, "screenshot.png");
    const errorContext = join(directory, "error-context.md");
    const trace = join(directory, "trace.zip");
    writeFileSync(
      operation,
      `${JSON.stringify({
        fixture: fixture.id,
        engine: project,
        kind: fixture.operation,
        completed: true,
        replacementCompleted: true,
        targetIdentityChanged: true,
        stateLossObserved: true,
      })}\n`,
    );
    writeFileSync(
      states,
      `${JSON.stringify({
        fixture: fixture.id,
        engine: project,
        before: {
          nodeIdentity: "original",
          state: {
            value: "dirty-client-value",
            focused: true,
            selectionStart: 2,
            selectionEnd: 8,
          },
        },
        after: {
          nodeIdentity: "replacement",
          state: { value: "server", focused: false, selectionStart: 6, selectionEnd: 6 },
        },
      })}\n`,
    );
    const screenshotBytes = validPngs.get(project);
    if (!screenshotBytes) throw new Error(`synthetic ${project} PNG missing`);
    writeFileSync(screenshot, screenshotBytes);
    writeFileSync(errorContext, `# ${fixture.id}\n\nSynthetic failure context.\n`);
    const boundAttachments = [
      { name: "operation", contentType: "application/json", data: readFileSync(operation) },
      { name: "before-after", contentType: "application/json", data: readFileSync(states) },
      { name: "screenshot", contentType: "image/png", data: readFileSync(screenshot) },
      { name: "error-context", contentType: "text/markdown", data: readFileSync(errorContext) },
    ];
    const traceBytes = createSyntheticTraceZip(
      project,
      fixture.id,
      fixtureDiagnostic,
      boundAttachments,
    );
    syntheticTraces.set(project, traceBytes);
    writeFileSync(trace, traceBytes);
    return {
      project,
      title: fixture.id,
      status: "failed",
      expectedStatus: "passed",
      errors: [`Error: ${fixture.diagnostic}`],
      attachments: ([
        ["operation", "application/json", operation],
        ["before-after", "application/json", states],
        ["screenshot", "image/png", screenshot],
        ["error-context", "text/markdown", errorContext],
        ["trace", "application/zip", trace],
      ] satisfies Array<readonly [string, string, string]>).map(([name, contentType, path]) => ({
        name,
        contentType,
        path: relative(reportRoot, path),
        bytes: readFileSync(path).byteLength,
      })),
    };
  });
  const reportPath = join(reportRoot, "report.json");
  const writeReport = (value: readonly ReportResult[], status = "failed"): void =>
    writeFileSync(
      reportPath,
      `${JSON.stringify({ schemaVersion: 1, status, results: value }, null, 2)}\n`,
    );
  writeReport(results);
  verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  const portableRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-portable-"));
  try {
    const copiedEvidence = join(portableRoot, "evidence");
    cpSync(reportRoot, copiedEvidence, { recursive: true });
    verifyHarnessReport(join(copiedEvidence, "report.json"), {
      fixture,
      outputRoot: copiedEvidence,
    });
  } finally {
    rmSync(portableRoot, { recursive: true, force: true });
  }

  writeReport(results.slice(0, 2));
  expectHarnessError("missing project", "FADENO_MORPH_EXECUTION_COUNT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeReport(results.map((result, index) => (index === 0 ? { ...result, status: "passed" } : result)));
  expectHarnessError("removed assertion", "FADENO_MORPH_STATUS", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeReport(results.map((result, index) => (index === 0 ? { ...result, errors: [] } : result)));
  expectHarnessError("wrong failure", "FADENO_MORPH_DIAGNOSTIC", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeReport(
    results.map((result, index) =>
      index === 0
        ? { ...result, errors: [`Error: unrelated failure mentions ${fixture.diagnostic}`] }
        : result,
    ),
  );
  expectHarnessError("fabricated diagnostic token", "FADENO_MORPH_DIAGNOSTIC", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });

  const firstOperationForKind = requireAttachment(requireResult(results, 0), "operation");
  const wrongKindOperation = readJsonDocument(attachmentFile(reportRoot, firstOperationForKind));
  wrongKindOperation.kind = "insert-unrelated-sibling";
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  writeReport(results);
  expectHarnessError("wrong operation kind", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  wrongKindOperation.kind = fixture.operation;
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  wrongKindOperation.completed = "truthy-but-not-boolean";
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  writeReport(results);
  expectHarnessError("truthy operation flags", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  wrongKindOperation.completed = true;
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  writeReport(
    results.map((result, index) =>
      index === 0
        ? { ...result, attachments: result.attachments.filter((item) => item.name !== "trace") }
        : result,
    ),
  );
  expectHarnessError("missing trace", "FADENO_MORPH_ATTACHMENT_SET", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });

  writeReport(
    results.map((result, index) =>
      index === 0
        ? {
            ...result,
            attachments: result.attachments.map((item) =>
              item.name === "screenshot" ? { ...item, contentType: "text/plain" } : item,
            ),
          }
        : result,
    ),
  );
  expectHarnessError(
    "wrong attachment content type",
    "FADENO_MORPH_ATTACHMENT_CONTENT_TYPE",
    () => {
      verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
    },
  );

  const firstTrace = requireAttachment(requireResult(results, 0), "trace");
  writeFileSync(attachmentFile(reportRoot, firstTrace), Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
  firstTrace.bytes = 5;
  writeReport(results);
  expectHarnessError("wrong attachment format", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  const chromiumTraceZip = syntheticTraces.get("chromium");
  if (!chromiumTraceZip) throw new Error("synthetic Chromium trace missing");
  writeFileSync(attachmentFile(reportRoot, firstTrace), chromiumTraceZip);

  const fabricatedTraceZip = createSyntheticTraceZip(
    "chromium",
    fixture.id,
    fixture.diagnostic,
    [],
  );
  writeFileSync(attachmentFile(reportRoot, firstTrace), fabricatedTraceZip);
  firstTrace.bytes = fabricatedTraceZip.length;
  writeReport(results);
  expectHarnessError("fabricated minimal trace", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstTrace), chromiumTraceZip);
  firstTrace.bytes = chromiumTraceZip.length;

  const corruptTraceZip = Buffer.from(chromiumTraceZip);
  const tracePayload = corruptTraceZip.indexOf(Buffer.from("context-options"));
  if (tracePayload < 0) throw new Error("synthetic trace payload missing");
  corruptTraceZip[tracePayload] = (corruptTraceZip[tracePayload] ?? 0) ^ 0xff;
  writeFileSync(attachmentFile(reportRoot, firstTrace), corruptTraceZip);
  writeReport(results);
  expectHarnessError("corrupt trace payload", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstTrace), chromiumTraceZip);

  writeReport(results.map((result, index) => (index === 1 ? { ...result, project: "chromium" } : result)));
  expectHarnessError("duplicate project", "FADENO_MORPH_PROJECT_SET", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });

  const firstOperation = requireAttachment(requireResult(results, 0), "operation");
  const secondOperation = requireAttachment(requireResult(results, 1), "operation");
  writeReport(
    results.map((result, index) =>
      index === 1
        ? {
            ...result,
            attachments: result.attachments.map((item) =>
              item === secondOperation ? { ...item, path: firstOperation.path, bytes: firstOperation.bytes } : item,
            ),
          }
        : result,
    ),
  );
  expectHarnessError("duplicate artifact", "FADENO_MORPH_ATTACHMENT_DUPLICATE", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });

  const firefoxTrace = requireAttachment(requireResult(results, 1), "trace");
  const firefoxTracePath = attachmentFile(reportRoot, firefoxTrace);
  const firefoxTraceBytes = readFileSync(firefoxTracePath);
  copyFileSync(attachmentFile(reportRoot, firstTrace), firefoxTracePath);
  firefoxTrace.bytes = firstTrace.bytes;
  writeReport(results);
  expectHarnessError("relabeled browser trace", "FADENO_MORPH_TRACE_PROJECT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(firefoxTracePath, firefoxTraceBytes);
  firefoxTrace.bytes = firefoxTraceBytes.length;

  const firstScreenshot = requireAttachment(requireResult(results, 0), "screenshot");
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), "");
  writeReport(results.map((result) => ({
    ...result,
    attachments: result.attachments.map((item) =>
      item.path === firstScreenshot.path ? { ...item, bytes: 0 } : item,
    ),
  })));
  expectHarnessError("empty artifact", "FADENO_MORPH_ATTACHMENT_SIZE", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);
  firstScreenshot.bytes = validPng.length;

  const unknownCriticalPng = Buffer.concat([
    validPng.subarray(0, 33),
    createSyntheticPngChunk("ABCD", Buffer.alloc(0)),
    validPng.subarray(33),
  ]);
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), unknownCriticalPng);
  firstScreenshot.bytes = unknownCriticalPng.length;
  writeReport(results);
  expectHarnessError("unknown critical PNG chunk", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);
  firstScreenshot.bytes = validPng.length;

  const firefoxScreenshot = requireAttachment(requireResult(results, 1), "screenshot");
  const firefoxScreenshotPath = attachmentFile(reportRoot, firefoxScreenshot);
  const firefoxScreenshotBytes = readFileSync(firefoxScreenshotPath);
  copyFileSync(attachmentFile(reportRoot, firstScreenshot), firefoxScreenshotPath);
  firefoxScreenshot.bytes = firstScreenshot.bytes;
  writeReport(results);
  expectHarnessError("relabeled browser screenshot", "FADENO_MORPH_TRACE_ATTACHMENT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(firefoxScreenshotPath, firefoxScreenshotBytes);
  firefoxScreenshot.bytes = firefoxScreenshotBytes.length;

  const corruptPng = Buffer.from(validPng);
  corruptPng[Math.floor(corruptPng.length / 2)] =
    (corruptPng[Math.floor(corruptPng.length / 2)] ?? 0) ^ 0xff;
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), corruptPng);
  writeReport(results);
  expectHarnessError("corrupt PNG payload", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);

  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng.subarray(0, 8));
  firstScreenshot.bytes = 8;
  writeReport(results);
  expectHarnessError("truncated PNG", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);
  firstScreenshot.bytes = validPng.length;

  const noOpOperation = readJsonDocument(attachmentFile(reportRoot, firstOperation));
  noOpOperation.targetIdentityChanged = false;
  writeFileSync(attachmentFile(reportRoot, firstOperation), `${JSON.stringify(noOpOperation)}\n`);
  firstOperation.bytes = readFileSync(attachmentFile(reportRoot, firstOperation)).byteLength;
  writeReport(results);
  expectHarnessError("no-op replacement", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, outputRoot: reportRoot });
  });

  const passingFixture = getMorphFixture("seeded-preservation-control");
  const passingResults: ReportResult[] = results.map((result): ReportResult => {
    const operationAttachment = requireAttachment(result, "operation");
    const stateAttachment = requireAttachment(result, "before-after");
    const state = {
      nodeIdentity: "original",
      state: {
        value: "dirty-client-value",
        focused: true,
        selectionStart: 2,
        selectionEnd: 8,
      },
    };
    writeFileSync(
      attachmentFile(reportRoot, operationAttachment),
      `${JSON.stringify({
        fixture: passingFixture.id,
        engine: result.project,
        kind: passingFixture.operation,
        completed: true,
        siblingInserted: true,
        targetIdentityPreserved: true,
      })}\n`,
    );
    writeFileSync(
      attachmentFile(reportRoot, stateAttachment),
      `${JSON.stringify({ fixture: passingFixture.id, engine: result.project, before: state, after: state })}\n`,
    );
    return {
      ...result,
      title: passingFixture.id,
      status: "passed",
      errors: [],
      attachments: result.attachments
        .filter((item) => ["operation", "before-after"].includes(item.name))
        .map((item) => ({
          ...item,
          bytes: readFileSync(attachmentFile(reportRoot, item)).byteLength,
        })),
    };
  });
  writeReport(passingResults, "passed");
  verifyHarnessReport(reportPath, {
    fixture: passingFixture,
    outputRoot: reportRoot,
  });
  const passingOperation = requireAttachment(requireResult(passingResults, 0), "operation");
  const noOpInsertion = readJsonDocument(attachmentFile(reportRoot, passingOperation));
  noOpInsertion.siblingInserted = false;
  writeFileSync(attachmentFile(reportRoot, passingOperation), `${JSON.stringify(noOpInsertion)}\n`);
  passingOperation.bytes = readFileSync(attachmentFile(reportRoot, passingOperation)).byteLength;
  writeReport(passingResults, "passed");
  expectHarnessError("no-op insertion", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: passingFixture,
      outputRoot: reportRoot,
    });
  });
  noOpInsertion.siblingInserted = true;
  writeFileSync(attachmentFile(reportRoot, passingOperation), `${JSON.stringify(noOpInsertion)}\n`);
  passingOperation.bytes = readFileSync(attachmentFile(reportRoot, passingOperation)).byteLength;

  writeFileSync(
    attachmentFile(reportRoot, requireAttachment(requireResult(passingResults, 1), "before-after")),
    `${JSON.stringify({
      fixture: passingFixture.id,
      engine: "firefox",
      before: { nodeIdentity: "original", state: { focused: true } },
      after: { nodeIdentity: "original", state: { focused: true } },
    })}\n`,
  );
  const secondPassingState = requireAttachment(
    requireResult(passingResults, 1),
    "before-after",
  );
  secondPassingState.bytes = readFileSync(attachmentFile(reportRoot, secondPassingState)).byteLength;
  writeReport(passingResults, "passed");
  expectHarnessError("incomplete state proof", "FADENO_MORPH_STATE_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: passingFixture,
      outputRoot: reportRoot,
    });
  });

  const candidateFixture = getMorphFixture("intentional-replacement");
  const candidateBefore = {
    root: {
      nodeIdentity: "original",
      class: "before",
    },
    target: {
      nodeIdentity: "original",
      state: {
        value: "dirty-client-value",
        focused: true,
        selectionStart: 2,
        selectionEnd: 8,
      },
      server: {
        valueAttribute: "server-before",
        ariaLabel: "Control before",
      },
    },
    replacement: {
      nodeIdentity: "original",
      originalConnected: true,
      text: "before",
    },
  };
  const candidateAfter = {
    root: {
      nodeIdentity: "original",
      class: "after",
    },
    target: {
      nodeIdentity: "original",
      state: {
        value: "dirty-client-value",
        focused: true,
        selectionStart: 2,
        selectionEnd: 8,
      },
      server: {
        valueAttribute: "server-after",
        ariaLabel: "Control after",
      },
    },
    replacement: {
      nodeIdentity: "replacement",
      originalConnected: false,
      text: "after",
    },
  };
  const candidateResults: ReportResult[] = passingResults.map((result): ReportResult => {
    const operationAttachment = requireAttachment(result, "operation");
    const stateAttachment = requireAttachment(result, "before-after");
    writeFileSync(
      attachmentFile(reportRoot, operationAttachment),
      `${JSON.stringify({
        fixture: candidateFixture.id,
        engine: result.project,
        kind: candidateFixture.operation,
        completed: true,
        rootIdentity: "root",
        reusedIdentities: ["root", "target"],
        replacedIdentities: ["status"],
        preservedRootIdentity: true,
        preservedTargetIdentity: true,
        replacedTargetIdentity: true,
        originalReplacementDisconnected: true,
        dirtyStatePreserved: true,
        serverOwnedContentUpdated: true,
      })}\n`,
    );
    writeFileSync(
      attachmentFile(reportRoot, stateAttachment),
      `${JSON.stringify({
        fixture: candidateFixture.id,
        engine: result.project,
        before: candidateBefore,
        after: candidateAfter,
      })}\n`,
    );
    return {
      ...result,
      title: candidateFixture.id,
      attachments: result.attachments.map((item) => ({
        ...item,
        bytes: readFileSync(attachmentFile(reportRoot, item)).byteLength,
      })),
    };
  });
  writeReport(candidateResults, "passed");
  verifyHarnessReport(reportPath, {
    fixture: candidateFixture,
    outputRoot: reportRoot,
  });

  const candidateOperation = requireAttachment(requireResult(candidateResults, 0), "operation");
  const missingReuse = readJsonDocument(attachmentFile(reportRoot, candidateOperation));
  missingReuse.reusedIdentities = ["root"];
  writeFileSync(attachmentFile(reportRoot, candidateOperation), `${JSON.stringify(missingReuse)}\n`);
  candidateOperation.bytes = readFileSync(attachmentFile(reportRoot, candidateOperation)).byteLength;
  writeReport(candidateResults, "passed");
  expectHarnessError("missing candidate reuse", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: candidateFixture,
      outputRoot: reportRoot,
    });
  });
  missingReuse.reusedIdentities = ["root", "target"];
  writeFileSync(attachmentFile(reportRoot, candidateOperation), `${JSON.stringify(missingReuse)}\n`);
  candidateOperation.bytes = readFileSync(attachmentFile(reportRoot, candidateOperation)).byteLength;

  const candidateState = requireAttachment(requireResult(candidateResults, 1), "before-after");
  const falsePreservation = readJsonDocument(attachmentFile(reportRoot, candidateState));
  falsePreservation.after.target.nodeIdentity = "replacement";
  writeFileSync(attachmentFile(reportRoot, candidateState), `${JSON.stringify(falsePreservation)}\n`);
  candidateState.bytes = readFileSync(attachmentFile(reportRoot, candidateState)).byteLength;
  writeReport(candidateResults, "passed");
  expectHarnessError("false candidate preservation", "FADENO_MORPH_STATE_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: candidateFixture,
      outputRoot: reportRoot,
    });
  });
  falsePreservation.after.target.nodeIdentity = "original";
  falsePreservation.after.root.nodeIdentity = "replacement";
  writeFileSync(attachmentFile(reportRoot, candidateState), `${JSON.stringify(falsePreservation)}\n`);
  candidateState.bytes = readFileSync(attachmentFile(reportRoot, candidateState)).byteLength;
  writeReport(candidateResults, "passed");
  expectHarnessError("false candidate root reuse", "FADENO_MORPH_STATE_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: candidateFixture,
      outputRoot: reportRoot,
    });
  });
} finally {
  rmSync(reportRoot, { recursive: true, force: true });
}

const workflow = readFileSync(join(root, ".github/workflows/check.yml"), "utf8");
for (const required of [
  "runs-on: ubuntu-24.04",
  "uses: ./.github/actions/morph-reference",
  "profile: ci",
  "profile: qualification",
  "if: always()",
  "output/playwright/morph",
  "output/playwright/morph-harness",
  "output/playwright/morph-qualification",
  "path: |\n            output/playwright/morph\n            output/playwright/morph-harness",
]) {
  if (!workflow.includes(required)) recordFailure(`workflow: missing ${required}`);
}
if (
  (workflow.match(/uses: \.\/\.github\/actions\/morph-reference/gu) ?? []).length !== 2 ||
  workflow.includes("docker run --rm --ipc=host")
) {
  recordFailure("workflow: reference policy must have exactly one composite owner");
}
for (const required of [
  `image=\"${reference.container.runtimeImage}\"`,
  "docker run --rm --ipc=host",
  "--env FADENO_EXPECT_REFERENCE=1",
  "--env FADENO_RUNNER_IMAGE_VERSION=\"$ImageVersion\"",
  "--env FADENO_RUNNER_NAME=\"$RUNNER_NAME\"",
  "--env FADENO_CONTAINER_PLATFORM_DIGEST=\"$container_platform_digest\"",
  "--env FADENO_CONTAINER_CONFIG_DIGEST=\"$container_config_digest\"",
  "pnpm experiment:morph -- --verify-harness",
  "cp -R output/playwright/morph output/playwright/morph-harness",
  "pnpm experiment:morph -- --fixture intentional-replacement",
  "pnpm experiment:morph -- --ci",
  "pnpm experiment:morph -- --qualify",
]) {
  if (!referenceActionSource.includes(required)) {
    recordFailure(`reference action: missing ${required}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `morph harness contract passed (3 controls, ${MORPH_QUALIFICATION_CASES.length} qualification cases, 3 engines, 25 report mutations)`,
);
