import {
  closeSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { crc32, inflateRawSync, inflateSync } from "node:zlib";

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
const SCREENSHOT_WIDTH = 1_280;
const SCREENSHOT_HEIGHT = 720;

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

type TraceEvidence = {
  browserName: string;
  title: string;
  playwrightVersion: string;
  errorFirstLine: string;
  attachments: Map<string, { contentType: string; sha1: string }>;
};

function fail(code: string, message: string): never {
  throw new MorphHarnessError(code, message);
}

function containedAttachment(outputRoot: string, attachment: MachineAttachment): string {
  if (
    !attachment.path ||
    isAbsolute(attachment.path) ||
    attachment.path.includes("\\") ||
    attachment.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail("FADENO_MORPH_ATTACHMENT_PATH", `${attachment.name}: invalid portable path`);
  }
  const root = realpathSync(outputRoot);
  const path = realpathSync(join(root, attachment.path));
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

function sha1File(path: string): string {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha1");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead: number;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function verifyPng(path: string, bytes: number): void {
  if (bytes < 57) fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: PNG is truncated");
  const descriptor = openSync(path, "r");
  try {
    if (!readExactly(descriptor, 8, 0).equals(PNG_SIGNATURE)) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: PNG signature missing");
    }
    let position = 8;
    let width = 0;
    let height = 0;
    let bitsPerPixel = 0;
    let colorType = 255;
    let sawHeader = false;
    let sawPalette = false;
    let sawData = false;
    let dataEnded = false;
    const compressedParts: Buffer[] = [];
    while (position < bytes) {
      const chunkHeader = readExactly(descriptor, 8, position);
      const length = chunkHeader.readUInt32BE(0);
      const type = chunkHeader.toString("ascii", 4, 8);
      if (length > MAX_ATTACHMENT_BYTES || position + 12 + length > bytes) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: PNG chunk exceeds file");
      }
      const data = readExactly(descriptor, length, position + 8);
      const storedCrc = readExactly(descriptor, 4, position + 8 + length).readUInt32BE(0);
      if ((crc32(Buffer.concat([chunkHeader.subarray(4, 8), data])) >>> 0) !== storedCrc) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", `screenshot: ${type} CRC differs`);
      }
      if (!sawHeader) {
        if (type !== "IHDR" || length !== 13) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: IHDR must be first");
        }
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const bitDepth = data[8] ?? 0;
        colorType = data[9] ?? 255;
        const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
        const allowedDepths = new Map<number, readonly number[]>([
          [0, [1, 2, 4, 8, 16]],
          [2, [8, 16]],
          [3, [1, 2, 4, 8]],
          [4, [8, 16]],
          [6, [8, 16]],
        ]).get(colorType);
        if (
          width !== SCREENSHOT_WIDTH ||
          height !== SCREENSHOT_HEIGHT ||
          !channels ||
          !allowedDepths?.includes(bitDepth) ||
          data[10] !== 0 ||
          data[11] !== 0 ||
          data[12] !== 0
        ) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: unsupported IHDR");
        }
        bitsPerPixel = channels * bitDepth;
        sawHeader = true;
      } else if (type === "IHDR") {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: duplicate IHDR");
      } else if (type === "PLTE") {
        if (
          sawPalette ||
          sawData ||
          [0, 4].includes(colorType) ||
          length === 0 ||
          length % 3 !== 0 ||
          length > 768
        ) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: invalid PLTE");
        }
        sawPalette = true;
      } else if (type === "IDAT") {
        if (dataEnded || (colorType === 3 && !sawPalette) || length === 0) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: invalid IDAT order");
        }
        sawData = true;
        compressedParts.push(data);
      } else if (type === "IEND") {
        if (length !== 0 || position + PNG_IEND.length !== bytes || !sawData) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: invalid IEND boundary");
        }
        break;
      } else {
        if (sawData) dataEnded = true;
        const firstTypeByte = type.charCodeAt(0);
        if (firstTypeByte >= 0x41 && firstTypeByte <= 0x5a) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", `screenshot: unknown critical chunk ${type}`);
        }
      }
      position += 12 + length;
    }
    if (!readExactly(descriptor, PNG_IEND.length, bytes - PNG_IEND.length).equals(PNG_IEND)) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: IEND missing");
    }
    const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
    const expectedBytes = height * (rowBytes + 1);
    let pixels: Buffer;
    try {
      pixels = inflateSync(Buffer.concat(compressedParts), { maxOutputLength: expectedBytes });
    } catch {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: IDAT cannot be decoded");
    }
    if (pixels.byteLength !== expectedBytes) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: decoded byte length differs");
    }
    for (let row = 0; row < height; row += 1) {
      if ((pixels[row * (rowBytes + 1)] ?? 255) > 4) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "screenshot: invalid row filter");
      }
    }
  } finally {
    closeSync(descriptor);
  }
}

function verifyTraceZip(path: string, bytes: number): TraceEvidence {
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

    type ZipEntry = {
      name: string;
      flags: number;
      method: number;
      checksum: number;
      compressedSize: number;
      uncompressedSize: number;
      localOffset: number;
    };
    const entries = new Map<string, ZipEntry>();
    let position = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      const header = readExactly(descriptor, 46, position);
      if (header.readUInt32LE(0) !== 0x02014b50) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: invalid ZIP directory entry");
      }
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const checksum = header.readUInt32LE(16);
      const compressedSize = header.readUInt32LE(20);
      const uncompressedSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const entryCommentLength = header.readUInt16LE(32);
      const localOffset = header.readUInt32LE(42);
      if (
        nameLength === 0 ||
        nameLength > 4_096 ||
        localOffset >= centralOffset ||
        (flags & 0x1) !== 0 ||
        ![0, 8].includes(method) ||
        compressedSize > MAX_ATTACHMENT_BYTES ||
        uncompressedSize > MAX_ATTACHMENT_BYTES
      ) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: unsafe ZIP directory entry");
      }
      const name = readExactly(descriptor, nameLength, position + 46).toString("utf8");
      if (entries.has(name) || readExactly(descriptor, 4, localOffset).readUInt32LE(0) !== 0x04034b50) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: duplicate or invalid ZIP entry");
      }
      entries.set(name, {
        name,
        flags,
        method,
        checksum,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
      position += 46 + nameLength + extraLength + entryCommentLength;
      if (position > centralOffset + centralSize || compressedSize > bytes) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP entry exceeds archive");
      }
    }
    if (position !== centralOffset + centralSize) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP directory size differs");
    }
    const decodedEntries = new Map<string, Buffer>();
    const orderedEntries = [...entries.values()].sort((left, right) => left.localOffset - right.localOffset);
    let totalDecodedBytes = 0;
    for (const [index, entry] of orderedEntries.entries()) {
      const local = readExactly(descriptor, 30, entry.localOffset);
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = readExactly(descriptor, localNameLength, entry.localOffset + 30).toString("utf8");
      const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + entry.compressedSize;
      const nextBoundary = orderedEntries[index + 1]?.localOffset ?? centralOffset;
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== entry.flags ||
        local.readUInt16LE(8) !== entry.method ||
        localName !== entry.name ||
        dataEnd > nextBoundary
      ) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: local ZIP entry differs");
      }
      const compressed = readExactly(descriptor, entry.compressedSize, dataOffset);
      let decoded: Buffer;
      try {
        decoded = entry.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.uncompressedSize),
            });
      } catch {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", `trace: ${entry.name} cannot be decoded`);
      }
      if (
        decoded.byteLength !== entry.uncompressedSize ||
        (crc32(decoded) >>> 0) !== entry.checksum
      ) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", `trace: ${entry.name} CRC or size differs`);
      }
      totalDecodedBytes += decoded.byteLength;
      if (totalDecodedBytes > MAX_ATTACHMENT_BYTES) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: cumulative expansion exceeds limit");
      }
      let recordEnd = dataEnd;
      if ((entry.flags & 0x08) !== 0) {
        const descriptorPrefix = readExactly(descriptor, 4, dataEnd);
        const hasSignature = descriptorPrefix.readUInt32LE(0) === 0x08074b50;
        const dataDescriptor = readExactly(descriptor, hasSignature ? 16 : 12, dataEnd);
        const offset = hasSignature ? 4 : 0;
        if (
          dataDescriptor.readUInt32LE(offset) !== entry.checksum ||
          dataDescriptor.readUInt32LE(offset + 4) !== entry.compressedSize ||
          dataDescriptor.readUInt32LE(offset + 8) !== entry.uncompressedSize
        ) {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP data descriptor differs");
        }
        recordEnd += dataDescriptor.length;
      } else if (
        local.readUInt32LE(14) !== entry.checksum ||
        local.readUInt32LE(18) !== entry.compressedSize ||
        local.readUInt32LE(22) !== entry.uncompressedSize
      ) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: local ZIP sizes differ");
      }
      if (recordEnd > nextBoundary) {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: ZIP records overlap");
      }
      decodedEntries.set(entry.name, decoded);
    }
    const testTraceBytes = decodedEntries.get("test.trace")?.byteLength ?? 0;
    const browserTraceBytes = [...decodedEntries]
      .filter(([name]) => /^\d+-trace\.trace$/u.test(name))
      .reduce((total, [, data]) => total + data.byteLength, 0);
    const hasNetwork = [...entries.keys()].some((name) => /^\d+-trace\.network$/u.test(name));
    if (testTraceBytes === 0 || browserTraceBytes === 0 || !hasNetwork) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: expected Playwright trace entries missing");
    }
    let browserName = "";
    let title = "";
    for (const [name, data] of decodedEntries) {
      if (!/^\d+-trace\.trace$/u.test(name)) continue;
      for (const line of data.toString("utf8").split("\n")) {
        if (!line) continue;
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: trace record is invalid JSON");
        }
        if (
          record &&
          typeof record === "object" &&
          "type" in record &&
          record.type === "context-options" &&
          "browserName" in record &&
          typeof record.browserName === "string"
        ) {
          browserName = record.browserName;
          if ("title" in record && typeof record.title === "string") title = record.title;
          break;
        }
      }
    }
    if (!browserName || !title) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: browser identity or title missing");
    }

    const testTrace = decodedEntries.get("test.trace");
    if (!testTrace) fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: test trace missing");
    let playwrightVersion = "";
    let errorFirstLine = "";
    const tracedAttachments = new Map<string, { contentType: string; sha1: string }>();
    for (const line of testTrace.toString("utf8").split("\n")) {
      if (!line) continue;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: test record is invalid JSON");
      }
      if (!record || typeof record !== "object") continue;
      if (
        "type" in record &&
        record.type === "context-options" &&
        "origin" in record &&
        record.origin === "testRunner" &&
        "playwrightVersion" in record &&
        typeof record.playwrightVersion === "string"
      ) {
        playwrightVersion = record.playwrightVersion;
      }
      if (
        "type" in record &&
        record.type === "error" &&
        "message" in record &&
        typeof record.message === "string"
      ) {
        errorFirstLine = record.message.split("\n", 1)[0] ?? "";
      }
      if ("attachments" in record && Array.isArray(record.attachments)) {
        for (const attachment of record.attachments) {
          if (
            !attachment ||
            typeof attachment !== "object" ||
            !("name" in attachment) ||
            typeof attachment.name !== "string" ||
            !("contentType" in attachment) ||
            typeof attachment.contentType !== "string" ||
            !("sha1" in attachment) ||
            typeof attachment.sha1 !== "string" ||
            !/^[a-f0-9]{40}$/u.test(attachment.sha1) ||
            tracedAttachments.has(attachment.name)
          ) {
            fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: invalid attachment record");
          }
          const resource = decodedEntries.get(`resources/${attachment.sha1}`);
          if (!resource || createHash("sha1").update(resource).digest("hex") !== attachment.sha1) {
            fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: attachment resource differs");
          }
          tracedAttachments.set(attachment.name, {
            contentType: attachment.contentType,
            sha1: attachment.sha1,
          });
        }
      }
    }
    if (!playwrightVersion || !errorFirstLine || tracedAttachments.size === 0) {
      fail("FADENO_MORPH_ATTACHMENT_FORMAT", "trace: test failure evidence missing");
    }
    return {
      browserName,
      title,
      playwrightVersion,
      errorFirstLine,
      attachments: tracedAttachments,
    };
  } finally {
    closeSync(descriptor);
  }
}

function verifyAttachmentFormat(attachment: MachineAttachment, path: string): TraceEvidence | undefined {
  const expectedContentType =
    ATTACHMENT_CONTENT_TYPES[attachment.name as keyof typeof ATTACHMENT_CONTENT_TYPES];
  if (!expectedContentType || attachment.contentType !== expectedContentType) {
    fail(
      "FADENO_MORPH_ATTACHMENT_CONTENT_TYPE",
      `${attachment.name}: unexpected content type ${attachment.contentType}`,
    );
  }
  if (attachment.name === "screenshot") verifyPng(path, attachment.bytes);
  if (attachment.name === "trace") return verifyTraceZip(path, attachment.bytes);
  if (attachment.name === "operation" || attachment.name === "before-after") {
    readJsonDocument(path);
  }
  return undefined;
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
    if (expected === "passed" && result.errors.length !== 0) {
      fail("FADENO_MORPH_DIAGNOSTIC", `${result.project}: passing run reported errors`);
    }
    if (expected === "failed") {
      const diagnostic = fixture.diagnostic;
      if (
        !diagnostic ||
        result.errors.length !== 1 ||
        result.errors[0]?.split("\n", 1)[0] !== `Error: ${diagnostic}`
      ) {
        fail("FADENO_MORPH_DIAGNOSTIC", `${result.project}: exact seeded diagnostic differs`);
      }
    }
    const expectedAttachmentNames = expected === "failed"
      ? ["before-after", "error-context", "operation", "screenshot", "trace"]
      : ["before-after", "operation"];
    const attachmentNames = result.attachments.map((attachment) => attachment.name).sort();
    if (!isDeepStrictEqual(attachmentNames, expectedAttachmentNames)) {
      fail("FADENO_MORPH_ATTACHMENT_SET", `${result.project}: attachment set differs`);
    }
    const verifiedPaths = new Map<MachineAttachment, string>();
    let traceEvidence: TraceEvidence | undefined;
    for (const attachment of result.attachments) {
      const path = containedAttachment(outputRoot, attachment);
      if (seenPaths.has(path)) {
        fail("FADENO_MORPH_ATTACHMENT_DUPLICATE", `${result.project}: duplicate attachment path`);
      }
      seenPaths.add(path);
      const attachmentEvidence = verifyAttachmentFormat(attachment, path);
      if (attachment.name === "trace") traceEvidence = attachmentEvidence;
      verifiedPaths.set(attachment, path);
    }
    const operationPath = requiredAttachment(result, "operation", verifiedPaths);
    const statePath = requiredAttachment(result, "before-after", verifiedPaths);
    if (expected === "failed") {
      requiredAttachment(result, "screenshot", verifiedPaths);
      requiredAttachment(result, "trace", verifiedPaths);
      if (
        traceEvidence?.browserName !== result.project ||
        !traceEvidence.title.endsWith(`› ${fixture.id}`) ||
        traceEvidence.playwrightVersion !== "1.61.0" ||
        traceEvidence.errorFirstLine !== `Error: ${fixture.diagnostic}`
      ) {
        fail(
          "FADENO_MORPH_TRACE_PROJECT",
          `${result.project}: trace identity or failure differs`,
        );
      }
    }

    const operation = readJsonDocument(operationPath);
    const states = readJsonDocument(statePath);
    const expectedOperation = fixture.kind === "passing-control"
      ? {
          fixture: fixture.id,
          engine: result.project,
          kind: fixture.operation,
          completed: true,
          siblingInserted: true,
          targetIdentityPreserved: true,
        }
      : {
          fixture: fixture.id,
          engine: result.project,
          kind: fixture.operation,
          completed: true,
          replacementCompleted: true,
          targetIdentityChanged: true,
          stateLossObserved: true,
        };
    if (
      !isDeepStrictEqual(operation, expectedOperation) ||
      states.fixture !== fixture.id ||
      states.engine !== result.project
    ) {
      fail("FADENO_MORPH_OPERATION_PROOF", `${result.project}: operation proof differs`);
    }
    if (!isDeepStrictEqual(states.before, BEFORE_STATE)) {
      fail("FADENO_MORPH_STATE_PROOF", `${result.project}: initial dirty focused state differs`);
    }
    if (fixture.kind === "passing-control") {
      if (!isDeepStrictEqual(states.after, BEFORE_STATE)) {
        fail("FADENO_MORPH_STATE_PROOF", `${result.project}: passing state differs`);
      }
    } else {
      if (!isDeepStrictEqual(states.after, REPLACEMENT_STATE)) {
        fail("FADENO_MORPH_STATE_PROOF", `${result.project}: exact replacement state differs`);
      }
    }
    if (expected === "failed" && traceEvidence) {
      for (const attachment of result.attachments) {
        if (attachment.name === "trace") continue;
        const traced = traceEvidence.attachments.get(attachment.name);
        const path = verifiedPaths.get(attachment);
        if (
          !traced ||
          !path ||
          traced.contentType !== attachment.contentType ||
          traced.sha1 !== sha1File(path)
        ) {
          fail(
            "FADENO_MORPH_TRACE_ATTACHMENT",
            `${result.project}: ${attachment.name} is not bound to the trace`,
          );
        }
      }
    }
  }
  return report;
}
