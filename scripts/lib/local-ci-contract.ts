import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_CI_COMMAND = "pnpm ci:local";
export const LOCAL_CI_PACKAGE_SCRIPT =
  "node --no-warnings --experimental-strip-types scripts/local-ci.ts";
export const LOCAL_CI_STEPS = Object.freeze([
  Object.freeze({ name: "frozen-install", args: Object.freeze(["install", "--frozen-lockfile"]) }),
  Object.freeze({ name: "repository-check", args: Object.freeze(["check"]) }),
]);

export type LocalCiProjection = {
  packageJson: { scripts?: Record<string, string> };
  runnerSource: string;
  contributorWorkflow: string;
  pullRequestTemplate: string;
  readme: string;
  activeWorkflowFiles: string[];
  dependabot: string;
  referenceProvider: unknown;
};

export function assertStableLocalCiSnapshot(
  expectedHead: string,
  actualHead: string,
  status: string,
  stage: string,
): void {
  if (status !== "") throw new Error(`FADENO_LOCAL_CI_DIRTY:${stage}`);
  if (actualHead !== expectedHead) throw new Error(`FADENO_LOCAL_CI_HEAD_CHANGED:${stage}`);
}

export function loadLocalCiProjection(root: string): LocalCiProjection {
  const workflows = join(root, ".github/workflows");
  const reference = JSON.parse(
    readFileSync(join(root, "experiments/reference-environment.json"), "utf8"),
  ) as { host?: { provider?: unknown } };
  return {
    packageJson: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    runnerSource: readFileSync(join(root, "scripts/local-ci.ts"), "utf8"),
    contributorWorkflow: readFileSync(join(root, "docs/contributor-workflow.md"), "utf8"),
    pullRequestTemplate: readFileSync(join(root, ".github/pull_request_template.md"), "utf8"),
    readme: readFileSync(join(root, "README.md"), "utf8"),
    activeWorkflowFiles: existsSync(workflows)
      ? readdirSync(workflows, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
      : [],
    dependabot: readFileSync(join(root, ".github/dependabot.yml"), "utf8"),
    referenceProvider: reference.host?.provider,
  };
}

export function validateLocalCiProjection(
  projection: LocalCiProjection,
  steps: readonly Readonly<{ name: string; args: readonly string[] }>[] = LOCAL_CI_STEPS,
): string[] {
  const errors: string[] = [];
  if (projection.packageJson.scripts?.["ci:local"] !== LOCAL_CI_PACKAGE_SCRIPT) {
    errors.push("package: canonical local CI command differs");
  }
  const check = projection.packageJson.scripts?.check ?? "";
  if ((check.match(/pnpm check:local-ci-contract/gu) ?? []).length !== 1) {
    errors.push("package: main check must consume local CI contract once");
  }
  if (JSON.stringify(steps) !== JSON.stringify(LOCAL_CI_STEPS)) {
    errors.push("contract: local CI steps or order differ");
  }
  for (const token of [
    "LOCAL_CI_STEPS",
    "gitHead(root)",
    "gitStatus(root)",
    "assertStableLocalCiSnapshot",
    'stdio: "inherit"',
  ]) {
    if (!projection.runnerSource.includes(token)) errors.push(`runner: missing ${token}`);
  }
  if (
    projection.runnerSource.includes("FADENO_EXPECT_REFERENCE") ||
    projection.runnerSource.includes("--qualify")
  ) errors.push("runner: local merge validation must remain non-reference");
  for (const [path, content] of [
    ["README.md", projection.readme],
    ["docs/contributor-workflow.md", projection.contributorWorkflow],
    [".github/pull_request_template.md", projection.pullRequestTemplate],
  ] as const) {
    if (!content.includes(`\`${LOCAL_CI_COMMAND}\``) && !content.includes(`${LOCAL_CI_COMMAND}\n`)) {
      errors.push(`${path}: canonical local CI command missing`);
    }
  }
  if (projection.activeWorkflowFiles.length !== 0) {
    errors.push(`workflows: hosted CI remains active (${projection.activeWorkflowFiles.join(", ")})`);
  }
  if (projection.dependabot.includes("package-ecosystem: github-actions")) {
    errors.push("dependabot: inactive GitHub Actions ecosystem remains configured");
  }
  if (projection.referenceProvider !== "github-actions") {
    errors.push("reference: CI replacement changed the frozen K0 provider");
  }
  return errors;
}
