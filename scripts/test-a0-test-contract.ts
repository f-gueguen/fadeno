import { execFileSync } from "node:child_process";
import { loadA0TestContext, validateA0Test, type A0TestContext } from "./lib/a0-test-contract.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
}).trim().split("\n"));
const source = loadA0TestContext(root, tracked);

function expectMutation(expected: string, mutate: (context: A0TestContext) => A0TestContext): void {
  const errors = validateA0Test(mutate(source));
  if (!errors.includes(expected)) throw new Error(`A0 test mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const validErrors = validateA0Test(source);
if (validErrors.length > 0) throw new Error(`valid A0 test contract refused:\n${validErrors.join("\n")}`);

expectMutation("generated application test command drifted", (context) => Object.freeze({
  ...context,
  generatedPackage: {
    ...(context.generatedPackage as Record<string, unknown>),
    scripts: { ...((context.generatedPackage as { scripts: Record<string, string> }).scripts), test: "other" },
  },
}));
expectMutation("production compiler includes application tests", (context) => Object.freeze({
  ...context,
  productionConfig: { ...(context.productionConfig as Record<string, unknown>), include: ["test/**/*.tsx"] },
}));
expectMutation("production build does not refuse disposable test input", (context) => Object.freeze({
  ...context,
  buildImplementation: context.buildImplementation.replace(
    '|| relativePath.startsWith(".fadeno/test/")',
    "",
  ),
}));
expectMutation("A0-05 introduced a public test export", (context) => Object.freeze({
  ...context,
  frameworkPackage: {
    ...(context.frameworkPackage as Record<string, unknown>),
    exports: { ...((context.frameworkPackage as { exports: Record<string, unknown> }).exports), "./test": "./dist/test.js" },
  },
}));
expectMutation("application test does not use only demonstrated public runtime semantics", (context) => Object.freeze({
  ...context,
  testSource: context.testSource.replace('from "@fadeno/framework"', 'from "@fadeno/framework/internal/test"'),
}));
expectMutation("A0 test evidence is not tracked: examples/v1-app/scenarios/application-test/expected/flow.json", (context) => Object.freeze({
  ...context,
  tracked: new Set([...context.tracked].filter((path) => path !== "examples/v1-app/scenarios/application-test/expected/flow.json")),
}));

console.log("A0 test mutation checks passed (command, isolation, exports, public semantics, evidence)");
