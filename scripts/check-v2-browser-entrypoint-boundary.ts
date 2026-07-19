import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scanModuleReferences } from "./lib/package-boundaries.ts";
import {
  loadV2BrowserEntrypointBoundaryContext,
  validateV2BrowserEntrypointBoundary,
  V2_BROWSER_ENTRYPOINT_EXISTING_SUBPATHS,
  V2_BROWSER_ENTRYPOINT_SUBPATH,
} from "./lib/v2-browser-entrypoint-boundary.ts";

const sentinelPackageName = "fadeno-private-browser-boundary-sentinel";
const root = fileURLToPath(new URL("../", import.meta.url));
const prototypeRoot = join(root, "prototypes/v2/browser-entrypoint");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_V2_BROWSER_BOUNDARY_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function expectFailure(command: string, arguments_: readonly string[], cwd: string, expected: string): void {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expected)) {
    throw new Error(`FADENO_V2_BROWSER_BOUNDARY_EXPECTED_FAILURE:${expected}\n${output}`);
  }
}

const tracked = new Set(run("git", ["ls-files", "--cached"], root).trim().split("\n"));
const modelErrors = validateV2BrowserEntrypointBoundary(loadV2BrowserEntrypointBoundaryContext(root, tracked));
if (modelErrors.length > 0) throw new Error(`V2 browser-entrypoint model refused:\n${modelErrors.join("\n")}`);

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-browser-boundary-"));
try {
  const packageRoot = join(temporaryRoot, "package");
  const sourceRoot = join(packageRoot, "src");
  const internalRoot = join(sourceRoot, "internal");
  mkdirSync(internalRoot, { recursive: true });
  for (const file of ["root.ts", "node.ts", "jsx-runtime.ts", "browser.ts"]) cpSync(join(prototypeRoot, file), join(sourceRoot, file));
  cpSync(join(prototypeRoot, "internal-browser-canary.ts"), join(internalRoot, "browser-canary.ts"));
  writeJson(join(packageRoot, "package.json"), {
    name: sentinelPackageName,
    version: "0.0.0-private",
    private: true,
    type: "module",
    sideEffects: false,
    exports: {
      ".": { types: "./dist/root.d.ts", import: "./dist/root.js" },
      "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
      "./jsx-runtime": { types: "./dist/jsx-runtime.d.ts", import: "./dist/jsx-runtime.js" },
      "./browser": { types: "./dist/browser.d.ts", import: "./dist/browser.js" },
    },
    files: ["dist"],
  });
  writeJson(join(packageRoot, "tsconfig.json"), {
    compilerOptions: {
      declaration: true,
      exactOptionalPropertyTypes: true,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noUncheckedIndexedAccess: true,
      outDir: "dist",
      rewriteRelativeImportExtensions: true,
      rootDir: "src",
      strict: true,
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  });
  run(process.execPath, [tsc, "-p", "tsconfig.json"], packageRoot);

  const packageDocument = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, unknown> };
  assert.deepEqual(Object.keys(packageDocument.exports).sort(), [...V2_BROWSER_ENTRYPOINT_EXISTING_SUBPATHS, V2_BROWSER_ENTRYPOINT_SUBPATH].sort());
  for (const file of ["root.js", "root.d.ts", "node.js", "node.d.ts", "jsx-runtime.js", "jsx-runtime.d.ts"]) {
    const output = readFileSync(join(packageRoot, "dist", file), "utf8");
    assert.equal(scanModuleReferences(output).some(({ specifier }) => specifier.includes("browser")), false, `${file} reaches browser`);
  }
  const browserOutput = ["browser.js", "browser.d.ts"].map((file) => readFileSync(join(packageRoot, "dist", file), "utf8")).join("\n");
  assert.equal(scanModuleReferences(browserOutput).length, 0);
  assert.equal(/(?:node:|@types\/node|internal\/browser-canary)/u.test(browserOutput), false);

  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_V2_BROWSER_BOUNDARY_TARBALL");
  const tarball = join(tarballs, tarballName);

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeJson(join(consumer, "package.json"), {
    name: "private-browser-boundary-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [sentinelPackageName]: `file:${tarball}` },
  });
  writeJson(join(consumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM"],
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
  writeFileSync(join(consumer, "src/index.ts"), [
    `import ${JSON.stringify(`${sentinelPackageName}/browser`)};`,
    `import type { BrowserBoundaryNeutralMarker } from ${JSON.stringify(sentinelPackageName)};`,
    'const marker: BrowserBoundaryNeutralMarker = { kind: "neutral" };',
    'if (marker.kind !== "neutral") throw new Error("browser boundary consumer marker differs");',
    'console.log("disposable browser entrypoint consumer passed");',
  ].join("\n"));
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
  assert.match(run(process.execPath, ["dist/index.js"], consumer), /disposable browser entrypoint consumer passed/u);

  const installedCanary = join(consumer, "node_modules", sentinelPackageName, "dist/internal/browser-canary.js");
  assert.equal(existsSync(installedCanary), true, "browser-private canary must be present before export refusal is meaningful");
  writeFileSync(join(consumer, "deep-import.ts"), `import { internalBrowserCanary } from ${JSON.stringify(`${sentinelPackageName}/internal/browser-canary`)};\nvoid internalBrowserCanary;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(`${sentinelPackageName}/internal/browser-canary`)})`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

assert.equal(existsSync(temporaryRoot), false);
console.log("V2 browser-entrypoint boundary passed (one logical package, exact ./browser proof, isolated graph, deep-import refusal)");
