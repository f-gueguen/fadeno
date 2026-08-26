import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertStableLocalCiSnapshot,
  loadLocalCiProjection,
  LOCAL_CI_STEPS,
  type LocalCiProjection,
  validateLocalCiProjection,
} from "./lib/local-ci-contract.ts";
import { runLocalCi, type LocalCiAdapter } from "./lib/local-ci-runner.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = loadLocalCiProjection(root);
let detected = 0;

const baseErrors = validateLocalCiProjection(base);
if (baseErrors.length !== 0) throw new Error(`local CI base projection differs: ${baseErrors.join("; ")}`);

function mutation(label: string, mutate: (projection: LocalCiProjection) => void): void {
  const projection = structuredClone(base);
  mutate(projection);
  if (validateLocalCiProjection(projection).length === 0) {
    throw new Error(`local CI mutation was not detected: ${label}`);
  }
  detected += 1;
}

mutation("command", (value) => { value.packageJson.scripts!["ci:local"] = "pnpm check"; });
mutation("Node pin below engine", (value) => { value.nodeVersion = "22.16.0"; });
mutation("main check", (value) => {
  value.packageJson.scripts!.check = value.packageJson.scripts!.check.replace(
    "pnpm check:local-ci-contract && ",
    "",
  );
});
mutation("active workflow", (value) => { value.activeWorkflowFiles.push("check.yml"); });
mutation("publication trigger", (value) => {
  value.publicationWorkflow = value.publicationWorkflow!.replace("  release:\n", "  pull_request:\n");
});
mutation("README", (value) => { value.readme = value.readme.replace("pnpm ci:local", "pnpm check"); });
mutation("contributor workflow", (value) => {
  value.contributorWorkflow = value.contributorWorkflow.replaceAll("pnpm ci:local", "pnpm check");
});
mutation("pull request template", (value) => {
  value.pullRequestTemplate = value.pullRequestTemplate.replace("pnpm ci:local", "pnpm check");
});
mutation("Dependabot", (value) => { value.dependabot += "\npackage-ecosystem: github-actions\n"; });

if (validateLocalCiProjection(base, [...LOCAL_CI_STEPS].reverse()).length === 0) {
  throw new Error("local CI step-order mutation was not detected");
}
detected += 1;

function controlledAdapter(options: {
  heads?: readonly string[];
  statuses?: readonly string[];
  failStep?: string;
} = {}): { adapter: LocalCiAdapter; events: string[] } {
  const events: string[] = [];
  const heads = [...(options.heads ?? ["abc", "abc", "abc"])];
  const statuses = [...(options.statuses ?? ["", "", ""])];
  return {
    events,
    adapter: {
      gitHead: () => {
        events.push("git:head");
        return heads.shift() ?? "abc";
      },
      gitStatus: () => {
        events.push("git:status");
        return statuses.shift() ?? "";
      },
      runStep: (step) => {
        events.push(`pnpm:${step.args.join(" ")}`);
        if (options.failStep === step.name) throw new Error(`controlled failure: ${step.name}`);
      },
      report: (message) => events.push(`report:${message}`),
    },
  };
}

const control = controlledAdapter();
if (runLocalCi(control.adapter, []) !== "abc") throw new Error("local CI did not return exact HEAD");
const expectedEvents = [
  "git:head",
  "git:status",
  "pnpm:install --frozen-lockfile",
  "git:head",
  "git:status",
  "pnpm:check",
  "git:head",
  "git:status",
  "report:local CI passed at abc",
];
if (JSON.stringify(control.events) !== JSON.stringify(expectedEvents)) {
  throw new Error(`local CI process order differs: ${control.events.join(",")}`);
}

for (const [label, options, expectedLastEvent] of [
  ["dirty start", { statuses: ["?? untracked"] }, "git:status"],
  ["head after install", { heads: ["abc", "def"] }, "git:status"],
  ["dirty after install", { statuses: ["", " M package.json"] }, "git:status"],
  ["install failure", { failStep: "frozen-install" }, "pnpm:install --frozen-lockfile"],
  ["check failure", { failStep: "repository-check" }, "pnpm:check"],
] as const) {
  const controlled = controlledAdapter(options);
  let refused = false;
  try {
    runLocalCi(controlled.adapter, []);
  } catch {
    refused = true;
  }
  if (!refused || controlled.events.at(-1) !== expectedLastEvent) {
    throw new Error(`local CI behavioral control differed: ${label}`);
  }
  detected += 1;
}

try {
  runLocalCi(controlledAdapter().adapter, ["--qualify"]);
  throw new Error("local CI argument control was accepted");
} catch (error: unknown) {
  if (error instanceof Error && error.message.endsWith("was accepted")) throw error;
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

console.log(`local CI negative tests passed (${detected} mutations, release-only publication transport retained)`);
