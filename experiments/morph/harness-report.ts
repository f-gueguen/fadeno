import {
  closeSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
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
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

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

function readExactly(descriptor: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length);
  if (readSync(descriptor, buffer, 0, length, position) !== length) {
    fail("FADENO_MORPH_ATTACHMENT_FORMAT", "artifact metadata is truncated");
  }
  return buffer;
}

function verifyPng(path: string, bytes: number): void {
  if (bytes < 45) fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: PNG is truncated");
  const descriptor = openSync(path, "r");
  try {
    const header = readExactly(descriptor, 33, 0);
    const trailer = readExactly(descriptor, PNG_IEND.length, bytes - PNG_IEND.length);
    if (
      !header.subarray(0, 8).equals(PNG_SIGNATURE) ||
      header.readUInt32BE(8) !== 13 ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      header.readUInt32BE(16) === 0 ||
      header.readUInt32BE(20) === 0 ||
      !trailer.equals(PNG_IEND)
    ) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: invalid PNG structure");
    }
  } finally {
    closeSync(descriptor);
  }
}

function verifyTraceZip(path: string, bytes: number): void {
  if (bytes < 22) fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP is truncated");
  const descriptor = openSync(path, "r");
  try {
    const tailLength = Math.min(bytes, 65_557);
    const tail = readExactly(descriptor, tailLength, bytes - tailLength);
    const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const endOffset = tail.lastIndexOf(endSignature);
    if (endOffset < 0 || endOffset + 22 > tail.length) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP central directory missing");
    }
    const end = tail.subarray(endOffset, endOffset + 22);
    const entryCount = end.readUInt16LE(10);
    const centralSize = end.readUInt32LE(12);
    const centralOffset = end.readUInt32LE(16);
    const commentLength = end.readUInt16LE(20);
    const absoluteEndOffset = bytes - tailLength + endOffset;
    if (
      end.readUInt16LE(4) !== 0 ||
      end.readUInt16LE(6) !== 0 ||
      end.readUInt16LE(8) !== entryCount ||
      entryCount === 0 ||
      entryCount > 10_000 ||
      endOffset + 22 + commentLength !== tail.length ||
      centralOffset + centralSize !== absoluteEndOffset
    ) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: invalid ZIP directory boundary");
    }

    const entries = new Map<string, number>();
    let position = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      const header = readExactly(descriptor, 46, position);
      if (header.readUInt32LE(0) !== 0x02014b50) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: invalid ZIP directory entry");
      }
      const compressedSize = header.readUInt32LE(20);
      const uncompressedSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const entryCommentLength = header.readUInt16LE(32);
      const localOffset = header.readUInt32LE(42);
      if (nameLength === 0 || nameLength > 4_096 || localOffset >= centralOffset) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: unsafe ZIP directory entry");
      }
      const name = readExactly(descriptor, nameLength, position + 46).toString("utf8");
      if (entries.has(name) || readExactly(descriptor, 4, localOffset).readUInt32LE(0) !== 0x04034b50) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: duplicate or invalid ZIP entry");
      }
      entries.set(name, uncompressedSize);
      position += 46 + nameLength + extraLength + entryCommentLength;
      if (position > centralOffset + centralSize || compressedSize > bytes) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP entry exceeds archive");
      }
    }
    if (position !== centralOffset + centralSize) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP directory size differs");
    }
    const testTraceBytes = entries.get("test.trace") ?? 0;
    const browserTraceBytes = [...entries]
      .filter(([name]) => /^\d+-trace\.trace$/u.test(name))
      .reduce((total, [, size]) => total + size, 0);
    const hasNetwork = [...entries.keys()].some((name) => /^\d+-trace\.network$/u.test(name));
    if (testTraceBytes === 0 || browserTraceBytes === 0 || !hasNetwork) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: expected Playwright trace entries missing");
    }
  } finally {
    closeSync(descriptor);
  }
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
  if (attachment.name === "screenshot") verifyPng(path, attachment.bytes);
  if (attachment.name === "trace") verifyTraceZip(path, attachment.bytes);
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
    if (
      operation.fixture !== fixture.id ||
      operation.kind !== fixture.operation ||
      states.fixture !== fixture.id ||
      !operation.completed
    ) {
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
