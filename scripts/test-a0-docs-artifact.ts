import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createA0DocumentationArtifactReceipt,
  validateA0DocumentationArtifactReceipt,
  validateA0DocumentationArtifactTree,
  type A0DocumentationManifest,
} from "./lib/a0-docs-artifact.ts";

const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-docs-contract-"));
try {
  const readme = Buffer.from("# Fadeno\n");
  const release = Buffer.from("# First alpha\n");
  mkdirSync(join(temporary, "docs/releases"), { recursive: true });
  writeFileSync(join(temporary, "README.md"), readme);
  writeFileSync(join(temporary, "docs/releases/0.1.0-alpha.0.md"), release);
  const files = [
    { path: "README.md", bytes: readme.byteLength, sha256: createHash("sha256").update(readme).digest("hex") },
    { path: "docs/releases/0.1.0-alpha.0.md", bytes: release.byteLength, sha256: createHash("sha256").update(release).digest("hex") },
  ] as const;
  const manifest = {
    schemaVersion: 1,
    packageVersion: "0.1.0-alpha.0",
    sourceTag: "v0.1.0-alpha.0",
    artifactFilename: "fadeno-docs-0.1.0-alpha.0.tar.gz",
    aggregateSha256: createHash("sha256")
      .update(files.map(({ path, bytes, sha256 }) => `${path}\0${bytes}\0${sha256}\n`).join(""))
      .digest("hex"),
    files,
  } satisfies A0DocumentationManifest;
  const artifactSha256 = "2".repeat(64);
  const receipt = createA0DocumentationArtifactReceipt("1".repeat(40), artifactSha256, manifest);
  if (validateA0DocumentationArtifactReceipt(receipt, receipt).length > 0) {
    throw new Error("valid A0 documentation receipt refused");
  }
  if (!validateA0DocumentationArtifactReceipt({ ...receipt, artifactSha256: "3".repeat(64) }, receipt)
    .includes("A0 documentation artifact receipt drifted")) {
    throw new Error("mutated A0 documentation receipt accepted");
  }
  if (validateA0DocumentationArtifactTree(temporary, manifest).length > 0) {
    throw new Error("valid A0 documentation tree refused");
  }
  rmSync(join(temporary, "docs/releases/0.1.0-alpha.0.md"));
  if (!validateA0DocumentationArtifactTree(temporary, manifest).includes("A0 documentation artifact tree drifted")) {
    throw new Error("missing A0 documentation file accepted");
  }
  writeFileSync(join(temporary, "docs/releases/0.1.0-alpha.0.md"), release);
  writeFileSync(join(temporary, "unlisted.txt"), "must be refused\n");
  if (!validateA0DocumentationArtifactTree(temporary, manifest).includes("A0 documentation artifact tree drifted")) {
    throw new Error("unlisted A0 documentation file accepted");
  }
  rmSync(join(temporary, "unlisted.txt"));
  symlinkSync(join(temporary, "README.md"), join(temporary, "linked.md"));
  if (!validateA0DocumentationArtifactTree(temporary, manifest).includes("A0 documentation artifact tree is unsafe")) {
    throw new Error("linked A0 documentation file accepted");
  }
  console.log("A0 documentation artifact mutation tests passed (receipt, missing/extra files, symlinks)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
