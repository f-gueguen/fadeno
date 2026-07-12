import { spawnSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanModuleReferences } from "./lib/package-boundaries.ts";

const packageName = "fadeno-framework-internal";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleSource = join(root, "examples/adapter-smoke/src/index.ts");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_PUBLIC_PACKAGE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function expectFailure(command: string, arguments_: readonly string[], cwd: string, expected: string): void {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expected)) throw new Error(`FADENO_PUBLIC_PACKAGE_EXPECTED_FAILURE:${expected}\n${output}`);
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function assertSingleAdapterSource(): void {
  const sources = [join(root, "packages"), join(root, "prototypes")].flatMap((directory) => sourceFiles(directory));
  const adapters = sources.filter((path) => path.endsWith("/node-http.ts"));
  const capabilities = sources.filter((path) => path.endsWith("/node-http-capabilities.ts"));
  if (JSON.stringify(adapters) !== JSON.stringify([join(packageRoot, "src/internal/node-http.ts")])) {
    throw new Error(`FADENO_PUBLIC_PACKAGE_ADAPTER_DUPLICATION:${JSON.stringify(adapters)}`);
  }
  if (JSON.stringify(capabilities) !== JSON.stringify([join(packageRoot, "src/internal/node-http-capabilities.ts")])) {
    throw new Error(`FADENO_PUBLIC_PACKAGE_CAPABILITY_DUPLICATION:${JSON.stringify(capabilities)}`);
  }
}

function declarationTarget(path: string, specifier: string): string {
  const target = resolve(dirname(path), specifier);
  return path.endsWith(".d.ts") && target.endsWith(".js") ? `${target.slice(0, -3)}.d.ts` : target;
}

function assertNeutralClosure(installedPackage: string, entry: string): void {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    const entryContainment = relative(installedPackage, path);
    if (entryContainment.startsWith("..") || isAbsolute(entryContainment)) throw new Error(`FADENO_PUBLIC_PACKAGE_ROOT_ESCAPE:${path}`);
    visited.add(path);
    const source = readFileSync(path, "utf8");
    if (/\/\/\/\s*<reference\s+types=["']node["']/.test(source)) throw new Error(`FADENO_PUBLIC_PACKAGE_NODE_REFERENCE:${path}`);
    for (const reference of scanModuleReferences(source)) {
      if (builtins.has(reference.specifier) || reference.specifier.startsWith("node:")) {
        throw new Error(`FADENO_PUBLIC_PACKAGE_NODE_REACHABILITY:${path}:${reference.specifier}`);
      }
      if (!reference.specifier.startsWith(".")) throw new Error(`FADENO_PUBLIC_PACKAGE_EXTERNAL_REACHABILITY:${path}:${reference.specifier}`);
      const target = declarationTarget(path, reference.specifier);
      const containment = relative(installedPackage, target);
      if (containment.startsWith("..") || isAbsolute(containment) || !existsSync(target)) {
        throw new Error(`FADENO_PUBLIC_PACKAGE_ROOT_ESCAPE:${path}:${reference.specifier}`);
      }
      pending.push(target);
    }
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-public-package-"));
try {
  assertSingleAdapterSource();
  run("pnpm", ["--filter", packageName, "build"], root);

  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_PUBLIC_PACKAGE_TARBALL");
  const tarball = join(tarballs, tarballName);
  const entries = run("tar", ["-tzf", tarball], root).trim().split("\n").sort();
  const expectedEntries = [
    "package/LICENSE",
    "package/README.md",
    "package/dist/index.d.ts",
    "package/dist/index.js",
    "package/dist/jsx-runtime.d.ts",
    "package/dist/jsx-runtime.js",
    "package/dist/internal/analyzer-facets.d.ts",
    "package/dist/internal/analyzer-facets.js",
    "package/dist/internal/analyzer-diagnostics.d.ts",
    "package/dist/internal/analyzer-diagnostics.js",
    "package/dist/internal/analyzer-graph.d.ts",
    "package/dist/internal/analyzer-graph.js",
    "package/dist/internal/analyzer-publication.d.ts",
    "package/dist/internal/analyzer-publication.js",
    "package/dist/internal/analyzer-session.d.ts",
    "package/dist/internal/analyzer-session.js",
    "package/dist/internal/config.d.ts",
    "package/dist/internal/config.js",
    "package/dist/internal/diagnostic.d.ts",
    "package/dist/internal/diagnostic.js",
    "package/dist/internal/failure-observer.d.ts",
    "package/dist/internal/failure-observer.js",
    "package/dist/internal/node-http-capabilities.d.ts",
    "package/dist/internal/node-http-capabilities.js",
    "package/dist/internal/node-http.d.ts",
    "package/dist/internal/node-http.js",
    "package/dist/internal/routing/discovery.d.ts",
    "package/dist/internal/routing/discovery.js",
    "package/dist/internal/routing/generator.d.ts",
    "package/dist/internal/routing/generator.js",
    "package/dist/internal/routing/matcher.d.ts",
    "package/dist/internal/routing/matcher.js",
    "package/dist/internal/rendering-security.d.ts",
    "package/dist/internal/rendering-security.js",
    "package/dist/internal/render-node.d.ts",
    "package/dist/internal/render-node.js",
    "package/dist/internal/render-route.d.ts",
    "package/dist/internal/render-route.js",
    "package/dist/internal/renderer.d.ts",
    "package/dist/internal/renderer.js",
    "package/dist/internal/streaming-lifecycle.d.ts",
    "package/dist/internal/streaming-lifecycle.js",
    "package/dist/internal/unsafe-html.d.ts",
    "package/dist/internal/unsafe-html.js",
    "package/dist/node.d.ts",
    "package/dist/node.js",
    "package/package.json",
  ].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`FADENO_PUBLIC_PACKAGE_CONTENTS:${JSON.stringify(entries)}`);
  }

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeJson(join(consumer, "package.json"), {
    name: "fadeno-public-package-clean-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${tarball}` },
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
  const copiedExample = join(consumer, "src/index.ts");
  cpSync(exampleSource, copiedExample);
  if (!readFileSync(exampleSource).equals(readFileSync(copiedExample))) throw new Error("FADENO_PUBLIC_PACKAGE_EXAMPLE_COPY");
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);

  const installedPackage = join(consumer, "node_modules", packageName);
  const manifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8")) as {
    name?: string;
    private?: boolean;
    publishConfig?: unknown;
    version?: string;
    exports?: Record<string, { import?: string; types?: string }>;
  };
  const expectedExports = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
    "./jsx-runtime": { types: "./dist/jsx-runtime.d.ts", import: "./dist/jsx-runtime.js" },
  };
  if (
    manifest.name !== packageName || manifest.version !== "0.0.0-private" || manifest.private !== true ||
    manifest.publishConfig !== undefined || JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)
  ) {
    throw new Error("FADENO_PUBLIC_PACKAGE_MANIFEST");
  }
  for (const subpath of [".", "./node", "./jsx-runtime"]) {
    const target = manifest.exports?.[subpath];
    const importTarget = resolve(installedPackage, target?.import ?? "../missing");
    const typesTarget = resolve(installedPackage, target?.types ?? "../missing");
    const importContainment = relative(installedPackage, importTarget);
    const typesContainment = relative(installedPackage, typesTarget);
    if (
      !target?.import || !target.types || importContainment.startsWith("..") || isAbsolute(importContainment) ||
      typesContainment.startsWith("..") || isAbsolute(typesContainment) || !existsSync(importTarget) || !existsSync(typesTarget)
    ) {
      throw new Error(`FADENO_PUBLIC_PACKAGE_EXPORT_TARGET:${subpath}`);
    }
  }
  if (manifest.exports?.["."]?.import === manifest.exports?.["./node"]?.import) throw new Error("FADENO_PUBLIC_PACKAGE_ROOT_IS_NODE");
  assertNeutralClosure(installedPackage, join(installedPackage, manifest.exports?.["."]?.import ?? ""));
  assertNeutralClosure(installedPackage, join(installedPackage, manifest.exports?.["."]?.types ?? ""));
  assertNeutralClosure(installedPackage, join(installedPackage, manifest.exports?.["./jsx-runtime"]?.import ?? ""));
  assertNeutralClosure(installedPackage, join(installedPackage, manifest.exports?.["./jsx-runtime"]?.types ?? ""));
  const rootDeclaration = readFileSync(join(installedPackage, manifest.exports?.["."]?.types ?? ""), "utf8");
  if (rootDeclaration.includes("/accounts/") || rootDeclaration.includes("fadeno:routes") || scanModuleReferences(rootDeclaration).some((reference) => reference.specifier.includes("/internal/"))) {
    throw new Error("FADENO_PUBLIC_PACKAGE_ROOT_ROUTE_LEAK");
  }
  const nodeDeclaration = readFileSync(join(installedPackage, manifest.exports?.["./node"]?.types ?? ""), "utf8");
  if (scanModuleReferences(nodeDeclaration).some((reference) => reference.specifier.includes("/internal/"))) {
    throw new Error("FADENO_PUBLIC_PACKAGE_NODE_DECLARATION_LEAK");
  }

  writeFileSync(join(consumer, "root-only.ts"), `import { Boundary, defineConfig, notFound, redirect, renderRoute, unsafeHtml, type Handler, type RenderNode, type UnsafeHtml } from "${packageName}";\ndeclare const handler: Handler;\ndeclare const node: RenderNode;\nconst raw: UnsafeHtml = unsafeHtml("<strong>reviewed</strong>", { reason: "Reviewed static markup" });\nBoundary({ children: node, fallback: "fallback" });\nvoid notFound();\nvoid redirect("/next");\nvoid renderRoute;\ndefineConfig({});\ndefineConfig({ routes: { root: "src/routes" } });\n// @ts-expect-error ordinary strings are not unsafe capabilities\nconst forged: UnsafeHtml = "<script>bad()</script>";\n// @ts-expect-error unknown top-level config field\ndefineConfig({ unknown: true });\nconst invalid = { routes: { root: "src/routes", extra: true } } as const;\n// @ts-expect-error unknown nested route config field\ndefineConfig(invalid);\nvoid handler;\nvoid raw;\nvoid forged;\n`);
  run(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--lib", "ES2022,DOM", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "", "root-only.ts"], consumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
  const runtime = run(process.execPath, ["dist/index.js"], consumer);
  if (!runtime.includes("Fadeno public adapter smoke passed")) throw new Error("FADENO_PUBLIC_PACKAGE_EXAMPLE_RUNTIME");

  const internalJs = join(installedPackage, "dist/internal/node-http.js");
  const internalTypes = join(installedPackage, "dist/internal/node-http.d.ts");
  if (!existsSync(internalJs) || !existsSync(internalTypes)) throw new Error("FADENO_PUBLIC_PACKAGE_INTERNAL_ABSENT");
  writeFileSync(join(consumer, "deep-import.ts"), `import { listenNodeHttp } from "${packageName}/internal/node-http";\nvoid listenNodeHttp;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/node-http")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  const routingJs = join(installedPackage, "dist/internal/routing/generator.js");
  const routingTypes = join(installedPackage, "dist/internal/routing/generator.d.ts");
  if (!existsSync(routingJs) || !existsSync(routingTypes)) throw new Error("FADENO_PUBLIC_PACKAGE_ROUTING_INTERNAL_ABSENT");
  writeFileSync(join(consumer, "routing-deep-import.ts"), `import { generateRoutes } from "${packageName}/internal/routing/generator";\nvoid generateRoutes;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "routing-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/routing/generator")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  const analyzerJs = join(installedPackage, "dist/internal/analyzer-session.js");
  const analyzerTypes = join(installedPackage, "dist/internal/analyzer-session.d.ts");
  if (!existsSync(analyzerJs) || !existsSync(analyzerTypes)) throw new Error("FADENO_PUBLIC_PACKAGE_ANALYZER_INTERNAL_ABSENT");
  writeFileSync(join(consumer, "analyzer-deep-import.ts"), `import { AnalyzerSession } from "${packageName}/internal/analyzer-session";\nvoid AnalyzerSession;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "analyzer-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/analyzer-session")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  writeFileSync(join(consumer, "analyzer-facets-deep-import.ts"), `import { serializeAnalyzerFacetSnapshot } from "${packageName}/internal/analyzer-facets";\nvoid serializeAnalyzerFacetSnapshot;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "analyzer-facets-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/analyzer-facets")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  const analyzerDiagnosticsJs = join(installedPackage, "dist/internal/analyzer-diagnostics.js");
  const analyzerDiagnosticsTypes = join(installedPackage, "dist/internal/analyzer-diagnostics.d.ts");
  if (!existsSync(analyzerDiagnosticsJs) || !existsSync(analyzerDiagnosticsTypes)) throw new Error("FADENO_PUBLIC_PACKAGE_ANALYZER_DIAGNOSTICS_INTERNAL_ABSENT");
  writeFileSync(join(consumer, "analyzer-diagnostics-deep-import.ts"), `import { createAnalyzerDiagnosticBatch } from "${packageName}/internal/analyzer-diagnostics";\nvoid createAnalyzerDiagnosticBatch;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "analyzer-diagnostics-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/analyzer-diagnostics")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  writeFileSync(join(consumer, "analyzer-graph-deep-import.ts"), `import { AnalyzerDependencyGraph } from "${packageName}/internal/analyzer-graph";\nvoid AnalyzerDependencyGraph;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "analyzer-graph-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/analyzer-graph")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  writeFileSync(join(consumer, "analyzer-publication-deep-import.ts"), `import { AnalyzerPublicationCoordinator } from "${packageName}/internal/analyzer-publication";\nvoid AnalyzerPublicationCoordinator;\n`);
  expectFailure(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "analyzer-publication-deep-import.ts"], consumer, "TS2307");
  expectFailure(process.execPath, ["--input-type=module", "--eval", `await import("${packageName}/internal/analyzer-publication")`], consumer, "ERR_PACKAGE_PATH_NOT_EXPORTED");
} finally {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 public package passed (exact tarball, neutral root, clean tracked consumer, private internals)");
