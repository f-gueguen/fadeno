import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@fadeno/framework";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenarioRoot = join(root, "examples/v1-app/scenarios/form-submission");
const outputRoot = join(root, "output/v2-form-submission");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

const playwrightConfig = readFileSync(join(root, "experiments/v2-form-submission/playwright.config.ts"), "utf8");
for (const fragment of [
  "const freshWebkitWorker = /@fresh-webkit-worker/u",
  'name: "webkit"',
  "grepInvert: freshWebkitWorker",
  'name: "webkit-fresh"',
  "grep: freshWebkitWorker",
]) assert.equal(playwrightConfig.includes(fragment), true, `form Playwright config is missing ${fragment}`);
const formTests = readFileSync(join(root, "experiments/v2-form-submission/tests/form-submission.spec.ts"), "utf8");
assert.equal(
  formTests.match(/@fresh-webkit-worker/gu)?.length,
  5,
  "form qualification must move its final six cases to one fresh WebKit worker",
);

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_V2_FORM_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const adr = readFileSync(join(root, "docs/adr/0051-conservative-enhanced-form-submission.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "successful controls",
  "CRLF",
  "actual `form` owner",
  "`noreferrer`",
  "percent-encoded as one bounded header",
  "selected Back entry",
  "GET-callable pre-submit current-truth URL",
  "terminal form flow",
  "before preventing an ordinary native submission",
  "without altering successful controls",
  "never repeats the mutation",
  "public browser facade and private protocol shape do not change",
  "V2-07",
]) assert.equal(adr.includes(fragment), true, `ADR 0051 is missing ${fragment}`);

assert.equal(
  readFileSync(join(root, ".changeset/conservative-form-submission.md"), "utf8"),
  '---\n"@fadeno/framework": minor\n---\n\nEnhance eligible GET forms and protected POST actions while retaining exact\nnative successful controls, server action authority, and non-repeating recovery.\n',
);
const scope = readFileSync(join(root, "docs/product/scope.md"), "utf8");
const traceability = readFileSync(join(root, "docs/traceability.md"), "utf8");
for (const feature of ["DATA-02", "STATE-01", "SEC-01", "TEST-01", "ENH-01", "PATCH-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0051"), true, `${feature} scope is missing ADR 0051`);
  assert.equal(traceabilityRow.includes("ADR 0051") && traceabilityRow.includes("check:v2-form-submission"), true, `${feature} traceability is missing V2-06 evidence`);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-form-submission-"));
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("FADENO_V2_FORM_TARBALL");

  rmSync(outputRoot, { recursive: true, force: true });
  const builtConsumer = join(temporaryRoot, "consumer");
  mkdirSync(join(builtConsumer, "src"), { recursive: true });
  writeJson(join(builtConsumer, "package.json"), {
    name: "fadeno-v2-form-submission-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${join(tarballs, tarball)}` },
  });
  writeJson(join(builtConsumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  });
  cpSync(join(scenarioRoot, "application.ts"), join(builtConsumer, "src/application.ts"));
  cpSync(join(scenarioRoot, "browser-entry.ts"), join(builtConsumer, "src/browser-entry.ts"));
  run("pnpm", ["install", "--offline", "--ignore-scripts"], builtConsumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], builtConsumer);

  const consumer = join(outputRoot, "consumer");
  cpSync(builtConsumer, consumer, { recursive: true });
  const installed = join(builtConsumer, "node_modules", packageName);
  const retainedPackage = join(consumer, "node_modules", packageName);
  rmSync(retainedPackage, { recursive: true, force: true });
  cpSync(installed, retainedPackage, { recursive: true, dereference: true });

  const site = join(outputRoot, "site");
  mkdirSync(join(site, "_fadeno/framework"), { recursive: true });
  cpSync(join(installed, "dist"), join(site, "_fadeno/framework"), { recursive: true });
  const entry = readFileSync(join(builtConsumer, "dist/browser-entry.js"), "utf8")
    .replace('from "@fadeno/framework/browser"', 'from "./framework/browser.js"');
  assert.equal(entry.includes(packageName), false);
  writeFileSync(join(site, "_fadeno/browser-entry.js"), entry);

  for (const name of ["success.json", "failure.json", "failure-human.txt", "correction.json", "flow.json", "recovery.json", "history-recovery.json", "terminal-flow.json", "security.json", "privacy.json", "teardown.json", "crud.json", "ordering.json", "ordering-human.txt", "native-crud.json", "duplicate.json", "duplicate-human.txt", "concurrency.json", "concurrency-human.txt", "close-recovery.json", "close-recovery-fallback.json", "close-recovery-fallback-human.txt", "staged-recovery.json", "handoff-edit-recovery.json", "handoff-edit-recovery-human.txt", "handoff-limit-refusal.json", "handoff-limit-refusal-human.txt", "formdata-routing-refusal.json", "formdata-routing-refusal-human.txt", "recovery-formdata-routing-refusal.json", "recovery-formdata-routing-refusal-human.txt", "post-dispatch-formdata.json", "post-dispatch-formdata-human.txt", "formdata-microtask-recovery.json", "formdata-microtask-recovery-human.txt", "redirect-recovery-outcome.json", "redirect-recovery-outcome-human.txt", "handoff-caret-recovery.json", "handoff-caret-recovery-human.txt", "pending-handoff.json", "pending-handoff-human.txt", "supersession-recovery.json", "supersession-recovery-human.txt", "native-supersession-recovery.json", "native-supersession-recovery-human.txt", "native-no-departure-recovery.json", "native-no-departure-recovery-webkit.json", "native-no-departure-recovery-human.txt", "native-form-fragment-recovery.json", "native-form-fragment-recovery-human.txt", "native-empty-fragment-form.json", "native-empty-fragment-form-human.txt", "submit-propagation-recovery.json", "submit-propagation-recovery-human.txt", "late-target-recovery.json", "late-target-recovery-human.txt", "recovery-supersession-continuity.json", "recovery-supersession-continuity-human.txt", "recovery-handoff-preservation.json", "recovery-handoff-preservation-human.txt", "persisted-reacquisition-recovery.json", "persisted-reacquisition-recovery-human.txt", "cancelled-fragment-push-recovery.json", "cancelled-fragment-push-recovery-human.txt", "fragment-rollback-traversal-failure.json", "fragment-rollback-traversal-failure-human.txt", "fragment-rollback-supersession.json", "fragment-rollback-supersession-human.txt", "fragment-rollback-selection-refusal.json", "fragment-rollback-selection-refusal-human.txt", "failed-fragment-push-recovery.json", "failed-fragment-push-recovery-human.txt", "file-handoff-recovery.json", "file-handoff-recovery-human.txt", "fragment-redirect.json", "fragment-redirect-human.txt", "fragment-redirect-history.json", "fragment-redirect-history-human.txt", "fragment-close-recovery-fallback.json", "fragment-close-recovery-fallback-human.txt", "fragment-redirect-chain.json", "fragment-redirect-chain-human.txt", "redirect-get-consumption.json", "redirect-get-consumption-human.txt", "traversal-recovery.json", "traversal-recovery-human.txt"]) {
    cpSync(join(scenarioRoot, "expected", name), join(outputRoot, `expected-${name}`));
  }
  for (const name of ["departure-observer-cleanup.json", "departure-observer-cleanup-human.txt", "handoff-option-wrapper.json", "handoff-option-wrapper-human.txt"]) {
    cpSync(join(scenarioRoot, "expected", name), join(outputRoot, `expected-${name}`));
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 form submission packed example prepared (public entrypoints, HTTPS actions, three-engine corpus)");
