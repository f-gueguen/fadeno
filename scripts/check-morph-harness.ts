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
import { crc32 } from "node:zlib";

import { getMorphFixture, stableMorphInventory } from "../experiments/morph/fixtures/catalog.ts";
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
const failures: string[] = [];
const goldenInventory = readFileSync(
  join(root, "experiments/morph/fixtures/inventory.golden.json"),
  "utf8",
);
const runnerSource = readFileSync(join(root, "experiments/morph/harness-runner.ts"), "utf8");

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

function createTraceZip(project: string): Buffer {
  const entries: Array<readonly [string, Buffer]> = [
    ["test.trace", Buffer.from("{}\n")],
    [
      "0-trace.trace",
      Buffer.from(`${JSON.stringify({ type: "context-options", browserName: project })}\n`),
    ],
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
if (
  registry.experiments.find((entry: { id?: string }) => entry.id === "morph")?.status !==
  "available"
) {
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
  const fixture = getMorphFixture("seeded-undeclared-state-loss");
  if (!fixture.diagnostic) throw new Error("seeded failure diagnostic is required");
  const results: ReportResult[] = MORPH_PROJECTS.map((project): ReportResult => {
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
    writeFileSync(trace, createTraceZip(project));
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
  verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  const portableRoot = mkdtempSync(join(tmpdir(), "fadeno-morph-portable-"));
  try {
    const copiedEvidence = join(portableRoot, "evidence");
    cpSync(reportRoot, copiedEvidence, { recursive: true });
    verifyHarnessReport(join(copiedEvidence, "report.json"), {
      fixture,
      expected: "failed",
      outputRoot: copiedEvidence,
    });
  } finally {
    rmSync(portableRoot, { recursive: true, force: true });
  }

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
        ? { ...result, errors: [`Error: unrelated failure mentions ${fixture.diagnostic}`] }
        : result,
    ),
  );
  expectHarnessError("fabricated diagnostic token", "FADENO_MORPH_DIAGNOSTIC", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  const firstOperationForKind = requireAttachment(requireResult(results, 0), "operation");
  const wrongKindOperation = readJsonDocument(attachmentFile(reportRoot, firstOperationForKind));
  wrongKindOperation.kind = "insert-unrelated-sibling";
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  writeReport(results);
  expectHarnessError("wrong operation kind", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  wrongKindOperation.kind = fixture.operation;
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  wrongKindOperation.completed = "truthy-but-not-boolean";
  writeFileSync(attachmentFile(reportRoot, firstOperationForKind), `${JSON.stringify(wrongKindOperation)}\n`);
  firstOperationForKind.bytes = readFileSync(attachmentFile(reportRoot, firstOperationForKind)).byteLength;
  writeReport(results);
  expectHarnessError("truthy operation flags", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
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

  const firstTrace = requireAttachment(requireResult(results, 0), "trace");
  writeFileSync(attachmentFile(reportRoot, firstTrace), Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
  firstTrace.bytes = 5;
  writeReport(results);
  expectHarnessError("wrong attachment format", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  const chromiumTraceZip = createTraceZip("chromium");
  writeFileSync(attachmentFile(reportRoot, firstTrace), chromiumTraceZip);
  firstTrace.bytes = chromiumTraceZip.length;

  const corruptTraceZip = Buffer.from(chromiumTraceZip);
  const tracePayload = corruptTraceZip.indexOf(Buffer.from("context-options"));
  if (tracePayload < 0) throw new Error("synthetic trace payload missing");
  corruptTraceZip[tracePayload] = (corruptTraceZip[tracePayload] ?? 0) ^ 0xff;
  writeFileSync(attachmentFile(reportRoot, firstTrace), corruptTraceZip);
  writeReport(results);
  expectHarnessError("corrupt trace payload", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstTrace), chromiumTraceZip);

  writeReport(results.map((result, index) => (index === 1 ? { ...result, project: "chromium" } : result)));
  expectHarnessError("duplicate project", "FADENO_MORPH_PROJECT_SET", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
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
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });

  const firefoxTrace = requireAttachment(requireResult(results, 1), "trace");
  const firefoxTracePath = attachmentFile(reportRoot, firefoxTrace);
  const firefoxTraceBytes = readFileSync(firefoxTracePath);
  copyFileSync(attachmentFile(reportRoot, firstTrace), firefoxTracePath);
  firefoxTrace.bytes = firstTrace.bytes;
  writeReport(results);
  expectHarnessError("relabeled browser trace", "FADENO_MORPH_TRACE_PROJECT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
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
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);
  firstScreenshot.bytes = validPng.length;

  const corruptPng = Buffer.from(validPng);
  corruptPng[Math.floor(corruptPng.length / 2)] =
    (corruptPng[Math.floor(corruptPng.length / 2)] ?? 0) ^ 0xff;
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), corruptPng);
  writeReport(results);
  expectHarnessError("corrupt PNG payload", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);

  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng.subarray(0, 8));
  firstScreenshot.bytes = 8;
  writeReport(results);
  expectHarnessError("truncated PNG", "FADENO_MORPH_ATTACHMENT_FORMAT", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
  });
  writeFileSync(attachmentFile(reportRoot, firstScreenshot), validPng);
  firstScreenshot.bytes = validPng.length;

  const noOpOperation = readJsonDocument(attachmentFile(reportRoot, firstOperation));
  noOpOperation.targetIdentityChanged = false;
  writeFileSync(attachmentFile(reportRoot, firstOperation), `${JSON.stringify(noOpOperation)}\n`);
  firstOperation.bytes = readFileSync(attachmentFile(reportRoot, firstOperation)).byteLength;
  writeReport(results);
  expectHarnessError("no-op replacement", "FADENO_MORPH_OPERATION_PROOF", () => {
    verifyHarnessReport(reportPath, { fixture, expected: "failed", outputRoot: reportRoot });
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
        kind: passingFixture.operation,
        completed: true,
        siblingInserted: true,
        targetIdentityPreserved: true,
      })}\n`,
    );
    writeFileSync(
      attachmentFile(reportRoot, stateAttachment),
      `${JSON.stringify({ fixture: passingFixture.id, before: state, after: state })}\n`,
    );
    return {
      ...result,
      title: passingFixture.id,
      status: "passed",
      errors: [],
      attachments: result.attachments.map((item) => ({
        ...item,
        bytes: readFileSync(attachmentFile(reportRoot, item)).byteLength,
      })),
    };
  });
  writeReport(passingResults, "passed");
  verifyHarnessReport(reportPath, {
    fixture: passingFixture,
    expected: "passed",
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
      expected: "passed",
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

console.log("morph harness contract passed (2 fixtures, 3 engines, 19 report mutations)");
