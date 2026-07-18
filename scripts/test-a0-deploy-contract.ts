import { execFileSync } from "node:child_process";
import { loadA0DeployContext, validateA0Deploy, type A0DeployContext } from "./lib/a0-deploy-contract.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
}).trim().split("\n"));
const source = loadA0DeployContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0DeployContext) => A0DeployContext): void {
  const errors = validateA0Deploy(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 deployment mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Deploy(source);
if (validErrors.length > 0) throw new Error(`valid A0 deployment contract refused:\n${validErrors.join("\n")}`);

expectMutation("resolved deployment decision gate remains open", (context) => Object.freeze({
  ...context,
  gates: `${context.gates}\n| DG-A0-04 | restored | restored | restored | restored | Open |\n`,
}));
expectMutation("deployment artifact identity verification drifted", (context) => Object.freeze({
  ...context,
  buildImplementation: context.buildImplementation.replace("export async function assertPrivateDeploymentArtifact", "async function removedArtifactVerifier"),
}));
expectMutation("public deploy command dispatch drifted", (context) => Object.freeze({
  ...context,
  cli: context.cli.replace('arguments_[0] === "deploy"', 'arguments_[0] === "other"'),
}));
expectMutation("A0-06 introduced a public deployment export", (context) => Object.freeze({
  ...context,
  frameworkPackage: {
    ...(context.frameworkPackage as Record<string, unknown>),
    exports: { ...((context.frameworkPackage as { exports: Record<string, unknown> }).exports), "./deploy": "./dist/deploy.js" },
  },
}));
expectMutation("documentation source is missing complete A0 deployment evidence", (context) => Object.freeze({
  ...context,
  documentationSource: {
    ...(context.documentationSource as Record<string, unknown>),
    evidence: {
      ...((context.documentationSource as { evidence: Record<string, readonly string[]> }).evidence),
      recovery: (context.documentationSource as { evidence: Record<string, readonly string[]> }).evidence["recovery"]
        ?.filter((path) => path !== "scenarios/deployment/expected/recovery.json"),
    },
  },
}));
expectMutation("A0 deployment evidence is not tracked: examples/v1-app/scenarios/deployment/expected/flow.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked].filter((path) => path !== "examples/v1-app/scenarios/deployment/expected/flow.json")),
}));

console.log("A0 deployment mutation checks passed (gate, identity, CLI, exports, docs, evidence)");
