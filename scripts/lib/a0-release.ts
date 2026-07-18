export type PublicationManifest = Readonly<{
  name?: unknown;
  version?: unknown;
  publishConfig?: unknown;
}>;

export type PublicationGit = Readonly<{
  head: string;
  clean: boolean;
}>;

type Environment = Readonly<Record<string, string | undefined>>;
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePublicationEnvironment(
  environment: Environment,
  manifest: PublicationManifest,
  git: PublicationGit,
): readonly string[] {
  const errors: string[] = [];
  const version = typeof manifest.version === "string" ? manifest.version : "";
  if (manifest.name !== "@fadeno/framework") errors.push("FADENO_RELEASE_PACKAGE_IDENTITY");
  if (!/^0\.\d+\.\d+-(?:alpha|beta|rc)\.\d+$/u.test(version)) errors.push("FADENO_RELEASE_PRERELEASE_VERSION");
  const publishConfig = manifest.publishConfig;
  if (!isRecord(publishConfig)
    || publishConfig["access"] !== "public"
    || publishConfig["provenance"] !== true
    || publishConfig["registry"] !== "https://registry.npmjs.org/"
    || publishConfig["tag"] !== "alpha") {
    errors.push("FADENO_RELEASE_PUBLISH_CONFIG");
  }
  if (!git.clean) errors.push("FADENO_RELEASE_SOURCE_DIRTY");
  if (!/^[0-9a-f]{40}$/u.test(git.head)) errors.push("FADENO_RELEASE_SOURCE_COMMIT");
  if (environment["GITHUB_ACTIONS"] !== "true"
    || environment["GITHUB_REPOSITORY"] !== "f-gueguen/fadeno"
    || environment["GITHUB_REPOSITORY_VISIBILITY"] !== "public") {
    errors.push("FADENO_RELEASE_PUBLIC_REPOSITORY");
  }
  if (!environment["GITHUB_WORKFLOW_REF"]?.startsWith("f-gueguen/fadeno/.github/workflows/publish.yml@refs/tags/")) {
    errors.push("FADENO_RELEASE_WORKFLOW_IDENTITY");
  }
  if (environment["GITHUB_REF_TYPE"] !== "tag" || environment["GITHUB_REF_NAME"] !== `v${version}`) {
    errors.push("FADENO_RELEASE_TAG_IDENTITY");
  }
  if (environment["GITHUB_SHA"] !== git.head || environment["FADENO_QUALIFIED_COMMIT"] !== git.head) {
    errors.push("FADENO_RELEASE_QUALIFIED_COMMIT");
  }
  if (!environment["ACTIONS_ID_TOKEN_REQUEST_URL"] || !environment["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) {
    errors.push("FADENO_RELEASE_OIDC_UNAVAILABLE");
  }
  const mode = environment["FADENO_RELEASE_MODE"];
  const token = environment["NODE_AUTH_TOKEN"] ?? "";
  if (mode === "bootstrap") {
    if (token.length < 20) errors.push("FADENO_RELEASE_BOOTSTRAP_CREDENTIAL");
  } else if (mode === "trusted") {
    if (token !== "") errors.push("FADENO_RELEASE_TRUSTED_TOKEN_PRESENT");
  } else {
    errors.push("FADENO_RELEASE_MODE");
  }
  return Object.freeze(errors);
}
