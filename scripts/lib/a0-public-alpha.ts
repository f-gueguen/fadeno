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
  readonly attestations: unknown;
  readonly distributionTags: unknown;
  readonly tagCommit: string;
  readonly release: unknown;
  readonly expectedReleaseNotes: string;
  readonly receipt: unknown;
  readonly packageIntegrity: string;
  readonly packageShasum: string;
  readonly packageSha512: string;
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

export function hasVerifiedRegistryAttestation(output: string): boolean {
  return /(?:1 package has a verified attestation|(?:[2-9]|[1-9]\d+) packages have verified attestations)/u.test(output);
}

function validProvenanceAttestation(value: unknown): boolean {
  const attestations = record(value);
  const provenance = attestations ? record(attestations["provenance"]) : undefined;
  const url = attestations?.["url"];
  if (typeof url !== "string" || !provenance
    || provenance["predicateType"] !== "https://slsa.dev/provenance/v1") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "registry.npmjs.org"
      && decodeURIComponent(parsed.pathname) === `/-/npm/v1/attestations/${A0_PACKAGE_NAME}@${A0_FIRST_ALPHA_VERSION}`;
  } catch {
    return false;
  }
}

function validProvenanceIdentity(context: A0PublicAlphaIdentityContext): boolean {
  try {
    const root = record(context.attestations);
    const entries = root?.["attestations"];
    if (!Array.isArray(entries)) return false;
    const matches = entries.filter((value) => record(value)?.["predicateType"] === "https://slsa.dev/provenance/v1");
    if (matches.length !== 1) return false;
    const attestation = record(matches[0]);
    const bundle = attestation ? record(attestation["bundle"]) : undefined;
    const envelope = bundle ? record(bundle["dsseEnvelope"]) : undefined;
    if (envelope?.["payloadType"] !== "application/vnd.in-toto+json"
      || typeof envelope["payload"] !== "string") return false;
    const statement = record(JSON.parse(Buffer.from(envelope["payload"], "base64").toString("utf8")) as unknown);
    const predicate = statement ? record(statement["predicate"]) : undefined;
    const definition = predicate ? record(predicate["buildDefinition"]) : undefined;
    const external = definition ? record(definition["externalParameters"]) : undefined;
    const workflow = external ? record(external["workflow"]) : undefined;
    const runDetails = predicate ? record(predicate["runDetails"]) : undefined;
    const builder = runDetails ? record(runDetails["builder"]) : undefined;
    const runMetadata = runDetails ? record(runDetails["metadata"]) : undefined;
    const subject = statement?.["subject"];
    const dependencies = definition?.["resolvedDependencies"];
    const expectedRef = `refs/tags/${A0_FIRST_ALPHA_TAG}`;
    if (statement?.["_type"] !== "https://in-toto.io/Statement/v1"
      || statement["predicateType"] !== "https://slsa.dev/provenance/v1"
      || definition?.["buildType"] !== "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
      || workflow?.["repository"] !== "https://github.com/f-gueguen/fadeno"
      || workflow["path"] !== ".github/workflows/publish.yml"
      || workflow["ref"] !== expectedRef
      || builder?.["id"] !== "https://github.com/actions/runner/github-hosted"
      || typeof runMetadata?.["invocationId"] !== "string"
      || !runMetadata["invocationId"].startsWith("https://github.com/f-gueguen/fadeno/actions/runs/")) return false;
    if (!Array.isArray(subject) || subject.length !== 1) return false;
    const packageSubject = record(subject[0]);
    const packageDigest = packageSubject ? record(packageSubject["digest"]) : undefined;
    if (packageSubject?.["name"] !== `pkg:npm/%40fadeno/framework@${A0_FIRST_ALPHA_VERSION}`
      || packageDigest?.["sha512"] !== context.packageSha512) return false;
    if (!Array.isArray(dependencies) || dependencies.length !== 1) return false;
    const dependency = record(dependencies[0]);
    const dependencyDigest = dependency ? record(dependency["digest"]) : undefined;
    if (dependency?.["uri"] !== `git+https://github.com/f-gueguen/fadeno@${expectedRef}`
      || dependencyDigest?.["gitCommit"] !== context.sourceCommit) return false;
    const verification = bundle ? record(bundle["verificationMaterial"]) : undefined;
    const certificate = verification ? record(verification["certificate"]) : undefined;
    if (typeof certificate?.["rawBytes"] !== "string") return false;
    const certificateBytes = Buffer.from(certificate["rawBytes"], "base64");
    return certificateBytes.includes(Buffer.from(
      `https://github.com/f-gueguen/fadeno/.github/workflows/publish.yml@${expectedRef}`,
    )) && certificateBytes.includes(Buffer.from("repo:f-gueguen/fadeno:environment:npm-production"));
  } catch {
    return false;
  }
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
  if (!distribution
    || !validProvenanceAttestation(distribution["attestations"])
    || !validProvenanceIdentity(context)) {
    errors.push("FADENO_A0_PUBLIC_PROVENANCE");
  }

  const tags = record(context.distributionTags);
  if (!tags
    || Object.keys(tags).sort().join("\0") !== `${A0_DISTRIBUTION_TAG}\0latest`
    || tags[A0_DISTRIBUTION_TAG] !== A0_FIRST_ALPHA_VERSION
    || tags["latest"] !== A0_FIRST_ALPHA_VERSION) {
    errors.push("FADENO_A0_PUBLIC_DIST_TAG");
  }
  if (context.tagCommit !== context.sourceCommit) errors.push("FADENO_A0_PUBLIC_TAG");

  const release = record(context.release);
  if (!release
    || release["tag_name"] !== A0_FIRST_ALPHA_TAG
    || release["prerelease"] !== true
    || release["draft"] !== false) {
    errors.push("FADENO_A0_PUBLIC_RELEASE");
  }
  if (!release || String(release["body"] ?? "").trim() !== context.expectedReleaseNotes.trim()) {
    errors.push("FADENO_A0_PUBLIC_RELEASE_NOTES");
  }
  const docsFilename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
  const names = release ? assetNames(release) : [];
  if (JSON.stringify(names) !== JSON.stringify([docsFilename, `${docsFilename}.json`].sort())) {
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
