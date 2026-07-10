import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

export function createSyntheticTraceZip(
  project: string,
  title: string,
  diagnostic: string,
  attachments: ReadonlyArray<{ name: string; contentType: string; data: Buffer }>,
): Buffer {
  const tracedAttachments = attachments.map(({ name, contentType, data }) => ({
    name,
    contentType,
    sha1: createHash("sha1").update(data).digest("hex"),
  }));
  const testRecords = [
    { version: 8, type: "context-options", origin: "testRunner", playwrightVersion: "1.61.0" },
    ...tracedAttachments.map((attachment) => ({ type: "after", attachments: [attachment] })),
    { type: "error", message: `Error: ${diagnostic}\nsynthetic seeded failure` },
  ];
  const entries: Array<readonly [string, Buffer]> = [
    ["test.trace", Buffer.from(`${testRecords.map((record) => JSON.stringify(record)).join("\n")}\n`)],
    [
      "0-trace.trace",
      Buffer.from(`${JSON.stringify({
        type: "context-options",
        browserName: project,
        playwrightVersion: "1.61.0",
        title: `synthetic.spec.ts:1 › ${title}`,
      })}\n`),
    ],
    ["0-trace.network", Buffer.alloc(0)],
    ...attachments.map(({ data }, index) => [
      `resources/${tracedAttachments[index]?.sha1}`,
      data,
    ] as const),
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

export function createSyntheticPngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 8 + data.length);
  return chunk;
}

export function createSyntheticPng(seed: number): Buffer {
  const width = 1_280;
  const height = 720;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(height * (1 + width * 3));
  rows[1] = seed;
  rows[2] = 255 - seed;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createSyntheticPngChunk("IHDR", header),
    createSyntheticPngChunk("IDAT", deflateSync(rows)),
    createSyntheticPngChunk("IEND", Buffer.alloc(0)),
  ]);
}
