import { execFileSync } from "node:child_process";
import { loadA0CssContext, validateA0Css, type A0CssContext } from "./lib/a0-css.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const source = loadA0CssContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0CssContext) => A0CssContext): void {
  const errors = validateA0Css(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 CSS mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Css(source);
if (validErrors.length > 0) throw new Error(`valid A0 CSS boundary refused:\n${validErrors.join("\n")}`);

expectMutation("DG-A0-03 remains open after ADR 0036", (context) => Object.freeze({ ...context, decisionGates: `${context.decisionGates}\n| DG-A0-03 | restored |` }));
expectMutation("renderer CSS CSP boundary drifted", (context) => Object.freeze({ ...context, renderer: context.renderer.replace("style-src 'self'", "style-src 'unsafe-inline'") }));
expectMutation("canonical application CSS handler drifted", (context) => Object.freeze({ ...context, handler: context.handler.replace("text/css", "text/plain") }));
expectMutation("canonical application CSS accessibility baseline drifted", (context) => Object.freeze({ ...context, styles: context.styles.replace("prefers-reduced-motion: reduce", "prefers-reduced-motion: no-preference") }));
expectMutation("documentation source is missing check:a0-css", (context) => Object.freeze({
  ...context,
  documentationSource: {
    ...(context.documentationSource as Record<string, unknown>),
    verificationGates: (context.documentationSource as { verificationGates: readonly string[] }).verificationGates.filter((gate) => gate !== "check:a0-css"),
  },
}));
expectMutation("A0 CSS crossed the private package boundary", (context) => Object.freeze({
  ...context,
  packageDocument: { ...(context.packageDocument as Record<string, unknown>), private: false },
}));
expectMutation("A0 CSS evidence is not tracked: examples/v1-app/expected/css-baseline.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked].filter((path) => path !== "examples/v1-app/expected/css-baseline.json")),
}));

console.log("A0 CSS mutation tests passed (decision, CSP, handler, accessibility, evidence, package, tracking)");
