import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MORPH_FIXTURES, stableMorphInventory } from "../experiments/morph/fixtures/catalog.ts";
import {
  MORPH_PROJECTS,
  MorphHarnessError,
  verifyHarnessReport,
} from "../experiments/morph/harness-report.ts";
import {
  assertBrowserCompatibility,
  classifyReferenceHost,
} from "../experiments/morph/preflight.ts";
import { readJsonDocument } from "./lib/experiment-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function recordFailure(message) {
  failures.push(message);
}

function expectHarnessError(name, code, action) {
  try {
    action();
    recordFailure(`${name}: expected ${code}`);
  } catch (error) {
    if (!(error instanceof MorphHarnessError) || error.code !== code) {
      recordFailure(`${name}: expected ${code}, received ${error.code ?? error.message}`);
    }
  }
}

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
if (registry.experiments.find((entry) => entry.id === "morph")?.status !== "available") {
  recordFailure("experiment registry: morph harness is not available");
}
if (existsSync(join(root, "experiments/morph/package.json"))) {
  recordFailure("experiments/morph: package boundary is forbidden");
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
        FADENO_MORPH_OUTPUT_ROOT: join(commandRoot, "output"),
        PLAYWRIGHT_BROWSERS_PATH: join(commandRoot, "missing-browsers"),
      },
    },
  );
  if (
    result.status !== 0 ||
    result.stdout !== stableMorphInventory() ||
    result.stderr !== "" ||
    existsSync(join(commandRoot, "output"))
  ) {
    recordFailure(`morph --list contract failed: ${JSON.stringify(result)}`);
  }
  const unsupported = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", join(root, "experiments/morph/run.ts"), "--list", "--verify-harness"],
    { cwd: root, encoding: "utf8" },
  );
  if (
    unsupported.status !== 64 ||
    unsupported.stdout !== "" ||
    unsupported.stderr !==
      "FADENO_MORPH_USAGE: unsupported arguments: --list --verify-harness\n"
  ) {
    recordFailure(`morph usage contract failed: ${JSON.stringify(unsupported)}`);
  }
} finally {
  rmSync(commandRoot, { recursive: true, force: true });
}

const reference = readJsonDocument(join(root, "experiments/reference-environment.json"));
const referenceSnapshot = {
  githubActions: true,
  repositoryVisibility: reference.host.repositoryVisibility,
  runnerLabel: reference.host.runnerLabel,
  architecture: reference.host.architecture,
  advertisedLogicalCpuCount: reference.host.minimumHardware.logicalCpuCount,
  advertisedMemoryMiB: reference.host.minimumHardware.memoryMiB,
  advertisedStorageMiB: reference.host.minimumHardware.storageMiB,
  freeStorageMiB: reference.storage.minimumFreeMiB,
  loadAverage1m: reference.backgroundLoad.maxLoadAverage1m,
  processCount: reference.backgroundLoad.maxProcessCount,
  containerImage: reference.container.runtimeImage,
};
if (classifyReferenceHost(referenceSnapshot, reference).classification !== "reference") {
  recordFailure("reference host boundary unexpectedly rejected");
}
const localSnapshot = { ...referenceSnapshot, githubActions: false };
if (classifyReferenceHost(localSnapshot, reference).classification !== "non-reference") {
  recordFailure("non-reference host was not downgraded");
}
const browserVersions = {
  chromium: reference.browsers.chromeForTesting,
  firefox: reference.browsers.firefox,
  webkit: reference.browsers.webkit,
};
assertBrowserCompatibility(browserVersions, reference, reference.toolchain.playwright);
expectHarnessError("browser version mismatch", "FADENO_MORPH_BROWSER_VERSION", () => {
  assertBrowserCompatibility({ ...browserVersions, webkit: "0" }, reference, "1.61.0");
});

const reportRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-report-"));
try {
  const fixture = MORPH_FIXTURES.find((entry) => entry.kind === "seeded-failure");
  const results = MORPH_PROJECTS.map((project) => {
    const directory = join(reportRoot, project);
    mkdirSync(directory, { recursive: true });
    const operation = join(directory, "operation.json");
    const states = join(directory, "before-after.json");
    const screenshot = join(directory, "screenshot.png");
    const trace = join(directory, "trace.zip");
    writeFileSync(
      operation,
      `${JSON.stringify({
        fixture: fixture.id,
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
        before: { nodeIdentity: "original", state: { focused: true } },
        after: { nodeIdentity: "replacement", state: { focused: false } },
      })}\n`,
    );
    writeFileSync(screenshot, "png");
    writeFileSync(trace, "zip");
    return {
      project,
      title: fixture.id,
      status: "failed",
      expectedStatus: "passed",
      errors: [fixture.diagnostic],
      attachments: [
        ["operation", "application/json", operation],
        ["before-after", "application/json", states],
        ["screenshot", "image/png", screenshot],
        ["trace", "application/zip", trace],
      ].map(([name, contentType, path]) => ({
        name,
        contentType,
        path,
        bytes: readFileSync(path).byteLength,
      })),
    };
  });
  const reportPath = join(reportRoot, "report.json");
  const writeReport = (value, status = "failed") =>
    writeFileSync(
      reportPath,
      `${JSON.stringify({ schemaVersion: 1, status, results: value }, null, 2)}\n`,
    );
  writeReport(results);
  verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });

  writeReport(results.slice(0, 2));
  expectHarnessError("missing project", "FADENO_MORPH_EXECUTION_COUNT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeReport(results.map((result, index) => (index === 0 ? { ...result, status: "passed" } : result)));
  expectHarnessError("removed assertion", "FADENO_MORPH_STATUS", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeReport(results.map((result, index) => (index === 0 ? { ...result, errors: [] } : result)));
  expectHarnessError("wrong failure", "FADENO_MORPH_DIAGNOSTIC", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeReport(
    results.map((result, index) =>
      index === 0
        ? { ...result, attachments: result.attachments.filter((item) => item.name !== "trace") }
        : result,
    ),
  );
  expectHarnessError("missing trace", "FADENO_MORPH_ATTACHMENT_SET", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  writeReport(results.map((result, index) => (index === 1 ? { ...result, project: "chromium" } : result)));
  expectHarnessError("duplicate project", "FADENO_MORPH_PROJECT_SET", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  const firstOperation = results[0].attachments.find((item) => item.name === "operation");
  const secondOperation = results[1].attachments.find((item) => item.name === "operation");
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
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  const firstScreenshot = results[0].attachments.find((item) => item.name === "screenshot");
  writeFileSync(firstScreenshot.path, "");
  writeReport(results.map((result) => ({
    ...result,
    attachments: result.attachments.map((item) =>
      item.path === firstScreenshot.path ? { ...item, bytes: 0 } : item,
    ),
  })));
  expectHarnessError("empty artifact", "FADENO_MORPH_ATTACHMENT_SIZE", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(firstScreenshot.path, "png");
  firstScreenshot.bytes = 3;

  const noOpOperation = readJsonDocument(firstOperation.path);
  noOpOperation.targetIdentityChanged = false;
  writeFileSync(firstOperation.path, `${JSON.stringify(noOpOperation)}\n`);
  firstOperation.bytes = readFileSync(firstOperation.path).byteLength;
  writeReport(results);
  expectHarnessError("no-op replacement", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  const passingFixture = MORPH_FIXTURES.find((entry) => entry.kind === "passing-control");
  const passingResults = results.map((result) => {
    const operationAttachment = result.attachments.find((item) => item.name === "operation");
    const stateAttachment = result.attachments.find((item) => item.name === "before-after");
    const state = { nodeIdentity: "original", state: { focused: true } };
    writeFileSync(
      operationAttachment.path,
      `${JSON.stringify({
        fixture: passingFixture.id,
        kind: passingFixture.operation,
        completed: true,
        siblingInserted: true,
        targetIdentityPreserved: true,
      })}\n`,
    );
    writeFileSync(
      stateAttachment.path,
      `${JSON.stringify({ fixture: passingFixture.id, before: state, after: state })}\n`,
    );
    return {
      ...result,
      title: passingFixture.id,
      status: "passed",
      errors: [],
      attachments: result.attachments.map((item) => ({
        ...item,
        bytes: readFileSync(item.path).byteLength,
      })),
    };
  });
  writeReport(passingResults, "passed");
  verifyHarnessReport(reportPath, {
    fixture: passingFixture,
    expected: "passed",
    outputRoot: reportRoot,
  });
  const passingOperation = passingResults[0].attachments.find((item) => item.name === "operation");
  const noOpInsertion = readJsonDocument(passingOperation.path);
  noOpInsertion.siblingInserted = false;
  writeFileSync(passingOperation.path, `${JSON.stringify(noOpInsertion)}\n`);
  passingOperation.bytes = readFileSync(passingOperation.path).byteLength;
  writeReport(passingResults, "passed");
  expectHarnessError("no-op insertion", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, {
      fixture: passingFixture,
      expected: "passed",
      outputRoot: reportRoot,
    });
  });
} finally {
  rmSync(reportRoot, { recursive: true, force: true });
}

const workflow = readFileSync(join(root, ".github/workflows/check.yml"), "utf8");
for (const required of [
  "runs-on: ubuntu-24.04",
  `image: ${reference.container.runtimeImage}`,
  "FADENO_EXPECT_REFERENCE: 1",
  "FADENO_PREFLIGHT_WAIT_MS: \"180000\"",
  "pnpm experiment:morph -- --verify-harness",
  "if: always()",
  "output/playwright/morph",
]) {
  if (!workflow.includes(required)) recordFailure(`workflow: missing ${required}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("morph harness contract passed (2 fixtures, 3 engines, 9 report mutations)");
