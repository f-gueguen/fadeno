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

  for (const name of ["success.json", "refusal.json", "refusal-human.txt", "flow.json", "recovery.json"]) {
    cpSync(join(scenarioRoot, "expected", name), join(outputRoot, `expected-${name}`));
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 link navigation packed example prepared (public entrypoints, private transport, three-engine corpus)");
