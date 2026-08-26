import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_CI_COMMAND = "pnpm ci:local";
export const LOCAL_CI_PACKAGE_SCRIPT =
  "node --no-warnings --experimental-strip-types scripts/local-ci.ts";
export type LocalCiStep = Readonly<{ name: string; args: readonly string[] }>;
export const LOCAL_CI_STEPS = Object.freeze([
  Object.freeze({ name: "frozen-install", args: Object.freeze(["install", "--frozen-lockfile"]) }),
  Object.freeze({ name: "repository-check", args: Object.freeze(["check"]) }),
]);

export type LocalCiProjection = {
  packageJson: { scripts?: Record<string, string>; engines?: { node?: string } };
  nodeVersion: string;
  contributorWorkflow: string;
  pullRequestTemplate: string;
  readme: string;
  activeWorkflowFiles: string[];
  publicationWorkflow: string | null;
  dependabot: string;
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
  return {
    packageJson: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    nodeVersion: readFileSync(join(root, ".node-version"), "utf8").trim(),
    contributorWorkflow: readFileSync(join(root, "docs/contributor-workflow.md"), "utf8"),
    pullRequestTemplate: readFileSync(join(root, ".github/pull_request_template.md"), "utf8"),
    readme: readFileSync(join(root, "README.md"), "utf8"),
    activeWorkflowFiles: existsSync(workflows)
      ? readdirSync(workflows, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
      : [],
    publicationWorkflow: existsSync(join(workflows, "publish.yml"))
      ? readFileSync(join(workflows, "publish.yml"), "utf8")
      : null,
    dependabot: readFileSync(join(root, ".github/dependabot.yml"), "utf8"),
  };
}

export function validateLocalCiProjection(
  projection: LocalCiProjection,
  steps: readonly Readonly<{ name: string; args: readonly string[] }>[] = LOCAL_CI_STEPS,
): string[] {
  const errors: string[] = [];
  if (projection.packageJson.engines?.node !== `>=${projection.nodeVersion}`) {
    errors.push(
      `package: .node-version ${projection.nodeVersion} must equal engine minimum ${projection.packageJson.engines?.node}`,
    );
  }
  if (projection.packageJson.scripts?.["ci:local"] !== LOCAL_CI_PACKAGE_SCRIPT) {
    errors.push("package: canonical local CI command differs");
  }
  const check = projection.packageJson.scripts?.check ?? "";
  if ((check.match(/pnpm check:local-ci-contract/gu) ?? []).length !== 1) {
    errors.push("package: main check must consume local CI contract once");
  }
  const lockedSteps = JSON.stringify([
    { name: "frozen-install", args: ["install", "--frozen-lockfile"] },
    { name: "repository-check", args: ["check"] },
  ]);
  if (JSON.stringify(steps) !== lockedSteps) {
    errors.push("contract: local CI steps or order differ");
  }
  if (steps.some((step) => step.args.some((argument) => argument.includes("qualify")))) {
    errors.push("contract: local merge validation must remain non-reference");
  }
  for (const [path, content] of [
    ["README.md", projection.readme],
    ["docs/contributor-workflow.md", projection.contributorWorkflow],
    [".github/pull_request_template.md", projection.pullRequestTemplate],
  ] as const) {
    if (!content.includes(`\`${LOCAL_CI_COMMAND}\``) && !content.includes(`${LOCAL_CI_COMMAND}\n`)) {
      errors.push(`${path}: canonical local CI command missing`);
    }
  }
  const unexpectedWorkflows = projection.activeWorkflowFiles.filter((name) => name !== "publish.yml");
  if (unexpectedWorkflows.length !== 0) {
    errors.push(`workflows: hosted merge CI remains active (${unexpectedWorkflows.join(", ")})`);
  }
  if (projection.activeWorkflowFiles.includes("publish.yml")) {
    const workflow = projection.publicationWorkflow ?? "";
    if (!workflow.includes("release:")
      || !workflow.includes("types: [published]")
      || !workflow.includes("pnpm check:a0-release")
      || !workflow.includes("npm publish ./packages/framework")
      || /^\s+(?:push|pull_request|workflow_dispatch|schedule):/mu.test(workflow)) {
      errors.push("workflows: publication transport is not release-only");
    }
  } else if (projection.publicationWorkflow !== null) {
    errors.push("workflows: unlisted publication transport content remains");
  }
  if (projection.dependabot.includes("package-ecosystem: github-actions")) {
    errors.push("dependabot: inactive GitHub Actions ecosystem remains configured");
  }
  return errors;
}
