import { execFileSync } from "node:child_process";

import { loadV2PlanContext, validateV2Plan, type V2PlanContext } from "./lib/v2-plan.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadV2PlanContext(root, tracked);

function mutation(expected: string, mutate: (context: V2PlanContext) => V2PlanContext): void {
  const errors = validateV2Plan(mutate(source));
  if (!errors.includes(expected)) throw new Error(`V2 plan mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateV2Plan(source);
if (valid.length > 0) throw new Error(`valid V2 plan refused:\n${valid.join("\n")}`);
mutation("V2 roadmap slices must be exactly V2-00, V2-01, V2-01A, V2-02 through V2-10, V2-10A, V2-10B, V2-10C, V2-11, V2-11A, V2-11B, then V2-12 in order", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("| V2-06 |", "| V2-16 |"),
}));
mutation("V2 roadmap V2-04 dependency contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace("| V2-03 |", "| V2-08 |")),
}));
mutation("V2 roadmap V2-04 outcome contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace("Enhance link navigation under the accepted request and URL ownership contract", "TBD")),
}));
mutation("V2 roadmap V2-02 decision ownership mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-02 \|.*$/mu, (line) => line.replace("| V2-01, V2-01A |", "| DG-V2-01; V2-01, V2-01A |")),
}));
mutation("V2 roadmap V2-02 feature contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-02 \|.*$/mu, (line) => line.replace(", SEC-01, TEST-01", ", TEST-01")),
}));
mutation("V2 roadmap V2-09 validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-09 \|.*$/mu, (line) => line.replace(/\| [^|]+ \|$/u, "| TBD |")),
}));
mutation("V2 roadmap V2-02 artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-02 \|.*$/mu, (line) => line.replace("; one pending Changeset with semantic version intent", "")),
}));
mutation("V2 roadmap V2-02 validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-02 \|.*$/mu, (line) => line.replace("; negative authorization and cross-user isolation", "")),
}));
mutation("V2 roadmap V2-02 validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-02 \|.*$/mu, (line) => line.replace("; current-packed rendered-page execution under the real nonce policy", "")),
}));
mutation("V2 roadmap V2-10C artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-10C \|.*$/mu, (line) => line.replace(" and frozen relative baseline", "")),
}));
mutation("V2 roadmap V2-06 validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-06 \|.*$/mu, (line) => line.replace("GET-form encoding, URL, history, and no-mutation-authority equivalence; ", "")),
}));
mutation("V2 roadmap V2-06 artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-06 \|.*$/mu, (line) => line.replace("form-interception threat-model update; ", "")),
}));
mutation("V2 roadmap V2-04 artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace("explicit eligibility matrix retaining native activation for external, target, download, modifier-click, and same-document-fragment links; ", "")),
}));
mutation("V2 roadmap V2-10B validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-10B \|.*$/mu, (line) => line.replace("pending feedback and validation-error association regressions; ", "")),
}));
mutation("V2 roadmap V2-11B artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-11B \|.*$/mu, (line) => line.replace("historical alpha.1 checks remain byte- and identity-exact; ", "")),
}));
mutation("DG-V2-01 is missing Open", (context) => Object.freeze({
  ...context,
  decisionGates: context.decisionGates.replace(/^\| DG-V2-01 \|.*$/mu, (line) => line.replace("| Open |", "| Resolved |")),
}));
mutation("V2 roadmap is missing Islands remain V3", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("Islands remain V3", "Islands move into V2"),
}));
mutation("ENH-01 traceability is missing V2-00 ownership", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| ENH-01 \|.*$/mu, (line) => line.replace("V2 plan", "removed plan")),
}));
mutation("ACCESS-01 scope is missing V2 ownership", (context) => Object.freeze({
  ...context,
  scope: context.scope.replace(/^\| ACCESS-01 \|.*$/mu, (line) => line.replaceAll("V2", "removed")),
}));
mutation("TEST-01 traceability is missing V2 ownership", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| TEST-01 \|.*$/mu, (line) => line.replaceAll("V2", "removed")),
}));
mutation("README handoff is missing current V2 plan", (context) => Object.freeze({
  ...context,
  readme: context.readme.replaceAll("current V2 plan", "future V2 plan"),
}));
mutation("V2 entry package identity drifted", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), private: true },
}));

console.log("V2 plan mutation tests passed (19 slices, exact outcomes/contracts, native fallback, accessibility feedback, form security, relative baseline, historical/current release identity, and traceability)");
