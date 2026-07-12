import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sentinelPackageName = "fadeno-private-boundary-sentinel";
const root = fileURLToPath(new URL("../", import.meta.url));
const prototypeRoot = join(root, "prototypes/v1/package-boundary");
const adapterRoot = join(root, "prototypes/v1/adapter");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_PACKAGE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function expectFailure(command: string, arguments_: readonly string[], cwd: string, expected: string): void {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expected)) {
    throw new Error(`FADENO_PACKAGE_EXPECTED_FAILURE:${expected}\n${output}`);
  }
}

function assertSentinelIsPrivate(): void {
  for (const directory of ["docs", "examples"]) {
    const pending = [join(root, directory)];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && readFileSync(path, "utf8").includes(sentinelPackageName)) {
          throw new Error(`FADENO_PACKAGE_SENTINEL_LEAK:${path}`);
        }
      }
    }
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-package-"));
try {
  assertSentinelIsPrivate();
  const neutral = join(temporaryRoot, "neutral");
  mkdirSync(neutral, { recursive: true });
  writeJson(join(neutral, "tsconfig.json"), {
    compilerOptions: {
      declaration: true,
      lib: ["ES2022", "DOM"],
      module: "ESNext",
      moduleResolution: "Bundler",
      outDir: "dist",
      rootDir: prototypeRoot,
      strict: true,
      types: [],
    },
    files: [join(prototypeRoot, "prototype-root.ts")],
  });
  run(process.execPath, [tsc, "-p", "tsconfig.json"], neutral);
  const neutralOutput = ["dist/prototype-root.js", "dist/prototype-root.d.ts"]
    .map((path) => readFileSync(join(neutral, path), "utf8"))
    .join("\n");
  if (/\bnode:/.test(neutralOutput)) throw new Error("FADENO_PACKAGE_NEUTRAL_NODE_REACHABILITY");

  const packageRoot = join(temporaryRoot, "package");
  const sourceRoot = join(packageRoot, "src");
  const internalRoot = join(sourceRoot, "internal");
  mkdirSync(internalRoot, { recursive: true });
  cpSync(join(prototypeRoot, "prototype-root.ts"), join(sourceRoot, "index.ts"));
  cpSync(join(prototypeRoot, "internal-canary.ts"), join(internalRoot, "canary.ts"));
  cpSync(join(adapterRoot, "capabilities.ts"), join(internalRoot, "capabilities.ts"));
  cpSync(join(adapterRoot, "node-http.ts"), join(internalRoot, "node-http.ts"));
  writeFileSync(join(sourceRoot, "node.ts"), 'export { listenNodeHttpAdapter as prototypeListen } from "./internal/node-http.ts";\n');
  writeJson(join(packageRoot, "package.json"), {
    name: sentinelPackageName,
    version: "0.0.0-private",
    private: true,
    type: "module",
    engines: { node: ">=22.17.0" },
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
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
      typeRoots: [join(root, "node_modules/@types")],
      types: ["node"],
    },
    include: ["src/**/*.ts"],
  });
  run(process.execPath, [tsc, "-p", "tsconfig.json"], packageRoot);

  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_PACKAGE_TARBALL");
  const tarball = join(tarballs, tarballName);

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeJson(join(consumer, "package.json"), {
    name: "private-clean-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [sentinelPackageName]: `file:${tarball}` },
    devDependencies: { "@types/node": "22.20.1" },
  });
  writeJson(join(consumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: ["node"],
    },
    include: ["src/**/*.ts"],
  });
  writeFileSync(join(consumer, "src/index.ts"), [
    `import type { PrototypeWebHandler } from "${sentinelPackageName}";`,
    `import { prototypeListen } from "${sentinelPackageName}/node";`,
    "const handler: PrototypeWebHandler = (request) => new Response(new URL(request.url).pathname);",
    "const adapter = await prototypeListen({ handler });",
    "try {",
    "  const response = await fetch(`${adapter.origin}/package-smoke`);",
    "  if (response.status !== 200 || await response.text() !== '/package-smoke') throw new Error('consumer response differs');",
    "} finally { await adapter.close(); }",
    "console.log('packed consumer passed');",
  ].join("\n"));
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
  const runtimeOutput = run(process.execPath, ["dist/index.js"], consumer);
  if (!runtimeOutput.includes("packed consumer passed")) throw new Error("FADENO_PACKAGE_CONSUMER_RUNTIME");

  const installedInternal = join(consumer, "node_modules", sentinelPackageName, "dist/internal/canary.js");
  if (!existsSync(installedInternal)) throw new Error("FADENO_PACKAGE_INTERNAL_CANARY_ABSENT");
  writeFileSync(join(consumer, "deep-import.ts"), `import { internalCanary } from "${sentinelPackageName}/internal/canary";\nvoid internalCanary;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${sentinelPackageName}/internal/canary")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 package consumer passed (neutral root, packed install, Node subpath, deep-import refusal)");
