import { execFileSync } from "node:child_process";

import { loadA0ReleaseContext, validateA0Release, type A0ReleaseContext } from "./lib/a0-release-contract.ts";
import { validatePublicationEnvironment } from "./lib/a0-release.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0ReleaseContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0ReleaseContext) => A0ReleaseContext): void {
  const errors = validateA0Release(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 release mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

if (validateA0Release(source).length > 0) throw new Error(`valid A0 release contract refused:\n${validateA0Release(source).join("\n")}`);
expectMutation("Changesets configuration drifted", (context) => Object.freeze({ ...context, changesetConfig: { ...(context.changesetConfig as Record<string, unknown>), access: "restricted" } }));
expectMutation("first-alpha prerelease state drifted", (context) => Object.freeze({ ...context, prerelease: { ...(context.prerelease as Record<string, unknown>), tag: "latest" } }));
expectMutation("public package release metadata drifted", (context) => Object.freeze({ ...context, manifest: { ...(context.manifest as Record<string, unknown>), private: true } }));
expectMutation("normalized SPDX SBOM drifted", (context) => Object.freeze({ ...context, sbom: { ...(context.sbom as Record<string, unknown>), documentNamespace: "stale" } }));
expectMutation("publication workflow became merge CI", (context) => Object.freeze({ ...context, workflow: `${context.workflow}\n  pull_request:\n` }));
expectMutation("publication workflow retains bootstrap authority: revoke:a0-bootstrap-token", (context) => Object.freeze({
  ...context,
  workflow: `${context.workflow}\n# revoke:a0-bootstrap-token`,
}));
expectMutation("publication workflow is missing github.repository_visibility", (context) => Object.freeze({
  ...context,
  workflow: context.workflow.replace("github.repository_visibility", "removed-repository-visibility"),
}));
expectMutation("publication workflow retains bootstrap authority: NPM_BOOTSTRAP_TOKEN", (context) => Object.freeze({
  ...context,
  workflow: `${context.workflow}\n# NPM_BOOTSTRAP_TOKEN`,
}));
expectMutation("prepublication rollback fixture drifted", (context) => Object.freeze({ ...context, rollbackPrivate: { ...(context.rollbackPrivate as Record<string, unknown>), publicationAttempted: true } }));
expectMutation("human publication refusal evidence drifted", (context) => Object.freeze({ ...context, publicationRefusalHuman: "stale" }));
expectMutation("refused publication recovery evidence drifted", (context) => Object.freeze({ ...context, recovery: { ...(context.recovery as Record<string, unknown>), tagCreated: true } }));
expectMutation("legacy package identity remains in current content: examples/stale.ts", (context) => Object.freeze({ ...context, legacyReferences: ["examples/stale.ts"] }));

const head = "0123456789abcdef0123456789abcdef01234567";
const environment = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "f-gueguen/fadeno",
  FADENO_RELEASE_REPOSITORY_VISIBILITY: "public",
  GITHUB_WORKFLOW_REF: "f-gueguen/fadeno/.github/workflows/publish.yml@refs/tags/v0.1.0-alpha.1",
  GITHUB_REF_TYPE: "tag",
  GITHUB_REF_NAME: "v0.1.0-alpha.1",
  GITHUB_SHA: head,
  FADENO_QUALIFIED_COMMIT: head,
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.invalid",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "ephemeral",
  FADENO_RELEASE_MODE: "trusted",
  NODE_AUTH_TOKEN: "",
};
const manifest = {
  name: "@fadeno/framework",
  version: "0.1.0-alpha.1",
  publishConfig: { access: "public", provenance: true, registry: "https://registry.npmjs.org/", tag: "alpha" },
};
if (validatePublicationEnvironment(environment, manifest, { head, clean: true }).length > 0) throw new Error("valid trusted publication environment refused");
const withToken = validatePublicationEnvironment({ ...environment, NODE_AUTH_TOKEN: "unexpected-token-value" }, manifest, { head, clean: true });
if (!withToken.includes("FADENO_RELEASE_TRUSTED_TOKEN_PRESENT")) throw new Error("trusted publication token was not refused");
const privateSource = validatePublicationEnvironment({ ...environment, FADENO_RELEASE_REPOSITORY_VISIBILITY: "private" }, manifest, { head, clean: true });
if (!privateSource.includes("FADENO_RELEASE_PUBLIC_REPOSITORY")) throw new Error("private source publication was not refused");
const missingVisibility = { ...environment, FADENO_RELEASE_REPOSITORY_VISIBILITY: undefined };
if (!validatePublicationEnvironment(missingVisibility, manifest, { head, clean: true }).includes("FADENO_RELEASE_PUBLIC_REPOSITORY")) {
  throw new Error("missing hosted visibility evidence was not refused");
}
const bootstrap = validatePublicationEnvironment({ ...environment, FADENO_RELEASE_MODE: "bootstrap", NODE_AUTH_TOKEN: "one-use-bootstrap-token" }, manifest, { head, clean: true });
if (bootstrap.length > 0) throw new Error(`valid bootstrap environment refused:\n${bootstrap.join("\n")}`);

console.log("A0 release mutation tests passed (changesets, prerelease state, metadata, SBOM, workflow, refusal/recovery, rollback, OIDC, bootstrap/trusted modes)");
