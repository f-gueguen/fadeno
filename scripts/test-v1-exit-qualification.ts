import { execFileSync } from "node:child_process";
import { createV1ExitContext, readV1ExitDocument, validateV1ExitDocument } from "./lib/v1-exit-qualification.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const context = createV1ExitContext(root, tracked);
const source = readV1ExitDocument(root);

function copy(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function expectMutation(expected: string, mutate: (document: Record<string, unknown>) => void): void {
  const document = copy();
  mutate(document);
  const errors = validateV1ExitDocument(document, context);
  if (!errors.includes(expected)) throw new Error(`V1 exit mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateV1ExitDocument(source, context);
if (validErrors.length > 0) throw new Error(`valid V1 exit qualification refused:\n${validErrors.join("\n")}`);

expectMutation("V1 exit feature missing: WEB-01", (document) => {
  document["features"] = (document["features"] as Record<string, unknown>[]).filter((feature) => feature["id"] !== "WEB-01");
});
expectMutation("V1 exit feature WEB-01 unknown gate: check:not-real", (document) => {
  ((document["features"] as Record<string, unknown>[])[0]?.["gates"] as string[]).push("check:not-real");
});
expectMutation("V1 exit unsupported claim must remain false: packagePublishable", (document) => {
  (document["claims"] as Record<string, unknown>)["packagePublishable"] = true;
});
expectMutation("V1 exit audit missing: security", (document) => {
  document["audits"] = (document["audits"] as Record<string, unknown>[]).filter((audit) => audit["id"] !== "security");
});
expectMutation("V1 exit accessibility baseline evidence is missing", (document) => {
  const access = (document["features"] as Record<string, unknown>[]).find((feature) => feature["id"] === "ACCESS-01");
  if (access) access["evidence"] = ["docs/guides/getting-started.md"];
});
expectMutation("V1 exit feature WEB-01 unsafe evidence path: ../escape.json", (document) => {
  ((document["features"] as Record<string, unknown>[])[0] as Record<string, unknown>)["evidence"] = ["../escape.json"];
});
expectMutation("V1 exit feature WEB-01 evidence is not tracked regular content: evidence/v1-exit/not-tracked.json", (document) => {
  ((document["features"] as Record<string, unknown>[])[0] as Record<string, unknown>)["evidence"] = ["evidence/v1-exit/not-tracked.json"];
});
const withoutExactAdapterGate = Object.freeze({
  ...context,
  rootGates: new Set([...context.rootGates].filter((gate) => gate !== "check:v1-adapter")),
});
const exactGateErrors = validateV1ExitDocument(source, withoutExactAdapterGate);
if (!exactGateErrors.includes("V1 exit feature ADP-01 gate is outside root check: check:v1-adapter")) {
  throw new Error("V1 exit exact root-gate ownership was not enforced");
}

console.log("V1 exit qualification mutation tests passed (feature, exact gate, claim, audit, accessibility, containment)");
