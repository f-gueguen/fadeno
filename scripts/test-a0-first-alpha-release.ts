import { execFileSync } from "node:child_process";

import {
  loadA0FirstAlphaReleaseContext,
  validateA0FirstAlphaRelease,
  type A0FirstAlphaReleaseContext,
} from "./lib/a0-first-alpha-release.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0FirstAlphaReleaseContext(root, tracked);

function expectMutation(
  expected: string,
  mutate: (context: A0FirstAlphaReleaseContext) => A0FirstAlphaReleaseContext,
): void {
  const errors = validateA0FirstAlphaRelease(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 first-alpha mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateA0FirstAlphaRelease(source);
if (valid.length > 0) throw new Error(`valid A0 first-alpha source refused:\n${valid.join("\n")}`);
expectMutation("FADENO_A0_RELEASE_SOURCE_VERSION", (context) => Object.freeze({
  ...context,
  manifest: { ...(context.manifest as Record<string, unknown>), version: "0.0.0" },
}));
expectMutation("A0 first-alpha prerelease intent drifted", (context) => Object.freeze({
  ...context,
  prerelease: { ...(context.prerelease as Record<string, unknown>), tag: "latest" },
}));
expectMutation("A0 first-alpha prior qualification drifted", (context) => Object.freeze({
  ...context,
  alphaCandidate: { ...(context.alphaCandidate as Record<string, unknown>), status: "incomplete" },
}));
expectMutation("A0 documentation aggregate drifted", (context) => Object.freeze({
  ...context,
  docsManifest: { ...(context.docsManifest as Record<string, unknown>), aggregateSha256: "0".repeat(64) },
}));
expectMutation("A0 first-alpha recovery evidence drifted", (context) => Object.freeze({
  ...context,
  recovery: { ...(context.recovery as Record<string, unknown>), staleDiagnosticPresent: true },
}));
expectMutation("A0 first-alpha publication workflow drifted", (context) => Object.freeze({
  ...context,
  workflow: `${context.workflow}\n  pull_request:\n`,
}));
expectMutation("REL-01 is missing A0 first-alpha release traceability", (context) => Object.freeze({
  ...context,
  traceability: context.traceability.replace(/^\| REL-01 \|.*$/mu, (line) => line.replace("`pnpm check:a0-first-alpha-release`", "removed")),
}));

console.log("A0 first-alpha release mutation tests passed (version, prerelease, prior qualification, docs, recovery, workflow, traceability)");
