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
const scenarioRoot = join(root, "examples/v1-app/scenarios/link-navigation");
const outputRoot = join(root, "output/v2-link-navigation");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_V2_LINK_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const adr = readFileSync(join(root, "docs/adr/0049-conservative-enhanced-link-navigation.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "before calling `preventDefault()`",
  "checked again after response admission and before commit",
  "fresh opaque server owner",
  "existing handler",
  "No markup or protocol type becomes a public export",
  "V2-05 can broaden history",
]) assert.equal(adr.includes(fragment), true, `ADR 0049 is missing ${fragment}`);

const packageDocument = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, unknown> };
assert.deepEqual(Object.keys(packageDocument.exports).sort(), [".", "./browser", "./jsx-runtime", "./node"]);
assert.equal(
  readFileSync(join(root, ".changeset/conservative-link-navigation.md"), "utf8"),
  '---\n"@fadeno/framework": minor\n---\n\nEnhance eligible same-origin links with cancellable server-owned document\nupdates while retaining native navigation for every unsafe boundary.\n',
);
const scope = readFileSync(join(root, "docs/product/scope.md"), "utf8");
const traceability = readFileSync(join(root, "docs/traceability.md"), "utf8");
for (const feature of ["STATE-01", "SEC-01", "TEST-01", "ENH-01", "PATCH-01", "DOC-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0049"), true, `${feature} scope is missing ADR 0049`);
  assert.equal(traceabilityRow.includes("ADR 0049") && traceabilityRow.includes("check:v2-link-navigation"), true, `${feature} traceability is missing V2-04 evidence`);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-link-navigation-"));
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("FADENO_V2_LINK_TARBALL");

  rmSync(outputRoot, { recursive: true, force: true });
  const builtConsumer = join(temporaryRoot, "consumer");
  mkdirSync(join(builtConsumer, "src"), { recursive: true });
  writeJson(join(builtConsumer, "package.json"), {
    name: "fadeno-v2-link-navigation-consumer",
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

  const site = join(outputRoot, "site");
  mkdirSync(join(site, "_fadeno/framework"), { recursive: true });
  const installed = join(builtConsumer, "node_modules", packageName);
  const retainedPackage = join(consumer, "node_modules", packageName);
  rmSync(retainedPackage, { recursive: true, force: true });
  cpSync(installed, retainedPackage, { recursive: true, dereference: true });
  cpSync(join(installed, "dist"), join(site, "_fadeno/framework"), { recursive: true });
  const entry = readFileSync(join(builtConsumer, "dist/browser-entry.js"), "utf8")
    .replace('from "@fadeno/framework/browser"', 'from "./framework/browser.js"');
  assert.equal(entry.includes(packageName), false);
  writeFileSync(join(site, "_fadeno/browser-entry.js"), entry);

  for (const name of [
    "success.json",
    "refusal.json",
    "refusal-human.txt",
    "flow.json",
    "recovery.json",
    "history-focus.json",
    "history-focus-normal.json",
    "history-environment-refusal.json",
    "history-teardown.json",
    "history-startup-recovery.json",
    "history-wrapper-installation-refusal.json",
    "history-startup-state-rekey.json",
    "history-post-close-restart-rekey.json",
    "history-native-departure.json",
    "history-scroll-refusal.json",
    "history-monotonic-scroll-recovery.json",
    "history-entry-recovery-resumption.json",
    "history-write-recovery.json",
    "history-overflow-recovery.json",
    "history-element-recovery.json",
    "history-element-link-refusal.json",
    "history-combined-scroll-refusal.json",
    "history-pending-element-scroll-refusal.json",
    "history-pending-scroll-recovery.json",
    "history-traversal-scroll-recovery.json",
    "history-close-traversal-recovery.json",
    "history-close-cancelled-traversal-recovery.json",
    "history-close-pending-navigation.json",
    "history-late-scroll-recovery.json",
    "history-selected-state-recovery.json",
    "history-source-state-recovery.json",
    "history-cloned-entry-recovery.json",
    "history-same-url-copy-refusal.json",
    "history-repeated-reload-rekey.json",
    "history-long-url-recovery.json",
    "history-commit-failure-recovery.json",
    "history-focus-state-recovery.json",
    "history-multiple-push-recovery.json",
    "history-native-supersession-recovery.json",
    "history-scroll-rollback-recovery.json",
    "history-scroll-postcondition-recovery.json",
    "history-cancelled-reload-recovery.json",
    "history-cancelled-fallback-recovery.json",
    "history-cancelled-preselection-recovery.json",
    "history-return-value-reload-recovery.json",
    "history-click-supersession-recovery.json",
    "history-delayed-recovery-supersession.json",
    "history-fragment-supersession-recovery.json",
    "history-ordinary-native-supersession.json",
    "history-form-supersession-recovery.json",
    "history-recovery.json",
    "history-refusal-human.txt",
  ]) {
    cpSync(join(scenarioRoot, "expected", name), join(outputRoot, `expected-${name}`));
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 link navigation packed example prepared (public entrypoints, private transport, three-engine corpus)");
