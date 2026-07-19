import {
  A0_DISTRIBUTION_TAG,
  A0_FIRST_ALPHA_TAG,
  A0_FIRST_ALPHA_VERSION,
  A0_PACKAGE_NAME,
} from "./a0-release-identity.ts";
import type { A0DocumentationManifest } from "./a0-docs-artifact.ts";

type JsonRecord = Record<string, unknown>;

export interface A0PublicAlphaIdentityContext {
  readonly sourceCommit: string;
  readonly metadata: unknown;
  readonly distributionTags: unknown;
  readonly tagCommit: string;
  readonly release: unknown;
  readonly expectedReleaseNotes: string;
  readonly receipt: unknown;
  readonly packageIntegrity: string;
  readonly packageShasum: string;
  readonly documentationSha256: string;
  readonly documentationManifest: A0DocumentationManifest;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function assetNames(release: JsonRecord): readonly string[] {
  const assets = release["assets"];
  if (!Array.isArray(assets)) return Object.freeze([]);
  return Object.freeze(assets.flatMap((value) => {
    const asset = record(value);
    return typeof asset?.["name"] === "string" ? [asset["name"]] : [];
  }).sort());
}

export function validateA0PublicAlphaIdentity(context: A0PublicAlphaIdentityContext): readonly string[] {
  const errors: string[] = [];
  if (!/^[0-9a-f]{40}$/u.test(context.sourceCommit)) errors.push("FADENO_A0_PUBLIC_SOURCE_COMMIT");

  const metadata = record(context.metadata);
  const repository = metadata ? record(metadata["repository"]) : undefined;
  const distribution = metadata ? record(metadata["dist"]) : undefined;
  if (!metadata
    || metadata["name"] !== A0_PACKAGE_NAME
    || metadata["version"] !== A0_FIRST_ALPHA_VERSION
    || metadata["gitHead"] !== context.sourceCommit) {
    errors.push("FADENO_A0_PUBLIC_REGISTRY_IDENTITY");
  }
  if (!repository
    || repository["type"] !== "git"
    || repository["directory"] !== "packages/framework"
    || ![
      "https://github.com/f-gueguen/fadeno.git",
      "git+https://github.com/f-gueguen/fadeno.git",
    ].includes(String(repository["url"]))) {
    errors.push("FADENO_A0_PUBLIC_REPOSITORY");
  }
  if (!distribution
    || distribution["integrity"] !== context.packageIntegrity
    || distribution["shasum"] !== context.packageShasum
    || typeof distribution["tarball"] !== "string"
    || !distribution["tarball"].startsWith("https://registry.npmjs.org/")
    || !Array.isArray(distribution["signatures"])
    || distribution["signatures"].length === 0) {
    errors.push("FADENO_A0_PUBLIC_PACKAGE_INTEGRITY");
  }

  const tags = record(context.distributionTags);
  if (!tags || tags[A0_DISTRIBUTION_TAG] !== A0_FIRST_ALPHA_VERSION) {
    errors.push("FADENO_A0_PUBLIC_DIST_TAG");
  }
  if (context.tagCommit !== context.sourceCommit) errors.push("FADENO_A0_PUBLIC_TAG");

  const release = record(context.release);
  if (!release
    || release["tag_name"] !== A0_FIRST_ALPHA_TAG
    || release["target_commitish"] !== context.sourceCommit
    || release["prerelease"] !== true
    || release["draft"] !== false) {
    errors.push("FADENO_A0_PUBLIC_RELEASE");
  }
  if (!release || String(release["body"] ?? "").trim() !== context.expectedReleaseNotes.trim()) {
    errors.push("FADENO_A0_PUBLIC_RELEASE_NOTES");
  }
  const docsFilename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
  const names = release ? assetNames(release) : [];
  if (!names.includes(docsFilename) || !names.includes(`${docsFilename}.json`)) {
    errors.push("FADENO_A0_PUBLIC_RELEASE_ASSETS");
  }

  const manifest = context.documentationManifest;
  if (manifest.schemaVersion !== 1
    || manifest.packageVersion !== A0_FIRST_ALPHA_VERSION
    || manifest.sourceTag !== A0_FIRST_ALPHA_TAG
    || manifest.artifactFilename !== docsFilename) {
    errors.push("FADENO_A0_PUBLIC_DOCS_MANIFEST");
  }
  const receipt = record(context.receipt);
  if (!receipt
    || receipt["schemaVersion"] !== 1
    || receipt["sourceCommit"] !== context.sourceCommit
    || receipt["sourceTag"] !== A0_FIRST_ALPHA_TAG
    || receipt["packageVersion"] !== A0_FIRST_ALPHA_VERSION
    || receipt["artifactFilename"] !== docsFilename
    || receipt["artifactSha256"] !== context.documentationSha256
    || receipt["documentationAggregateSha256"] !== manifest.aggregateSha256
    || receipt["fileCount"] !== manifest.files.length) {
    errors.push("FADENO_A0_PUBLIC_DOCS_RECEIPT");
  }
  return Object.freeze(errors);
}
