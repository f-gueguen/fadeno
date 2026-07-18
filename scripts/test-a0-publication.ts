import { execFileSync } from "node:child_process";
import { loadA0PublicationContext, validateA0Publication, type A0PublicationContext } from "./lib/a0-publication.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0PublicationContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0PublicationContext) => A0PublicationContext): void {
  const errors = validateA0Publication(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 publication mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Publication(source);
if (validErrors.length > 0) throw new Error(`valid A0 publication boundary refused:\n${validErrors.join("\n")}`);

expectMutation("A0-02 crossed the private package boundary", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), private: false },
}));
expectMutation("accepted public export mapping drifted", (context) => Object.freeze({
  ...context,
  packageDocument: {
    ...(context.packageDocument as Record<string, unknown>),
    exports: { ...((context.packageDocument as { exports: Record<string, unknown> }).exports), "./extra": "./dist/extra.js" },
  },
}));
expectMutation("accepted executable mapping drifted", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), bin: { fadeno: "./dist/index.js" } },
}));
expectMutation("accepted registry identity evidence drifted", (context) => Object.freeze({
  ...context,
  registryEvidence: { ...(context.registryEvidence as Record<string, unknown>), selectedIdentity: "@fadeno/other" },
}));
expectMutation("public-package identity gate remains open after ADR 0037", (context) => Object.freeze({
  ...context,
  decisionGates: `${context.decisionGates}\n| DG-A0-01 | restored |`,
}));
expectMutation("ADR 0037 is missing source repository must be public", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace("source repository must be public", "source repository visibility is unspecified"),
}));
expectMutation("ADR 0037 is missing revoked immediately", (context) => Object.freeze({
  ...context,
  adr: context.adr.replace("revoked immediately", "retained indefinitely"),
}));
expectMutation("A0 publication evidence is not tracked: evidence/a0/registry-discovery.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked].filter((path) => path !== "evidence/a0/registry-discovery.json")),
}));
expectMutation("A0-02 introduced publication automation before A0-03", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked, ".github/workflows/publish.yml"]),
}));

console.log("A0 publication mutation tests passed (identity, exports, executable, private boundary, provenance, bootstrap, automation, tracking)");
