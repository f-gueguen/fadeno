import { execFileSync } from "node:child_process";

import {
  loadA0PublicReleaseEvidenceContext,
  validateA0PublicReleaseEvidence,
  type A0PublicReleaseEvidenceContext,
} from "./lib/a0-public-release-evidence.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0PublicReleaseEvidenceContext(root, tracked);

function mutation(
  expected: string,
  mutate: (context: A0PublicReleaseEvidenceContext) => A0PublicReleaseEvidenceContext,
): void {
  const errors = validateA0PublicReleaseEvidence(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 public-release mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateA0PublicReleaseEvidence(source);
if (valid.length > 0) throw new Error(`valid A0 public-release evidence refused:\n${valid.join("\n")}`);

mutation("A0 public-release qualification drifted", (context) => Object.freeze({
  ...context,
  qualification: {
    ...(context.qualification as Record<string, unknown>),
    distributionAliases: { alpha: "0.1.0-alpha.1" },
  },
}));
mutation("A0 public-release diagnostics are missing FADENO_A0_BOOTSTRAP_SELF_REVOCATION", (context) => Object.freeze({
  ...context,
  diagnosticHuman: context.diagnosticHuman.replace("FADENO_A0_BOOTSTRAP_SELF_REVOCATION:", "REMOVED:"),
}));
mutation("A0 public-release correction drifted", (context) => Object.freeze({
  ...context,
  correctionAfter: { ...(context.correctionAfter as Record<string, unknown>), bootstrapSecretPresent: true },
}));
mutation("A0 public-release flow drifted", (context) => Object.freeze({
  ...context,
  flow: { ...(context.flow as Record<string, unknown>), skippedWork: [] },
}));
mutation("A0 public-release recovery drifted", (context) => Object.freeze({
  ...context,
  recovery: { ...(context.recovery as Record<string, unknown>), activeRegistryTokens: 1 },
}));
mutation("trusted publication workflow retains NPM_BOOTSTRAP_TOKEN", (context) => Object.freeze({
  ...context,
  workflow: `${context.workflow}\n# NPM_BOOTSTRAP_TOKEN`,
}));
mutation("trusted publication workflow became non-release automation", (context) => Object.freeze({
  ...context,
  workflow: `${context.workflow}\n  pull_request:\n`,
}));
mutation("REL-01 traceability is missing public-release evidence", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| REL-01 \|.*$/mu, (line) => line.replace("ADR 0044", "removed decision")),
}));

console.log("A0 public-release mutation tests passed (aliases, diagnostics, correction, flow, recovery, secrets, triggers, traceability)");
