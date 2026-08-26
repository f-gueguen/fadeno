import { execFileSync } from "node:child_process";
import {
  loadA0CreateContext,
  validateA0Create,
  type A0CreateContext,
} from "./lib/a0-create-contract.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0CreateContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0CreateContext) => A0CreateContext): void {
  const errors = validateA0Create(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 create mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Create(source);
if (validErrors.length > 0) throw new Error(`valid A0 create contract refused:\n${validErrors.join("\n")}`);

expectMutation("ADR 0039 project-creation contract drifted", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace("- Status: Accepted", "- Status: Proposed"),
}));
expectMutation("public executable create dispatch drifted", (context) => Object.freeze({
  ...context,
  cli: context.cli.replace("create: async () =>", "new: async () =>"),
}));
expectMutation("check:a0-create command drifted", (context) => Object.freeze({
  ...context,
  rootPackage: {
    ...(context.rootPackage as Record<string, unknown>),
    scripts: { ...((context.rootPackage as { scripts: Record<string, string> }).scripts), "check:a0-create": "true" },
  },
}));
expectMutation("create package identity drifted", (context) => Object.freeze({
  ...context,
  frameworkPackage: { ...(context.frameworkPackage as Record<string, unknown>), bin: { fadeno: "./other.js" } },
}));
expectMutation("generated project manifest drifted", (context) => Object.freeze({
  ...context,
  generatedPackage: {
    ...(context.generatedPackage as Record<string, unknown>),
    dependencies: { "@fadeno/framework": "different" },
  },
}));
expectMutation("documentation source is missing check:a0-create", (context) => Object.freeze({
  ...context,
  documentationSource: {
    ...(context.documentationSource as Record<string, unknown>),
    verificationGates: (context.documentationSource as { verificationGates: readonly string[] }).verificationGates
      .filter((gate) => gate !== "check:a0-create"),
  },
}));
expectMutation("A0 create evidence is not tracked: examples/v1-app/scenarios/project-creation/expected/flow.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked].filter((path) => path !== "examples/v1-app/scenarios/project-creation/expected/flow.json")),
}));

console.log("A0 create mutation tests passed (decision, dispatch, command, package, scaffold, documentation, tracking)");
