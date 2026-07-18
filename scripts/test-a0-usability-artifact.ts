import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyA0UsabilityParticipantBundle } from "./lib/a0-usability-artifact.ts";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-usability-artifact-tests-"));
const baseline = join(temporary, "baseline");
cpSync("evidence/a0/independent-usability/task-packet.json", join(temporary, "packet.json"));
cpSync("evidence/a0/independent-usability/task-packet.md", join(temporary, "packet.md"));
const packetJson = readFileSync(join(temporary, "packet.json"));
const packetMarkdown = readFileSync(join(temporary, "packet.md"));
const packet = JSON.parse(packetJson.toString("utf8")) as { packetId: string; instructionSha256: string };
const readme = "Synthetic bundle contract fixture; not participant evidence.\n";
const tarball = Buffer.from("synthetic package bytes\n");
const tarballName = "fadeno-framework-0.0.0.tgz";
let mutationOrdinal = 0;

const readCover = (root: string): any => JSON.parse(readFileSync(join(root, "cover-sheet.json"), "utf8")) as unknown;
const writeCover = (root: string, cover: unknown): void => writeFileSync(join(root, "cover-sheet.json"), `${JSON.stringify(cover, null, 2)}\n`);

mkdirSync(baseline);
cpSync("evidence/a0/independent-usability/task-packet.json", join(baseline, "task-packet.json"));
cpSync("evidence/a0/independent-usability/task-packet.md", join(baseline, "task-packet.md"));
writeFileSync(join(baseline, "README.md"), readme);
writeFileSync(join(baseline, tarballName), tarball);
writeCover(baseline, {
  schema: "fadeno.a0.independent-usability-participant-bundle",
  version: 1,
  disposition: "synthetic-not-user-evidence",
  sourceCommit: "0".repeat(40),
  package: { name: "@fadeno/framework", version: "0.0.0", filename: tarballName, sha256: sha256(tarball) },
  packet: {
    packetId: packet.packetId,
    instructionSha256: packet.instructionSha256,
    jsonSha256: sha256(packetJson),
    markdownSha256: sha256(packetMarkdown),
  },
  guidance: { privateGuidanceAllowed: false, readmeSha256: sha256(readme) },
});

const refuses = (mutate: (root: string, cover: any) => void): void => {
  const root = join(temporary, `mutation-${String(++mutationOrdinal).padStart(2, "0")}`);
  cpSync(baseline, root, { recursive: true });
  const cover = readCover(root);
  mutate(root, cover);
  writeCover(root, cover);
  assert.throws(
    () => verifyA0UsabilityParticipantBundle(root, "synthetic-not-user-evidence"),
    /FADENO_A0_USABILITY_BUNDLE/u,
  );
};

try {
  const verified = verifyA0UsabilityParticipantBundle(baseline, "synthetic-not-user-evidence");
  assert.equal(verified.packageSha256, sha256(tarball));
  assert.throws(
    () => verifyA0UsabilityParticipantBundle(baseline, "participant-artifact"),
    /FADENO_A0_USABILITY_BUNDLE/u,
  );
  refuses((_root, cover) => { cover.guidance.privateGuidanceAllowed = true; });
  refuses((root) => { writeFileSync(join(root, tarballName), "changed"); });
  refuses((root) => { writeFileSync(join(root, "task-packet.md"), "changed"); });
  refuses((root) => { writeFileSync(join(root, "extra.txt"), "unexpected"); });
  refuses((_root, cover) => { cover.package.filename = "../package.tgz"; });
  refuses((_root, cover) => { cover.sourceCommit = "0".repeat(39); });
  refuses((_root, cover) => { cover.packet.jsonSha256 = "1".repeat(64); });
  refuses((_root, cover) => { cover.guidance.readmeSha256 = "1".repeat(64); });
  console.log(`A0 usability artifact negative tests passed (${mutationOrdinal + 1} synthetic, integrity, guidance, content, identity controls)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
