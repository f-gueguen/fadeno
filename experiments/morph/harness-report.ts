import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { readJsonDocument } from "../../scripts/lib/experiment-contract.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import type { MorphFixture } from "./fixtures/catalog.ts";

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const BEFORE_STATE = {
  nodeIdentity: "original",
  state: {
    value: "dirty-client-value",
    focused: true,
    selectionStart: 2,
    selectionEnd: 8,
  },
};
const REPLACEMENT_STATE = {
  nodeIdentity: "replacement",
  state: {
    value: "server",
    focused: false,
    selectionStart: 6,
    selectionEnd: 6,
  },
};
const ATTACHMENT_CONTENT_TYPES = {
  operation: "application/json",
  "before-after": "application/json",
  screenshot: "image/png",
  trace: "application/zip",
  "error-context": "text/markdown",
} as const;

export class MorphHarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MorphHarnessError";
    this.code = code;
  }
}

type MachineAttachment = {
  name: string;
  contentType: string;
  path?: string;
  bytes: number;
};

type MachineResult = {
  project: string;
  title: string;
  status: string;
  expectedStatus: string;
  errors: string[];
  attachments: MachineAttachment[];
};

type MachineReport = {
  schemaVersion: number;
  status: string;
  results: MachineResult[];
};

type VerifyOptions = {
  fixture: MorphFixture;
  expected: "passed" | "failed";
  outputRoot: string;
};

function fail(code: string, message: string): never {
  throw new MorphHarnessError(code, message);
}

function containedAttachment(outputRoot: string, attachment: MachineAttachment): string {
  if (!attachment.path || !isAbsolute(attachment.path)) {
    fail("FADENO_MORPH_ATTACHMENT_PATH", `${attachment.name}: missing absolute path`);
  }
  const root = realpathSync(outputRoot);
  const path = realpathSync(attachment.path);
  const offset = relative(root, path);
  if (offset === "" || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    fail("FADENO_MORPH_ATTACHMENT_PATH", `${attachment.name}: path escapes output root`);
  }
  const bytes = statSync(path).size;
  if (bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES || bytes !== attachment.bytes) {
    fail("FADENO_MORPH_ATTACHMENT_SIZE", `${attachment.name}: invalid byte length`);
  }
  return path;
}

function verifyAttachmentFormat(attachment: MachineAttachment, path: string): void {
  const expectedContentType =
    ATTACHMENT_CONTENT_TYPES[attachment.name as keyof typeof ATTACHMENT_CONTENT_TYPES];
  if (!expectedContentType || attachment.contentType !== expectedContentType) {
    fail(
      "FADENO_MORPH_ATTACHMENT_CONTENT_TYPE",
      `${attachment.name}: unexpected content type ${attachment.contentType}`,
    );
  }
  const prefix = readFileSync(path).subarray(0, 8);
  if (
    attachment.name === "screenshot" &&
    !prefix.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: PNG signature missing");
  }
  if (
    attachment.name === "trace" &&
    !prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP signature missing");
  }
  if (attachment.name === "operation" || attachment.name === "before-after") {
    readJsonDocument(path);
  }
}

function requiredAttachment(
  result: MachineResult,
  name: string,
  verifiedPaths: ReadonlyMap<MachineAttachment, string>,
): string {
  const matches = result.attachments.filter((attachment) => attachment.name === name);
  if (matches.length !== 1) {
    fail("FADENO_MORPH_ATTACHMENT_SET", `${result.project}: expected one ${name}`);
  }
  const attachment = matches[0];
  if (!attachment) fail("FADENO_MORPH_ATTACHMENT_SET", `${result.project}: missing ${name}`);
  const path = verifiedPaths.get(attachment);
  if (!path) fail("FADENO_MORPH_ATTACHMENT_PATH", `${result.project}: unverified ${name}`);
  return path;
}

export function verifyHarnessReport(reportPath: string, options: VerifyOptions): MachineReport {
  const { fixture, expected, outputRoot } = options;
  const report = readJsonDocument(reportPath) as MachineReport;
  if (report.schemaVersion !== 1 || !Array.isArray(report.results)) {
    fail("FADENO_MORPH_REPORT_SHAPE", "machine report shape is invalid");
  }
  if (report.status !== expected) {
    fail("FADENO_MORPH_RUN_STATUS", `expected run status ${expected}`);
  }
  if (report.results.length !== MORPH_PROJECTS.length) {
    fail("FADENO_MORPH_EXECUTION_COUNT", "expected exactly three browser executions");
  }
  const projects = report.results.map((result) => result.project);
  if (JSON.stringify([...projects].sort()) !== JSON.stringify([...MORPH_PROJECTS].sort())) {
    fail("FADENO_MORPH_PROJECT_SET", "browser project set differs");
  }

  const seenPaths = new Set<string>();
  for (const result of report.results) {
    if (result.title !== fixture.id || result.expectedStatus !== "passed") {
      fail("FADENO_MORPH_TEST_IDENTITY", `${result.project}: test identity differs`);
    }
    if (result.status !== expected) {
      fail("FADENO_MORPH_STATUS", `${result.project}: expected ${expected}`);
    }
    if (
      expected === "failed" &&
      (!fixture.diagnostic ||
        !result.errors.some((message) => message.includes(fixture.diagnostic as string)))
    ) {
      fail("FADENO_MORPH_DIAGNOSTIC", `${result.project}: seeded diagnostic missing`);
    }
    const verifiedPaths = new Map<MachineAttachment, string>();
    for (const attachment of result.attachments) {
      const path = containedAttachment(outputRoot, attachment);
      if (seenPaths.has(path)) {
        fail("FADENO_MORPH_ATTACHMENT_DUPLICATE", `${result.project}: duplicate attachment path`);
      }
      seenPaths.add(path);
      verifyAttachmentFormat(attachment, path);
      verifiedPaths.set(attachment, path);
    }
    const operationPath = requiredAttachment(result, "operation", verifiedPaths);
    const statePath = requiredAttachment(result, "before-after", verifiedPaths);
    if (expected === "failed") {
      requiredAttachment(result, "screenshot", verifiedPaths);
      requiredAttachment(result, "trace", verifiedPaths);
    }

    const operation = readJsonDocument(operationPath);
    const states = readJsonDocument(statePath);
    if (operation.fixture !== fixture.id || states.fixture !== fixture.id || !operation.completed) {
      fail("FADENO_MORPH_OPERATION_PROOF", `${result.project}: operation proof differs`);
    }
    if (!isDeepStrictEqual(states.before, BEFORE_STATE)) {
      fail("FADENO_MORPH_STATE_PROOF", `${result.project}: initial dirty focused state differs`);
    }
    if (fixture.kind === "passing-control") {
      if (!operation.siblingInserted || !operation.targetIdentityPreserved) {
        fail("FADENO_MORPH_OPERATION_PROOF", `${result.project}: insertion was not proven`);
      }
      if (!isDeepStrictEqual(states.after, BEFORE_STATE)) {
        fail("FADENO_MORPH_STATE_PROOF", `${result.project}: passing state differs`);
      }
    } else {
      if (
        !operation.replacementCompleted ||
        !operation.targetIdentityChanged ||
        !operation.stateLossObserved
      ) {
        fail("FADENO_MORPH_OPERATION_PROOF", `${result.project}: replacement was not proven`);
      }
      if (!isDeepStrictEqual(states.after, REPLACEMENT_STATE)) {
        fail("FADENO_MORPH_STATE_PROOF", `${result.project}: exact replacement state differs`);
      }
    }
  }
  return report;
}
