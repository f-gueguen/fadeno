import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createA0PackageArtifactIdentity,
  validateA0PackageArtifactIdentity,
} from "./lib/a0-package-artifact.ts";

const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-package-artifact-"));
try {
  const expected = join(temporary, "expected");
  const published = join(temporary, "published");
  for (const root of [expected, published]) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{\"name\":\"@fadeno/framework\"}\n");
    writeFileSync(join(root, "dist/index.js"), "export const value = 1;\n");
  }
  const expectedIdentity = createA0PackageArtifactIdentity(expected);
  const publishedIdentity = createA0PackageArtifactIdentity(published);
  if (validateA0PackageArtifactIdentity(publishedIdentity, expectedIdentity).length > 0) {
    throw new Error("matching A0 package artifact refused");
  }
  writeFileSync(join(published, "dist/index.js"), "export const value = 2;\n");
  if (!validateA0PackageArtifactIdentity(createA0PackageArtifactIdentity(published), expectedIdentity)
    .includes("FADENO_A0_PUBLIC_PACKAGE_CONTENT")) {
    throw new Error("mutated A0 package bytes accepted");
  }
  writeFileSync(join(published, "dist/index.js"), "export const value = 1;\n");
  writeFileSync(join(published, "stale.txt"), "stale\n");
  if (!validateA0PackageArtifactIdentity(createA0PackageArtifactIdentity(published), expectedIdentity)
    .includes("FADENO_A0_PUBLIC_PACKAGE_CONTENT")) {
    throw new Error("extra A0 package file accepted");
  }
  rmSync(join(published, "stale.txt"));
  symlinkSync(join(published, "package.json"), join(published, "linked.json"));
  try {
    createA0PackageArtifactIdentity(published);
    throw new Error("linked A0 package entry accepted");
  } catch (error) {
    if (!(error instanceof TypeError) || !error.message.startsWith("FADENO_A0_PACKAGE_ARTIFACT_LINK:")) throw error;
  }
  console.log("A0 package artifact mutation tests passed (bytes, extra files, links)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
