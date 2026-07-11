import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertStableLocalCiSnapshot,
  loadLocalCiProjection,
  LOCAL_CI_STEPS,
  type LocalCiProjection,
  validateLocalCiProjection,
} from "./lib/local-ci-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = loadLocalCiProjection(root);
let detected = 0;

function mutation(label: string, mutate: (projection: LocalCiProjection) => void): void {
  const projection = structuredClone(base);
  mutate(projection);
  if (validateLocalCiProjection(projection).length === 0) {
    throw new Error(`local CI mutation was not detected: ${label}`);
  }
  detected += 1;
}

mutation("command", (value) => { value.packageJson.scripts!["ci:local"] = "pnpm check"; });
mutation("main check", (value) => {
  value.packageJson.scripts!.check = value.packageJson.scripts!.check.replace(
    "pnpm check:local-ci-contract && ",
    "",
  );
});
mutation("runner clean check", (value) => {
  value.runnerSource = value.runnerSource.replace("gitStatus(root)", '""');
});
mutation("runner head check", (value) => {
  value.runnerSource = value.runnerSource.replaceAll("gitHead(root)", '"fixed"');
});
mutation("reference impersonation", (value) => {
  value.runnerSource += "\nFADENO_EXPECT_REFERENCE=1\n";
});
mutation("active workflow", (value) => { value.activeWorkflowFiles.push("check.yml"); });
mutation("README", (value) => { value.readme = value.readme.replace("pnpm ci:local", "pnpm check"); });
mutation("contributor workflow", (value) => {
  value.contributorWorkflow = value.contributorWorkflow.replaceAll("pnpm ci:local", "pnpm check");
});
mutation("pull request template", (value) => {
  value.pullRequestTemplate = value.pullRequestTemplate.replace("pnpm ci:local", "pnpm check");
});
mutation("Dependabot", (value) => { value.dependabot += "\npackage-ecosystem: github-actions\n"; });
mutation("reference provider", (value) => { value.referenceProvider = "local"; });

if (validateLocalCiProjection(base, [...LOCAL_CI_STEPS].reverse()).length === 0) {
  throw new Error("local CI step-order mutation was not detected");
}
detected += 1;

assertStableLocalCiSnapshot("abc", "abc", "", "control");
for (const [label, head, status] of [
  ["dirty", "abc", "?? untracked"],
  ["head change", "def", ""],
] as const) {
  let refused = false;
  try {
    assertStableLocalCiSnapshot("abc", head, status, label);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error(`local CI runtime mutation was not detected: ${label}`);
  detected += 1;
}

console.log(`local CI negative tests passed (${detected} mutations)`);
