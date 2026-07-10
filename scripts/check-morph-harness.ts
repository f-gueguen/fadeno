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
import { crc32 } from "node:zlib";

import { MORPH_FIXTURES, stableMorphInventory } from "../experiments/morph/fixtures/catalog.ts";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const goldenInventory = readFileSync(
  join(root, "experiments/morph/fixtures/inventory.golden.json"),
  "utf8",
);
const runnerSource = readFileSync(join(root, "experiments/morph/harness-runner.ts"), "utf8");

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

function createTraceZip(): Buffer {
  const entries: Array<readonly [string, Buffer]> = [
    ["test.trace", Buffer.from("{}\n")],
    ["0-trace.trace", Buffer.from("{}\n")],
    ["0-trace.network", Buffer.alloc(0)],
  ];
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const [entryName, data] of entries) {
    const name = Buffer.from(entryName);
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    localRecords.push(local);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const validTraceZip = createTraceZip();

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
if (
  runnerSource.includes("FADENO_MORPH_OUTPUT_ROOT") ||
  !runnerSource.includes('join(root, "output/playwright/morph")')
) {
  recordFailure("morph runner: output cleanup root must remain repository-controlled");
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
  provider: reference.host.provider,
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
const localSnapshot = { ...referenceSnapshot, provider: "local" };
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
    writeFileSync(screenshot, validPng);
    writeFileSync(trace, validTraceZip);
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

  const firstOperationForKind = results[0].attachments.find((item) => item.name === "operation");
  const wrongKindOperation = readJsonDocument(firstOperationForKind.path);
  wrongKindOperation.kind = "insert-unrelated-sibling";
  writeFileSync(firstOperationForKind.path, `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(firstOperationForKind.path).byteLength;
  writeReport(results);
  expectHarnessError("wrong operation kind", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  wrongKindOperation.kind = fixture.operation;
  writeFileSync(firstOperationForKind.path, `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(firstOperationForKind.path).byteLength;
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
      verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
    },
  );

  const firstTrace = results[0].attachments.find((item) => item.name === "trace");
  writeFileSync(firstTrace.path, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
  firstTrace.bytes = 5;
  writeReport(results);
  expectHarnessError("wrong attachment format", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(firstTrace.path, validTraceZip);
  firstTrace.bytes = validTraceZip.length;

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
  writeFileSync(firstScreenshot.path, validPng);
  firstScreenshot.bytes = validPng.length;

  writeFileSync(firstScreenshot.path, validPng.subarray(0, 8));
  firstScreenshot.bytes = 8;
  writeReport(results);
  expectHarnessError("truncated PNG", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(firstScreenshot.path, validPng);
  firstScreenshot.bytes = validPng.length;

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
  noOpInsertion.siblingInserted = true;
  writeFileSync(passingOperation.path, `${JSON.stringify(noOpInsertion)}\n`);
  passingOperation.bytes = readFileSync(passingOperation.path).byteLength;

  writeFileSync(
    passingResults[1].attachments.find((item) => item.name === "before-after").path,
    `${JSON.stringify({
      fixture: passingFixture.id,
      before: { nodeIdentity: "original", state: { focused: true } },
      after: { nodeIdentity: "original", state: { focused: true } },
    })}\n`,
  );
  passingResults[1].attachments.find((item) => item.name === "before-after").bytes =
    readFileSync(
      passingResults[1].attachments.find((item) => item.name === "before-after").path,
    ).byteLength;
  writeReport(passingResults, "passed");
  expectHarnessError("incomplete state proof", "FADENO_MORPH_STATE_PROOF", () => {
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

console.log("morph harness contract passed (2 fixtures, 3 engines, 14 report mutations)");
