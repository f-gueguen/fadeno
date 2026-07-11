import { createHash } from "node:crypto";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createQualificationFile(): Buffer {
  return Buffer.from("fadeno-k0-04-file\n", "utf8");
}

export function createQualificationTone(): Buffer {
  const sampleRate = 4_000;
  const sampleCount = sampleRate * 4;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 10_000);
    bytes.writeInt16LE(sample, 44 + index * 2);
  }
  return bytes;
}

const file = createQualificationFile();
const tone = createQualificationTone();

export const MORPH_QUALIFICATION_ASSETS = Object.freeze({
  file: Object.freeze({
    id: "selected-local-file-v1",
    name: "qualification.txt",
    contentType: "text/plain",
    bytes: file.byteLength,
    sha256: sha256(file),
  }),
  media: Object.freeze({
    id: "local-tone-wav-v2",
    contentType: "audio/wav",
    bytes: tone.byteLength,
    sha256: sha256(tone),
  }),
});
