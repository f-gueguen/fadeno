import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import type { FadenoConfig } from "../../index.ts";
import { FadenoDiagnosticError } from "../diagnostic.ts";
import { ROUTE_ARTIFACT_NAMES, type RouteArtifactName } from "./artifact-contract.ts";
import {
  assertRouteManifestSemantics,
  discoverRouteManifestWithSources,
  stableRouteManifest,
  type RouteManifest,
  type RouteSegment,
} from "./discovery.ts";

const GENERATOR_VERSION = 1;
export type { RouteArtifactName } from "./artifact-contract.ts";
export type RouteArtifactPlan = Readonly<{
  manifest: RouteManifest;
  sourceSha256: string;
  sources: Readonly<Record<string, string>>;
  files: Readonly<Record<RouteArtifactName, string>>;
}>;

export type RouteGenerationResult = Readonly<{
  changed: boolean;
  output: string;
  sourceSha256: string;
}>;

export type RouteArtifactApplicationTransaction = Readonly<{
  readonly result: RouteGenerationResult;
  readonly state: "pending" | "committed" | "rolled-back";
  readonly cleanupPending: boolean;
  assertPending(): void;
  commit(): RouteGenerationResult;
  rollback(): void;
  cleanup(): void;
}>;

export type RouteArtifactMutationFileSystem = Readonly<{
  mkdir(path: string): void;
  writeFile(path: string, bytes: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
}>;

export type RouteArtifactApplicationPhase =
  | "after-stage"
  | "after-backup"
  | "after-replace"
  | "before-cleanup";

export type RouteArtifactApplicationOptions = Readonly<{
  assertFresh(): void;
  fileSystem?: RouteArtifactMutationFileSystem;
  afterWrite?(name: RouteArtifactName): void;
  observe?(phase: RouteArtifactApplicationPhase): void;
  retainRecovery?(recover: () => void): void;
  retainTransaction?(transaction: RouteArtifactApplicationTransaction): void;
}>;

const nodeMutationFileSystem: RouteArtifactMutationFileSystem = Object.freeze({
  mkdir: (path) => mkdirSync(path),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  rename: (from, to) => renameSync(from, to),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
});

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string): never {
  throw new FadenoDiagnosticError(
    `FADENO_GENERATION_${code}`,
    `Route generation violation: ${code.toLowerCase().replaceAll("_", " ")}`,
    [".fadeno/routes"],
    `https://fadeno.dev/diagnostics/generation/${code.toLowerCase().replaceAll("_", "-")}`,
    "Correct the route source or generated-output ownership issue and run fadeno check again.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseManifest(bytes: string): RouteManifest {
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { fail("OUTPUT_MANIFEST"); }
  if (!isPlainRecord(value) || !isPlainRecord(value["generation"]) || !Array.isArray(value["routes"])) fail("OUTPUT_MANIFEST");
  try { assertRouteManifestSemantics(value as RouteManifest); } catch (error) {
    if (error instanceof FadenoDiagnosticError) throw error;
    fail("OUTPUT_MANIFEST");
  }
  return value as RouteManifest;
}

function assertRouteArtifactDirectoryShape(output: string): void {
  if (!existsSync(output) || lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) {
    fail("TRANSACTION_CHANGED");
  }
  const names = readdirSync(output).sort(compareText);
  if (names.length !== ROUTE_ARTIFACT_NAMES.length || names.some((name, index) => name !== [...ROUTE_ARTIFACT_NAMES].sort(compareText)[index])) {
    fail("TRANSACTION_CHANGED");
  }
  for (const name of ROUTE_ARTIFACT_NAMES) {
    const path = join(output, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) fail("TRANSACTION_CHANGED");
  }
}

function assertExactOwnedOutput(output: string, expected: Readonly<Record<string, string>>): void {
  assertRouteArtifactDirectoryShape(output);
  assertOwnedOutput(output);
  for (const name of ROUTE_ARTIFACT_NAMES) {
    if (readFileSync(join(output, name), "utf8") !== expected[name]) fail("TRANSACTION_CHANGED");
  }
}

function assertEmptyMarker(path: string): void {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || readdirSync(path).length > 0) {
    fail("TRANSACTION_CHANGED");
  }
}

function renderRuntime(manifest: RouteManifest): string {
  const definitions = Object.fromEntries(manifest.routes.map(({ id, segments }) => [id, segments]));
  return [
    `// Generated by Fadeno routes v${GENERATOR_VERSION}; source ${manifest.generation.sourceSha256}.`,
    "// Do not edit. Import through the canonical fadeno:routes virtual module.",
    `const definitions = Object.freeze(${JSON.stringify(definitions)});`,
    "function refuse(code) { throw new TypeError(`FADENO_ROUTE_LINK_${code}`); }",
    "function plain(value) { if (typeof value !== 'object' || value === null || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }",
    "function encode(value) { if (typeof value !== 'string' || value === '' || value === '.' || value === '..') refuse('PARAMETER'); try { return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.codePointAt(0).toString(16).toUpperCase()}`); } catch { refuse('PARAMETER'); } }",
    "export function routeHref(input) {",
    "  if (!plain(input) || typeof input.route !== 'string') refuse('INPUT');",
    "  if (!Object.hasOwn(definitions, input.route)) refuse('ROUTE');",
    "  const segments = definitions[input.route];",
    "  const expected = segments.filter((segment) => segment.kind !== 'static').map((segment) => segment.name);",
    "  const keys = Object.keys(input).sort();",
    "  if (keys.join('\\0') !== (expected.length === 0 ? 'route' : 'parameters\\0route')) refuse('INPUT');",
    "  const parameters = input.parameters;",
    "  if (expected.length > 0 && (!plain(parameters) || Object.keys(parameters).sort().join('\\0') !== [...expected].sort().join('\\0'))) refuse('PARAMETERS');",
    "  const output = [];",
    "  for (const segment of segments) {",
    "    if (segment.kind === 'static') output.push(segment.value);",
    "    else if (segment.kind === 'parameter') output.push(encode(parameters[segment.name]));",
    "    else {",
    "      const values = parameters[segment.name];",
    "      if (!Array.isArray(values) || values.length === 0 || Object.keys(values).length !== values.length) refuse('PARAMETER');",
    "      for (let index = 0; index < values.length; index += 1) { if (!Object.hasOwn(values, index)) refuse('PARAMETER'); output.push(encode(values[index])); }",
    "    }",
    "  }",
    "  return output.length === 0 ? '/' : `/${output.join('/')}`;",
    "}",
    "",
  ].join("\n");
}

function parameterType(segment: RouteSegment): string {
  return segment.kind === "rest" ? "readonly [string, ...string[]]" : "string";
}

function renderDeclaration(manifest: RouteManifest): string {
  const parameterCases = manifest.routes.map(({ id, segments }) => {
    const parameters = segments.filter((segment) => segment.kind !== "static");
    const value = parameters.length === 0
      ? "never"
      : `{ ${parameters.map((segment) => `readonly ${JSON.stringify(segment.name)}: ${parameterType(segment)}`).join("; ")} }`;
    return `    Id extends ${JSON.stringify(id)} ? ${value} :`;
  });
  const routeIds = manifest.routes.map(({ id }) => JSON.stringify(id)).join(" | ") || "never";
  return [
    `// Generated by Fadeno routes v${GENERATOR_VERSION}; source ${manifest.generation.sourceSha256}.`,
    "// Do not edit.",
    "declare module \"fadeno:routes\" {",
    `  export type RouteId = ${routeIds};`,
    "  export type RouteParameters<Id extends RouteId> =",
    ...parameterCases,
    "    never;",
    "  export type RouteHrefInput<Id extends RouteId = RouteId> = {",
    "    readonly [Current in Id]: RouteParameters<Current> extends never",
    "      ? { readonly route: Current }",
    "      : { readonly route: Current; readonly parameters: RouteParameters<Current> };",
    "  }[Id];",
    "  export function routeHref<const Input extends RouteHrefInput>(",
    "    input: Input extends { readonly route: infer Id extends RouteId }",
    "    ? RouteParameters<Id> extends never",
    "      ? Input & Record<Exclude<keyof Input, \"route\">, never>",
    "      : Input extends { readonly parameters: infer Parameters extends RouteParameters<Id> }",
    "        ? Input & Record<Exclude<keyof Input, \"route\" | \"parameters\">, never> & {",
    "            readonly parameters: Parameters & Record<Exclude<keyof Parameters, keyof RouteParameters<Id>>, never>;",
    "          }",
    "        : never",
    "    : never",
    "  ): string;",
    "}",
    "",
  ].join("\n");
}

function renderApplication(manifest: RouteManifest): string {
  const sources = [...new Set(manifest.routes.flatMap((route) => [
    route.source,
    ...route.layouts,
    ...(route.notFound ? [route.notFound] : []),
    ...(route.error ? [route.error] : []),
  ]))].sort(compareText);
  const bindings = new Map(sources.map((source, index) => [source, `module${index}`]));
  const definitions = manifest.routes.map(({ id, segments }) => ({ id, segments }));
  const cases = manifest.routes.map((route) => {
    const source = bindings.get(route.source);
    if (!source) throw new TypeError("FADENO_GENERATION_APPLICATION_SOURCE");
    if (route.kind === "handler") return `    case ${JSON.stringify(route.id)}: return ${source}(request);`;
    const layouts = route.layouts.map((path) => bindings.get(path)).join(", ");
    const notFound = route.notFound ? bindings.get(route.notFound) : undefined;
    const error = route.error ? bindings.get(route.error) : undefined;
    return `    case ${JSON.stringify(route.id)}: return renderRoute({ request, routeId: selected.id, generation: applicationGeneration, parameters: selected.parameters, page: ${source}, layouts: [${layouts}], notFound: ${notFound ?? "undefined"}, error: ${error ?? "undefined"} });`;
  });
  const ownerDepth = (source: string, role: string): number => {
    const prefix = `${manifest.root}/`;
    const suffix = `/${role}`;
    if (!source.startsWith(prefix) || !source.endsWith(suffix)) throw new TypeError("FADENO_GENERATION_APPLICATION_OWNER");
    const directory = source.slice(prefix.length, -suffix.length);
    return directory === "" ? 0 : directory.split("/").length;
  };
  const fallbackBySource = new Map<string, RouteManifest["routes"][number]>();
  for (const route of manifest.routes) {
    if (route.notFound && !fallbackBySource.has(route.notFound)) fallbackBySource.set(route.notFound, route);
  }
  const fallbacks = [...fallbackBySource].map(([source, route], index) => {
    const depth = ownerDepth(source, "not-found.tsx");
    const layouts = route.layouts.filter((path) => ownerDepth(path, "layout.tsx") <= depth);
    const error = route.error && ownerDepth(route.error, "error.tsx") <= depth ? route.error : null;
    return { id: `fallback${index}`, segments: route.segments.slice(0, depth), source, layouts, error };
  }).sort((left, right) => right.segments.length - left.segments.length || compareText(left.source, right.source));
  const fallbackDefinitions = fallbacks.map(({ id, segments }) => ({ id, segments }));
  const fallbackCases = fallbacks.map((fallback) =>
    `    case ${JSON.stringify(fallback.id)}: return renderRoute({ request, routeId: selectedFallback.id, generation: applicationGeneration, parameters: selectedFallback.parameters, page: () => notFound(), layouts: [${fallback.layouts.map((path) => bindings.get(path)).join(", ")}], notFound: ${bindings.get(fallback.source)}, error: ${fallback.error ? bindings.get(fallback.error) : "undefined"} });`);
  return [
    `// Generated by Fadeno application v${GENERATOR_VERSION}; source ${manifest.generation.sourceSha256}.`,
    "// Do not edit. This binding is correlated with manifest.json.",
    'import { notFound, renderRoute, type Handler } from "fadeno-framework-internal";',
    ...sources.map((source) => `import ${bindings.get(source)} from ${JSON.stringify(`../../${source}`)};`),
    "",
    `export const applicationGeneration = ${JSON.stringify(manifest.generation.sourceSha256)};`,
    "type Segment = Readonly<{ kind: 'static'; value: string }> | Readonly<{ kind: 'parameter' | 'rest'; name: string }> ;",
    `const definitions: readonly Readonly<{ id: string; segments: readonly Segment[] }>[] = Object.freeze(${JSON.stringify(definitions)});`,
    `const fallbackDefinitions: readonly Readonly<{ id: string; segments: readonly Segment[] }>[] = Object.freeze(${JSON.stringify(fallbackDefinitions)});`,
    "function decode(value: string): string | undefined {",
    "  if ([...value].some((character) => { const point = character.codePointAt(0)!; return point < 0x21 || point > 0x7e || '\\\\/?#'.includes(character); })) return undefined;",
    "  try { const result = decodeURIComponent(value); return result === '' || result === '.' || result === '..' ? undefined : result; } catch { return undefined; }",
    "}",
    "function match(pathname: string): { id: string; parameters: Readonly<Record<string, string | readonly string[]>> } | undefined {",
    "  if (pathname !== '/' && (!pathname.startsWith('/') || pathname.endsWith('/') || pathname.includes('//'))) return undefined;",
    "  const encoded = pathname === '/' ? [] : pathname.slice(1).split('/'); const decoded: string[] = [];",
    "  for (const part of encoded) { const value = decode(part); if (value === undefined) return undefined; decoded.push(value); }",
    "  let selected: { id: string; parameters: Readonly<Record<string, string | readonly string[]>>; rank: readonly number[] } | undefined;",
    "  for (const definition of definitions) { const parameters = Object.create(null) as Record<string, string | readonly string[]>; const rank: number[] = []; let index = 0; let valid = true;",
    "    for (const segment of definition.segments) { if (segment.kind === 'rest') { if (index >= decoded.length) { valid = false; break; } parameters[segment.name!] = Object.freeze(decoded.slice(index)); rank.push(1); index = decoded.length; continue; } if (index >= decoded.length) { valid = false; break; } if (segment.kind === 'static') { if (encoded[index]! !== segment.value) { valid = false; break; } rank.push(3); } else { parameters[segment.name!] = decoded[index]!; rank.push(2); } index += 1; }",
    "    if (!valid || index !== decoded.length) continue; let better = selected === undefined; for (let position = 0; !better && position < Math.max(rank.length, selected?.rank.length ?? 0); position += 1) { const difference = (rank[position] ?? 0) - (selected?.rank[position] ?? 0); if (difference !== 0) { better = difference > 0; break; } } if (better) selected = { id: definition.id, parameters: Object.freeze(parameters), rank: Object.freeze(rank) };",
    "  }",
    "  return selected;",
    "}",
    "function matchFallback(pathname: string): { id: string; parameters: Readonly<Record<string, string | readonly string[]>> } | undefined {",
    "  if (pathname !== '/' && (!pathname.startsWith('/') || pathname.includes('//'))) return undefined; const encoded = pathname === '/' ? [] : pathname.replace(/\\/$/u, '').slice(1).split('/'); const decoded: string[] = [];",
    "  for (const part of encoded) { const value = decode(part); if (value === undefined) return undefined; decoded.push(value); }",
    "  for (const definition of fallbackDefinitions) { const parameters = Object.create(null) as Record<string, string | readonly string[]>; let index = 0; let valid = true; for (const segment of definition.segments) { if (segment.kind === 'rest') { if (index >= decoded.length) { valid = false; break; } parameters[segment.name] = Object.freeze(decoded.slice(index)); index = decoded.length; break; } if (index >= decoded.length) { valid = false; break; } if (segment.kind === 'static') { if (encoded[index]! !== segment.value) { valid = false; break; } } else { parameters[segment.name] = decoded[index]!; } index += 1; } if (valid) return { id: definition.id, parameters: Object.freeze(parameters) }; }",
    "  return undefined;",
    "}",
    "export const handler: Handler = async (request) => {",
    "  const pathname = new URL(request.url).pathname; const selected = match(pathname);",
    "  if (!selected) { const selectedFallback = matchFallback(pathname); if (!selectedFallback) return renderRoute({ request, parameters: Object.freeze(Object.create(null) as Record<string, never>), page: () => notFound(), layouts: [] }); switch (selectedFallback.id) {",
    ...fallbackCases,
    "    default: throw new TypeError('FADENO_GENERATED_FALLBACK_ID');",
    "  } }",
    "  switch (selected.id) {",
    ...cases,
    "    default: throw new TypeError('FADENO_GENERATED_ROUTE_ID');",
    "  }",
    "};",
    "",
  ].join("\n");
}

function renderVirtualRuntime(manifest: RouteManifest): string {
  return `// @ts-nocheck -- runtime types are owned by correlated index.d.ts.\n${renderRuntime(manifest)}`;
}

function renderVirtualLoader(manifest: RouteManifest): string {
  return [
    `// Generated by Fadeno route loader v${GENERATOR_VERSION}; source ${manifest.generation.sourceSha256}.`,
    "// Do not edit.",
    'import { registerHooks } from "node:module";',
    "registerHooks({",
    "  resolve(specifier, context, nextResolve) {",
    "    if (specifier === 'fadeno:routes') return { url: new URL('./virtual.js', import.meta.url).href, shortCircuit: true };",
    "    return nextResolve(specifier, context);",
    "  },",
    "});",
    "",
  ].join("\n");
}

function ownerDocument(manifest: RouteManifest, files: Readonly<Record<string, string>>): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    owner: "fadeno-routes",
    generatorVersion: GENERATOR_VERSION,
    sourceSha256: manifest.generation.sourceSha256,
    files: Object.entries(files).sort(([left], [right]) => compareText(left, right)).map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
  }, null, 2)}\n`;
}

function assertOwnedFiles(files: Readonly<Record<string, string>>): RouteManifest {
  if (JSON.stringify(Object.keys(files).sort(compareText)) !== JSON.stringify([...ROUTE_ARTIFACT_NAMES].sort(compareText))) {
    fail("OUTPUT_UNOWNED");
  }
  let ownerValue: unknown;
  try { ownerValue = JSON.parse(files["owner.json"]!); } catch { fail("OUTPUT_OWNER"); }
  if (!isPlainRecord(ownerValue)) fail("OUTPUT_OWNER");
  const owner = ownerValue as { schemaVersion?: number; owner?: string; generatorVersion?: number; sourceSha256?: string; files?: readonly unknown[] };
  if (JSON.stringify(Object.keys(owner).sort(compareText)) !== JSON.stringify(["files", "generatorVersion", "owner", "schemaVersion", "sourceSha256"]) ||
      owner.schemaVersion !== 1 || owner.owner !== "fadeno-routes" || owner.generatorVersion !== GENERATOR_VERSION ||
      typeof owner.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(owner.sourceSha256) || !Array.isArray(owner.files)) {
    fail("OUTPUT_OWNER");
  }
  const ownerFiles: { path: string; sha256: string }[] = [];
  for (const fileValue of owner.files) {
    if (!isPlainRecord(fileValue)) fail("OUTPUT_OWNER");
    const file = fileValue as { path?: unknown; sha256?: unknown };
    if (JSON.stringify(Object.keys(file).sort(compareText)) !== JSON.stringify(["path", "sha256"]) ||
        typeof file.path !== "string" || typeof file.sha256 !== "string" || !ROUTE_ARTIFACT_NAMES.includes(file.path as RouteArtifactName) ||
        sha256(files[file.path]!) !== file.sha256) fail("OUTPUT_OWNER");
    ownerFiles.push({ path: file.path, sha256: file.sha256 });
  }
  if (JSON.stringify(ownerFiles.map(({ path }) => path).sort(compareText)) !== JSON.stringify(["app.ts", "index.d.ts", "index.js", "loader.ts", "manifest.json", "virtual.ts"])) fail("OUTPUT_OWNER");
  const manifest = parseManifest(files["manifest.json"]!);
  if (manifest.generation.version !== owner.generatorVersion || manifest.generation.sourceSha256 !== owner.sourceSha256) fail("OUTPUT_IDENTITY");
  const identity = `Generated by Fadeno routes v${owner.generatorVersion}; source ${owner.sourceSha256}.`;
  if (!files["index.js"]!.includes(identity) || !files["index.d.ts"]!.includes(identity)) {
    fail("OUTPUT_IDENTITY");
  }
  const applicationIdentity = `Generated by Fadeno application v${owner.generatorVersion}; source ${owner.sourceSha256}.`;
  if (!files["app.ts"]!.includes(applicationIdentity)) fail("OUTPUT_IDENTITY");
  const loaderIdentity = `Generated by Fadeno route loader v${owner.generatorVersion}; source ${owner.sourceSha256}.`;
  if (!files["loader.ts"]!.includes(loaderIdentity)) fail("OUTPUT_IDENTITY");
  if (!files["virtual.ts"]!.includes(identity)) fail("OUTPUT_IDENTITY");
  return manifest;
}

function assertOwnedOutput(output: string): void {
  if (!existsSync(output)) return;
  if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) fail("OUTPUT_TYPE");
  const entries = readdirSync(output).sort(compareText);
  if (JSON.stringify(entries) !== JSON.stringify([...ROUTE_ARTIFACT_NAMES].sort(compareText))) fail("OUTPUT_UNOWNED");
  const files: Record<string, string> = {};
  for (const name of ROUTE_ARTIFACT_NAMES) {
    const path = join(output, name);
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isFile()) fail("OUTPUT_CHILD_TYPE");
    files[name] = readFileSync(path, "utf8");
  }
  assertOwnedFiles(files);
}

function assertOutputParent(projectRoot: string, parent: string): void {
  const containment = relative(resolve(projectRoot), resolve(parent));
  if (containment.startsWith("..") || containment.includes("..") || lstatSync(projectRoot).isSymbolicLink()) fail("OUTPUT_ESCAPE");
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) fail("OUTPUT_PARENT");
}

function ensureOutputParent(projectRoot: string, parent: string, fileSystem: RouteArtifactMutationFileSystem): void {
  assertOutputParent(projectRoot, parent);
  if (!existsSync(parent)) fileSystem.mkdir(parent);
  assertOutputParent(projectRoot, parent);
}

function recoverTransactionState(
  parent: string,
  output: string,
  fileSystem: RouteArtifactMutationFileSystem,
): void {
  const entries = readdirSync(parent);
  const pending = entries.filter((name) => name.startsWith("routes.pending-"));
  const previous = entries.filter((name) => name.startsWith("routes.previous-"));
  const empty = entries.filter((name) => name.startsWith("routes.empty-"));
  const garbage = entries.filter((name) => name.startsWith("routes.garbage-"));
  if (pending.length > 1 || previous.length > 1 || empty.length > 1 || garbage.length > 1 || previous.length + empty.length > 1) {
    fail("OUTPUT_RECOVERY_AMBIGUOUS");
  }
  const pendingPath = pending[0] ? join(parent, pending[0]) : null;
  const previousPath = previous[0] ? join(parent, previous[0]) : null;
  const emptyPath = empty[0] ? join(parent, empty[0]) : null;
  const garbagePath = garbage[0] ? join(parent, garbage[0]) : null;
  if (garbagePath) {
    if (lstatSync(garbagePath).isSymbolicLink() || !lstatSync(garbagePath).isDirectory()) fail("OUTPUT_RECOVERY_GARBAGE");
    fileSystem.remove(garbagePath);
    if (existsSync(garbagePath)) fail("OUTPUT_RECOVERY_GARBAGE");
  }
  if (pendingPath) {
    if (lstatSync(pendingPath).isSymbolicLink() || !lstatSync(pendingPath).isDirectory()) fail("OUTPUT_RECOVERY_PENDING");
  }
  if (previousPath) assertOwnedOutput(previousPath);
  if (emptyPath && (lstatSync(emptyPath).isSymbolicLink() || !lstatSync(emptyPath).isDirectory() || readdirSync(emptyPath).length > 0)) {
    fail("OUTPUT_RECOVERY_EMPTY");
  }
  if (pendingPath) {
    const displacedPending = join(parent, `routes.garbage-${randomUUID()}`);
    fileSystem.rename(pendingPath, displacedPending);
    fileSystem.remove(displacedPending);
  }
  if (previousPath) {
    if (existsSync(output)) {
      const displacedOutput = join(parent, `routes.garbage-${randomUUID()}`);
      if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) fail("OUTPUT_RECOVERY_CURRENT");
      fileSystem.rename(output, displacedOutput);
      fileSystem.rename(previousPath, output);
      assertOwnedOutput(output);
      fileSystem.remove(displacedOutput);
      return;
    }
    fileSystem.rename(previousPath, output);
    assertOwnedOutput(output);
    return;
  }
  if (emptyPath) {
    if (existsSync(output)) {
      const displacedOutput = join(parent, `routes.garbage-${randomUUID()}`);
      if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) fail("OUTPUT_RECOVERY_CURRENT");
      fileSystem.rename(output, displacedOutput);
      fileSystem.remove(emptyPath);
      fileSystem.remove(displacedOutput);
      return;
    }
    fileSystem.remove(emptyPath);
  }
}

export function createRouteArtifactPlan(projectRoot: string, config: FadenoConfig): RouteArtifactPlan {
  if (!config.routes) fail("ROUTES_REQUIRED");
  const { manifest, sources } = discoverRouteManifestWithSources(projectRoot, config.routes);
  assertRouteManifestSemantics(manifest);
  const correlated = Object.freeze({
    "app.ts": renderApplication(manifest),
    "index.d.ts": renderDeclaration(manifest),
    "index.js": renderRuntime(manifest),
    "loader.ts": renderVirtualLoader(manifest),
    "manifest.json": stableRouteManifest(manifest),
    "virtual.ts": renderVirtualRuntime(manifest),
  });
  const files: Readonly<Record<RouteArtifactName, string>> = Object.freeze({
    ...correlated,
    "owner.json": ownerDocument(manifest, correlated),
  });
  return Object.freeze({ manifest, sourceSha256: manifest.generation.sourceSha256, sources, files });
}

export function verifyRouteArtifactPlanFreshness(
  projectRoot: string,
  config: FadenoConfig,
  plan: RouteArtifactPlan,
): void {
  if (!config.routes) fail("ROUTES_REQUIRED");
  const current = discoverRouteManifestWithSources(projectRoot, config.routes);
  if (
    current.manifest.generation.sourceSha256 !== plan.sourceSha256 ||
    stableRouteManifest(current.manifest) !== stableRouteManifest(plan.manifest) ||
    JSON.stringify(current.sources) !== JSON.stringify(plan.sources)
  ) fail("SOURCE_CHANGED");
}

export function beginRouteArtifactApplication(
  projectRoot: string,
  plan: RouteArtifactPlan,
  options: RouteArtifactApplicationOptions,
): RouteArtifactApplicationTransaction {
  const manifest = assertOwnedFiles(plan.files);
  if (manifest.generation.sourceSha256 !== plan.sourceSha256) fail("OUTPUT_IDENTITY");
  const expected: Readonly<Record<string, string>> = plan.files;
  const fileSystem = options.fileSystem ?? nodeMutationFileSystem;

  const parent = join(resolve(projectRoot), ".fadeno");
  const output = join(parent, "routes");
  const recover = (): void => {
    if (!existsSync(parent)) return;
    assertOutputParent(projectRoot, parent);
    recoverTransactionState(parent, output, fileSystem);
  };
  options.retainRecovery?.(recover);
  options.assertFresh();
  ensureOutputParent(projectRoot, parent, fileSystem);
  recover();
  options.assertFresh();
  assertOwnedOutput(output);
  const transactionId = randomUUID();
  const pending = join(parent, `routes.pending-${transactionId}`);
  const previous = join(parent, `routes.previous-${transactionId}`);
  const empty = join(parent, `routes.empty-${transactionId}`);
  const garbage = join(parent, `routes.garbage-${transactionId}`);
  const unchanged = existsSync(output) && Object.entries(expected).every(
    ([name, bytes]) => readFileSync(join(output, name), "utf8") === bytes,
  );
  fileSystem.mkdir(pending);
  let rollbackKind: "previous" | "empty" | null = null;
  let previousFiles: Readonly<Record<string, string>> | null = null;
  let state: RouteArtifactApplicationTransaction["state"] = "pending";
  let cleanupPending = false;
  const result = Object.freeze({ changed: !unchanged, output, sourceSha256: plan.sourceSha256 });
  const assertPending = (): void => {
    if (state !== "pending") fail("TRANSACTION_STATE");
    assertExactOwnedOutput(output, expected);
    if (rollbackKind === "previous" && previousFiles) assertExactOwnedOutput(previous, previousFiles);
    else if (rollbackKind === "empty") assertEmptyMarker(empty);
    else fail("TRANSACTION_STATE");
  };
  const cleanup = (): void => {
    if (!cleanupPending) return;
    if (!existsSync(garbage)) {
      cleanupPending = false;
      return;
    }
    if (lstatSync(garbage).isSymbolicLink() || !lstatSync(garbage).isDirectory()) fail("OUTPUT_RECOVERY_GARBAGE");
    fileSystem.remove(garbage);
    if (existsSync(garbage)) fail("OUTPUT_RECOVERY_GARBAGE");
    cleanupPending = false;
  };
  const rollback = (): void => {
    if (state === "committed") fail("TRANSACTION_STATE");
    if (state === "rolled-back") {
      cleanup();
      return;
    }
    recoverTransactionState(parent, output, fileSystem);
    if (rollbackKind === "previous" && previousFiles) assertExactOwnedOutput(output, previousFiles);
    else if (rollbackKind === "empty" && existsSync(output)) fail("TRANSACTION_STATE");
    state = "rolled-back";
  };
  const transaction: RouteArtifactApplicationTransaction = Object.freeze({
    result,
    get state() { return state; },
    get cleanupPending() { return cleanupPending; },
    assertPending,
    commit: () => {
      if (state === "rolled-back") fail("TRANSACTION_STATE");
      if (state === "committed") {
        cleanup();
        return result;
      }
      options.assertFresh();
      assertPending();
      options.observe?.("before-cleanup");
      options.assertFresh();
      assertPending();
      const marker = rollbackKind === "previous" ? previous : empty;
      fileSystem.rename(marker, garbage);
      state = "committed";
      cleanupPending = true;
      try { cleanup(); } catch { /* accepted output is durable; retained owners or restart retry garbage cleanup */ }
      return result;
    },
    rollback,
    cleanup,
  });
  try {
    for (const name of ROUTE_ARTIFACT_NAMES) {
      assertOutputParent(projectRoot, parent);
      if (lstatSync(pending).isSymbolicLink() || !lstatSync(pending).isDirectory()) fail("OUTPUT_PENDING");
      fileSystem.writeFile(join(pending, name), plan.files[name]);
      options.afterWrite?.(name);
    }
    assertOwnedOutput(pending);
    options.observe?.("after-stage");
    options.assertFresh();
    assertOutputParent(projectRoot, parent);
    assertOwnedOutput(pending);
    if (existsSync(output)) assertOwnedOutput(output);

    const hadOutput = existsSync(output);
    previousFiles = hadOutput
      ? Object.freeze(Object.fromEntries(ROUTE_ARTIFACT_NAMES.map((name) => [name, readFileSync(join(output, name), "utf8")])))
      : null;
    rollbackKind = hadOutput ? "previous" : "empty";
    options.retainTransaction?.(transaction);
    if (unchanged) {
      fileSystem.rename(pending, previous);
    } else if (hadOutput) {
      fileSystem.rename(output, previous);
    } else {
      fileSystem.mkdir(empty);
    }
    try {
      options.observe?.("after-backup");
      if (!unchanged) {
        assertOutputParent(projectRoot, parent);
        assertOwnedOutput(pending);
        if (hadOutput) assertOwnedOutput(previous);
        if (existsSync(output)) fail("OUTPUT_REPLACEMENT_STATE");
        fileSystem.rename(pending, output);
      }
      assertOwnedOutput(output);
      options.observe?.("after-replace");
      options.assertFresh();
    } catch (error) {
      try { transaction.rollback(); } catch { /* retained owner or next-run recovery keeps exact rollback identity */ }
      throw error;
    }
    return transaction;
  } catch (error) {
    if (rollbackKind !== null && state === "pending") {
      try { transaction.rollback(); } catch { /* retained owner or next-run recovery keeps exact rollback identity */ }
    } else if (existsSync(pending)) {
      try {
        fileSystem.rename(pending, garbage);
        cleanupPending = true;
        cleanup();
      } catch { /* next-run recovery removes non-authoritative garbage */ }
    }
    throw error;
  }
}

export function applyRouteArtifactPlan(
  projectRoot: string,
  plan: RouteArtifactPlan,
  options: RouteArtifactApplicationOptions,
): RouteGenerationResult {
  const transaction = beginRouteArtifactApplication(projectRoot, plan, options);
  return transaction.commit();
}
