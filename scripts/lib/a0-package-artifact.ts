import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

export type A0PackageArtifactFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

function safePath(path: string): boolean {
  return path.length > 0
    && !isAbsolute(path)
    && !path.includes("\\")
    && normalize(path) === path
    && relative(".", path) === path
    && path !== ".."
    && !path.startsWith(`..${sep}`);
}

export function createA0PackageArtifactIdentity(root: string): readonly A0PackageArtifactFile[] {
  const files: A0PackageArtifactFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (!safePath(path)) throw new TypeError(`FADENO_A0_PACKAGE_ARTIFACT_PATH:${path}`);
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) throw new TypeError(`FADENO_A0_PACKAGE_ARTIFACT_LINK:${path}`);
      if (status.isDirectory()) visit(absolute);
      else if (status.isFile()) {
        const bytes = readFileSync(absolute);
        files.push(Object.freeze({
          path,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }));
      } else throw new TypeError(`FADENO_A0_PACKAGE_ARTIFACT_ENTRY:${path}`);
    }
  };
  visit(root);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!files.some(({ path }) => path === "package.json")) {
    throw new TypeError("FADENO_A0_PACKAGE_ARTIFACT_MANIFEST");
  }
  return Object.freeze(files);
}

export function validateA0PackageArtifactIdentity(
  published: readonly A0PackageArtifactFile[],
  expected: readonly A0PackageArtifactFile[],
): readonly string[] {
  return JSON.stringify(published) === JSON.stringify(expected)
    ? Object.freeze([])
    : Object.freeze(["FADENO_A0_PUBLIC_PACKAGE_CONTENT"]);
}
