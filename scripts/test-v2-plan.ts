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
mutation("V2 roadmap slices must be exactly V2-00, V2-01, V2-01A, V2-02 through V2-05, V2-05A, V2-06, V2-07, V2-07A, V2-08 through V2-10, V2-10A, V2-10B, V2-10C, V2-11, V2-11A, V2-11B, then V2-12 in order", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("| V2-06 |", "| V2-16 |"),
}));
mutation("V2 roadmap V2-04 dependency contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace("| V2-03 |", "| V2-08 |")),
}));
mutation("V2 roadmap V2-05A artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-05A \|.*$/mu, (line) => line.replace("application-owned public facts", "private telemetry")),
}));
mutation("V2 roadmap V2-05A feature contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-05A \|.*$/mu, (line) => line.replace(", SEC-01", "")),
}));
mutation("V2 roadmap V2-05A validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-05A \|.*$/mu, (line) => line.replace("hostile-origin refusal, ", "")),
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
mutation("V2 roadmap V2-04 feature contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace(", SEC-01", "")),
}));
mutation("V2 roadmap V2-04 artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-04 \|.*$/mu, (line) => line.replace(/link-interception threat-model update[^;]+; /u, "")),
}));
mutation("V2 roadmap V2-10B validation contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-10B \|.*$/mu, (line) => line.replace("pending feedback and validation-error association regressions; ", "")),
}));
mutation("V2 roadmap V2-11B artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-11B \|.*$/mu, (line) => line.replace("historical alpha.1 checks remain byte- and identity-exact; ", "")),
}));
mutation("V2 roadmap V2-11 artifact contract mismatch", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(/^\| V2-11 \|.*$/mu, (line) => line.replace("post-hardening replay that supersedes V2-09 on the exact V2-10C artifact; ", "")),
}));
mutation("resolved DG-V2-01 must leave the open decision-gate ledger", (context) => Object.freeze({
  ...context,
  decisionGates: context.decisionGates.replace(
    "| DG-V3-02 |",
    "| DG-V2-01 | ENH-01 implementation | removed decision | removed evidence | removed artifact | Open |\n| DG-V3-02 |",
  ),
}));
mutation("V2 roadmap is missing Islands remain V3", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("Islands remain V3", "Islands move into V2"),
}));
mutation("V2 roadmap is missing Every user-observable capability extends the canonical application", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace(
    "Every user-observable capability extends the canonical application",
    "Protocol fixtures replace canonical integration",
  ),
}));
mutation("ENH-01 traceability is missing the V2-01 decision boundary", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| ENH-01 \|.*$/mu, (line) => line.replace("check:v2-patch-protocol", "removed gate")),
}));
mutation("ACCESS-01 scope is missing V2 ownership", (context) => Object.freeze({
  ...context,
  scope: context.scope.replace(/^\| ACCESS-01 \|.*$/mu, (line) => line.replaceAll("V2", "removed")),
}));
mutation("TEST-01 traceability is missing V2 ownership", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| TEST-01 \|.*$/mu, (line) => line.replaceAll("V2", "removed")),
}));
mutation("V2-05A SEC-01 scope contract drifted", (context) => Object.freeze({
  ...context,
  scope: context.scope.replace(/^\| SEC-01 \|.*$/mu, (line) => line.replace(/; V2-05A demonstrates this retained boundary[^;]+/u, "")),
}));
mutation("V2-05A DOC-01 traceability contract drifted", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| DOC-01 \|.*$/mu, (line) => line.replace(/; V2-05A makes accepted outcomes discoverable[^;]+/u, "")),
}));
mutation("V2-05A anti-fabrication risk contract drifted", (context) => Object.freeze({
  ...context,
  risks: context.risks.replace(/^\| The canonical demonstration overstates private or unobserved behavior.*\n/mu, ""),
}));
mutation("V2-05A Changeset exemption contract drifted", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace("; V2-05A is explicitly exempt because it changes no publishable package behavior", ""),
}));
mutation("README handoff is missing current V2 plan", (context) => Object.freeze({
  ...context,
  readme: context.readme.replaceAll("current V2 plan", "future V2 plan"),
}));
mutation("V2 roadmap ledger state drifted", (context) => Object.freeze({
  ...context,
  ledger: context.ledger.replace("V2-05A — Merge commit `b951e4d`", "V2-05A — merge identity removed"),
}));
mutation("ADR 0051 is missing never repeats the mutation", (context) => Object.freeze({
  ...context,
  formAdr: context.formAdr.replace("never repeats the mutation", "may retry the mutation"),
}));
mutation("V2-06 Changeset contract drifted", (context) => Object.freeze({
  ...context,
  formChangeset: context.formChangeset.replace('"@fadeno/framework": minor', '"@fadeno/framework": patch'),
}));
mutation("V2-06 DATA-02 scope contract drifted", (context) => Object.freeze({
  ...context,
  scope: context.scope.replace(/^\| DATA-02 \|.*$/mu, (line) => line.replace(/; \[ADR 0051\][^;|]+/u, "")),
}));
mutation("V2-06 ENH-01 traceability contract drifted", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| ENH-01 \|.*$/mu, (line) => line.replace("check:v2-form-submission", "removed form gate")),
}));
mutation("V2-06 form risk contract drifted", (context) => Object.freeze({
  ...context,
  risks: context.risks.replace(/^\| Enhanced forms change controls.*\n/mu, ""),
}));
mutation("ADR 0052 is missing never submits POST again", (context) => Object.freeze({
  ...context,
  actionAdr: context.actionAdr.replace("never submits POST again", "may submit POST again"),
}));
mutation("V2-07 Changeset contract drifted", (context) => Object.freeze({
  ...context,
  actionChangeset: context.actionChangeset.replace('"@fadeno/framework": minor', '"@fadeno/framework": patch'),
}));
mutation("V2-07 DATA-03 scope contract drifted", (context) => Object.freeze({
  ...context,
  scope: context.scope.replace(/^\| DATA-03 \|.*$/mu, (line) => line.replace(/; \[ADR 0052\][^|]+/u, "")),
}));
mutation("V2-07 ENH-01 traceability contract drifted", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| ENH-01 \|.*$/mu, (line) => line.replace("check:v2-action-ordering", "removed action gate")),
}));
mutation("V2-07 action-ordering risk contract drifted", (context) => Object.freeze({
  ...context,
  risks: context.risks.replace(/^\| Enhanced forms change controls.*\n/mu, ""),
}));
mutation("V2 entry package identity drifted", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), private: true },
}));

console.log("V2 plan mutation tests passed (20 slices, evaluator-ready demo, exact outcomes/contracts, native fallback and security, post-hardening replay, accessibility feedback, form security, relative baseline, historical/current release identity, and traceability)");
