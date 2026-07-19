import { createHash } from "node:crypto";

import {
  validateA0PublicAlphaIdentity,
  type A0PublicAlphaIdentityContext,
} from "./lib/a0-public-alpha.ts";
import type { A0DocumentationManifest } from "./lib/a0-docs-artifact.ts";

const sourceCommit = "1".repeat(40);
const bytes = Buffer.from("public package bytes");
const documentation = Buffer.from("documentation bytes");
const manifest = {
  schemaVersion: 1,
  packageVersion: "0.1.0-alpha.0",
  sourceTag: "v0.1.0-alpha.0",
  artifactFilename: "fadeno-docs-0.1.0-alpha.0.tar.gz",
  aggregateSha256: "2".repeat(64),
  files: [{ path: "README.md", bytes: 1, sha256: "3".repeat(64) }],
} satisfies A0DocumentationManifest;
const context = Object.freeze({
  sourceCommit,
  metadata: {
    name: "@fadeno/framework",
    version: "0.1.0-alpha.0",
    gitHead: sourceCommit,
    repository: { type: "git", url: "git+https://github.com/f-gueguen/fadeno.git", directory: "packages/framework" },
    dist: {
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      shasum: createHash("sha1").update(bytes).digest("hex"),
      tarball: "https://registry.npmjs.org/@fadeno/framework/-/framework-0.1.0-alpha.0.tgz",
      signatures: [{ keyid: "fixture", sig: "fixture" }],
      attestations: {
        url: "https://registry.npmjs.org/-/npm/v1/attestations/@fadeno%2fframework@0.1.0-alpha.0",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
  },
  distributionTags: { alpha: "0.1.0-alpha.0" },
  tagCommit: sourceCommit,
  release: {
    tag_name: "v0.1.0-alpha.0",
    target_commitish: "main",
    prerelease: true,
    draft: false,
    body: "release notes\n",
    assets: [
      { name: "fadeno-docs-0.1.0-alpha.0.tar.gz" },
      { name: "fadeno-docs-0.1.0-alpha.0.tar.gz.json" },
    ],
  },
  expectedReleaseNotes: "release notes",
  receipt: {
    schemaVersion: 1,
    sourceCommit,
    sourceTag: "v0.1.0-alpha.0",
    packageVersion: "0.1.0-alpha.0",
    artifactFilename: "fadeno-docs-0.1.0-alpha.0.tar.gz",
    artifactSha256: createHash("sha256").update(documentation).digest("hex"),
    documentationAggregateSha256: manifest.aggregateSha256,
    fileCount: 1,
  },
  packageIntegrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  packageShasum: createHash("sha1").update(bytes).digest("hex"),
  documentationSha256: createHash("sha256").update(documentation).digest("hex"),
  documentationManifest: manifest,
}) satisfies A0PublicAlphaIdentityContext;

function mutation(expected: string, change: Partial<A0PublicAlphaIdentityContext>): void {
  const errors = validateA0PublicAlphaIdentity({ ...context, ...change });
  if (!errors.includes(expected)) throw new Error(`public-alpha mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateA0PublicAlphaIdentity(context);
if (valid.length > 0) throw new Error(`valid public-alpha identity refused:\n${valid.join("\n")}`);
mutation("FADENO_A0_PUBLIC_REGISTRY_IDENTITY", {
  metadata: { ...(context.metadata as Record<string, unknown>), gitHead: "4".repeat(40) },
});
mutation("FADENO_A0_PUBLIC_PACKAGE_INTEGRITY", { packageIntegrity: "sha512-invalid" });
mutation("FADENO_A0_PUBLIC_PROVENANCE", {
  metadata: {
    ...(context.metadata as Record<string, unknown>),
    dist: { ...((context.metadata as Record<string, unknown>)["dist"] as Record<string, unknown>), attestations: undefined },
  },
});
mutation("FADENO_A0_PUBLIC_DIST_TAG", { distributionTags: { alpha: "0.1.0-alpha.1" } });
mutation("FADENO_A0_PUBLIC_TAG", { tagCommit: "5".repeat(40) });
mutation("FADENO_A0_PUBLIC_RELEASE", {
  release: { ...(context.release as Record<string, unknown>), prerelease: false },
});
mutation("FADENO_A0_PUBLIC_RELEASE_NOTES", { expectedReleaseNotes: "different" });
mutation("FADENO_A0_PUBLIC_RELEASE_ASSETS", {
  release: { ...(context.release as Record<string, unknown>), assets: [] },
});
mutation("FADENO_A0_PUBLIC_DOCS_RECEIPT", {
  receipt: { ...(context.receipt as Record<string, unknown>), sourceCommit: "6".repeat(40) },
});

console.log("A0 public-alpha identity mutation tests passed (registry, integrity, tag, release, notes, docs)");
