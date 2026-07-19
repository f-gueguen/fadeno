import { execFileSync } from "node:child_process";

import {
  loadA0ToolingDeferralContext,
  validateA0ToolingDeferral,
  type A0ToolingDeferralContext,
} from "./lib/a0-tooling-deferral.ts";

const root = process.cwd();
const tracked = new Set(execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
).trim().split("\n"));
const source = loadA0ToolingDeferralContext(root, tracked);

function expectMutation(
  expected: string,
  mutate: (context: A0ToolingDeferralContext) => A0ToolingDeferralContext,
): void {
  const errors = validateA0ToolingDeferral(mutate(source));
  if (!errors.includes(expected)) {
    throw new Error(`A0 tooling-deferral mutation was not refused: ${expected}\n${errors.join("\n")}`);
  }
}

const validErrors = validateA0ToolingDeferral(source);
if (validErrors.length > 0) {
  throw new Error(`valid A0 tooling deferral refused:\n${validErrors.join("\n")}`);
}

expectMutation("ADR 0043 is missing no participant outcome or usability claim is accepted by default", (context) => Object.freeze({
  ...context,
  adr43: context.adr43.replace("no participant", "missing attempts"),
}));
expectMutation("deferred analyzer gate returned", (context) => Object.freeze({
  ...context,
  decisionGates: `${context.decisionGates}\n| DG-A0-02 | restored | restored | restored | restored | Open |`,
}));
expectMutation("release policy is missing first alpha release notes", (context) => Object.freeze({
  ...context,
  releasePolicy: context.releasePolicy.replace("first alpha release notes", "future notes"),
}));
expectMutation("public package exposes an analyzer or editor surface", (context) => Object.freeze({
  ...context,
  packageDocument: {
    ...(context.packageDocument as Record<string, unknown>),
    exports: {
      ...((context.packageDocument as { exports: Record<string, unknown> }).exports),
      "./analyzer": "./dist/analyzer.js",
    },
  },
}));
expectMutation("workspace check does not enforce A0 tooling deferral", (context) => Object.freeze({
  ...context,
  workspaceDocument: {
    ...(context.workspaceDocument as Record<string, unknown>),
    scripts: {
      ...((context.workspaceDocument as { scripts: Record<string, unknown> }).scripts),
      "check:a0-tooling-deferral": "true",
    },
  },
}));
expectMutation("current A0 ledger is missing A0-08 — explicitly defer external analyzer/editor tooling", (context) => Object.freeze({
  ...context,
  ledger: context.ledger.replace(
    "A0-08 — explicitly defer external analyzer/editor tooling",
    "A0-08 — publish analyzer tooling",
  ),
}));
expectMutation("unavailable participant evidence was added: evidence/a0/independent-usability/evidence-manifest.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked, "evidence/a0/independent-usability/evidence-manifest.json"]),
}));

console.log("A0 tooling-deferral mutation tests passed (fabrication, restored gate, disclosure, exports, workspace gate, ledger, participant evidence)");
