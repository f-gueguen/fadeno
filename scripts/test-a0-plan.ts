import { execFileSync } from "node:child_process";
import { loadA0PlanContext, validateA0Plan, type A0PlanContext } from "./lib/a0-plan.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0PlanContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0PlanContext) => A0PlanContext): void {
  const errors = validateA0Plan(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 plan mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Plan(source);
if (validErrors.length > 0) throw new Error(`valid A0 plan refused:\n${validErrors.join("\n")}`);
expectMutation("A0 registry identity mapping mismatch", (context) => Object.freeze({
  ...context,
  registry: { ...(context.registry as Record<string, unknown>), selectedIdentity: "unverified" },
}));
expectMutation("A0 registry observation date mismatch", (context) => Object.freeze({
  ...context,
  registry: { ...(context.registry as Record<string, unknown>), observedAt: "stale" },
}));
expectMutation("A0 roadmap slices must be exactly A0-00 through A0-10 in order", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("| A0-05 |", "| A0-15 |"),
}));
expectMutation("A0 roadmap A0-04 dependency contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| A0-04 \|.*$/mu, (line) => line.replace("| A0-03 |", "| A0-10 |")),
}));
expectMutation("A0 roadmap A0-02 decision ownership mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| A0-02 \|.*$/mu, (line) => line.replace("ADR 0037 package-publication decision", "DG-A0-01 package-publication decision")),
}));
expectMutation("A0 unresolved decision gate drifted: DG-A0-02", (context) => Object.freeze({
  ...context,
  decisionGates: context.decisionGates.replace("| DG-A0-02 |", "| DG-A0-X2 |"),
}));
expectMutation("A0 publishable package seed drifted", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), private: true },
}));

console.log("A0 plan mutation tests passed (identity, freshness, ordering, dependencies, ownership, gates, package seed)");
