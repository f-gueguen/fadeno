import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig, normalizeConfig } from "../packages/framework/src/internal/config.ts";
import { FadenoDiagnosticError } from "../packages/framework/src/internal/diagnostic.ts";
import { RouteContractError, type RouteManifest } from "../packages/framework/src/internal/routing/discovery.ts";
import { generateRoutes, type GenerationFailurePoint } from "../packages/framework/src/internal/routing/generator.ts";
import { matchRoutePathname } from "../packages/framework/src/internal/routing/matcher.ts";

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const moduleSource = "throw new Error('FADENO_ROUTE_MODULE_EXECUTED');\nexport {};\n";

function writeRoute(project: string, path: string, source = moduleSource): void {
  const absolute = join(project, "src/routes", path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

function createProject(routes: readonly string[]): string {
  const project = mkdtempSync(join(tmpdir(), "fadeno-v1-routing-"));
  writeFileSync(join(project, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(join(project, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  for (const route of routes) writeRoute(project, route);
  return project;
}

function snapshot(output: string): Record<string, { bytes: Buffer; mtimeNs: bigint }> {
  return Object.fromEntries(readdirSync(output).sort().map((name) => {
    const path = join(output, name);
    return [name, { bytes: readFileSync(path), mtimeNs: statSync(path, { bigint: true }).mtimeNs }];
  }));
}

function assertSnapshot(output: string, expected: ReturnType<typeof snapshot>, checkMtime = false): void {
  const actual = snapshot(output);
  if (JSON.stringify(Object.keys(actual)) !== JSON.stringify(Object.keys(expected))) throw new Error("FADENO_ROUTING_SNAPSHOT_FILES");
  for (const [name, value] of Object.entries(expected)) {
    if (!actual[name]?.bytes.equals(value.bytes) || (checkMtime && actual[name]?.mtimeNs !== value.mtimeNs)) {
      throw new Error(`FADENO_ROUTING_SNAPSHOT:${name}`);
    }
  }
}

function runTypeFixture(project: string, declaration: string): void {
  const fixture = join(project, "route-types.ts");
  writeFileSync(fixture, [
    'import { routeHref, type RouteHrefInput } from "fadeno:routes";',
    'routeHref({ route: "/" });',
    'routeHref({ route: "/accounts/[accountId]", parameters: { accountId: "a" } });',
    'const union: RouteHrefInput<"/" | "/accounts/[accountId]"> = Math.random() ? { route: "/" } : { route: "/accounts/[accountId]", parameters: { accountId: "a" } };',
    'routeHref(union);',
    '// @ts-expect-error unknown route',
    'routeHref({ route: "/unknown" });',
    '// @ts-expect-error missing parameters',
    'routeHref({ route: "/accounts/[accountId]" });',
    'const extra = { route: "/accounts/[accountId]", parameters: { accountId: "a", extra: "no" } } as const;',
    '// @ts-expect-error indirect excess parameter',
    'routeHref(extra);',
    '',
  ].join("\n"));
  const result = spawnSync(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--module", "ESNext", "--moduleResolution", "Bundler", "--types", "", declaration, fixture], { cwd: project, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`FADENO_ROUTING_TYPES\n${result.stdout}\n${result.stderr}`);
}

function expectError(action: () => unknown, code: string): void {
  try { action(); } catch (error) {
    if (error instanceof Error && error.message.includes(code)) return;
    throw error;
  }
  throw new Error(`FADENO_ROUTING_EXPECTED:${code}`);
}

const main = createProject([
  "layout.tsx", "not-found.tsx", "error.tsx", "page.tsx",
  "accounts/[accountId]/page.tsx",
  "docs/about/page.tsx",
  "docs/[slug]/details/page.tsx",
  "docs/[...parts]/page.tsx",
  "teams/[teamId]/members/[memberId]/handler.ts",
]);

try {
  const originalConfig = readFileSync(join(main, "fadeno.config.ts"), "utf8");
  const config = await loadConfig(main);
  writeFileSync(join(main, "fadeno.config.ts"), "export default {};\n");
  if ((await loadConfig(main)).routes !== undefined) throw new Error("FADENO_ROUTING_CONFIG_CACHE");
  writeFileSync(join(main, "fadeno.config.ts"), originalConfig);
  if ((await loadConfig(main)).routes?.root !== "src/routes") throw new Error("FADENO_ROUTING_CONFIG_RELOAD");
  const first = generateRoutes(main, config);
  if (!first.changed) throw new Error("FADENO_ROUTING_FIRST_UNCHANGED");
  const accepted = snapshot(first.output);
  const second = generateRoutes(main, await loadConfig(main));
  if (second.changed) throw new Error("FADENO_ROUTING_REWROTE_IDENTICAL");
  assertSnapshot(first.output, accepted, true);

  const manifest = JSON.parse(readFileSync(join(first.output, "manifest.json"), "utf8")) as RouteManifest;
  const cases: readonly [string, string | undefined, Record<string, string | readonly string[]>?][] = [
    ["/", "/"],
    ["/docs/about", "/docs/about"],
    ["/docs/about/extra", "/docs/[...parts]", { parts: ["about", "extra"] }],
    ["/docs/thing/details", "/docs/[slug]/details", { slug: "thing" }],
    ["/docs/thing/nope", "/docs/[...parts]", { parts: ["thing", "nope"] }],
    ["/docs/a%2Fb/details", "/docs/[slug]/details", { slug: "a/b" }],
    ["/accounts/%25", "/accounts/[accountId]", { accountId: "%" }],
    ["/accounts/%C3%BC", "/accounts/[accountId]", { accountId: "ü" }],
    ["/docs/%61bout", "/docs/[...parts]", { parts: ["about"] }],
    ["/docs", undefined],
    ["/docs/", undefined],
    ["/docs//about", undefined],
    ["/accounts/%", undefined],
    ["/accounts/%C3", undefined],
    ["/accounts/%2E", undefined],
    ["/accounts/%2E%2E", undefined],
    ["/docs/about?query=1", undefined],
  ];
  for (const [pathname, id, parameters] of cases) {
    const match = matchRoutePathname(manifest, pathname);
    if (match?.route.id !== id || (parameters && JSON.stringify(match?.parameters) !== JSON.stringify(parameters))) {
      throw new Error(`FADENO_ROUTING_MATCH:${pathname}:${match?.route.id ?? "none"}`);
    }
    if (match && Object.getPrototypeOf(match.parameters) !== null) throw new Error("FADENO_ROUTING_PARAMETER_PROTOTYPE");
  }
  if (matchRoutePathname(manifest, new URL("https://example.test/docs/about?query=1").pathname)?.route.id !== "/docs/about") {
    throw new Error("FADENO_ROUTING_URL_PATHNAME");
  }

  runTypeFixture(main, join(first.output, "index.d.ts"));
  const runtime = await import(`${pathToFileURL(join(first.output, "index.js")).href}?first` ) as { routeHref(input: unknown): string };
  if (runtime.routeHref({ route: "/accounts/[accountId]", parameters: { accountId: "a/b" } }) !== "/accounts/a%2Fb") {
    throw new Error("FADENO_ROUTING_RUNTIME_LINK");
  }
  expectError(() => runtime.routeHref({ route: "/unknown" }), "FADENO_ROUTE_LINK_ROUTE");
  expectError(() => runtime.routeHref({ route: "constructor" }), "FADENO_ROUTE_LINK_ROUTE");

  writeRoute(main, "new/page.tsx");
  for (const point of ["manifest", "runtime", "declaration", "owner", "beforeReplace"] satisfies readonly GenerationFailurePoint[]) {
    expectError(() => generateRoutes(main, config, point), "FADENO_GENERATION_INJECTED");
    assertSnapshot(first.output, accepted);
    if (readdirSync(join(main, ".fadeno")).some((name) => name.startsWith("routes.pending-") || name.startsWith("routes.previous-"))) {
      throw new Error("FADENO_ROUTING_TRANSACTION_DEBRIS");
    }
  }
  const accountSource = join(main, "src/routes/accounts/[accountId]/page.tsx");
  expectError(() => generateRoutes(main, config, undefined, () => writeFileSync(accountSource, `${moduleSource}// changed\n`)), "FADENO_GENERATION_SOURCE_CHANGED");
  assertSnapshot(first.output, accepted);
  writeFileSync(accountSource, moduleSource);

  const changed = generateRoutes(main, config);
  if (!changed.changed || !readFileSync(join(changed.output, "index.d.ts"), "utf8").includes('readonly "/new"')) throw new Error("FADENO_ROUTING_STALE_ADD");
  rmSync(join(main, "src/routes/new"), { recursive: true });
  generateRoutes(main, config);
  if (readFileSync(join(changed.output, "index.d.ts"), "utf8").includes('readonly "/new"')) throw new Error("FADENO_ROUTING_STALE_REMOVE");

  const ownerPath = join(changed.output, "owner.json");
  const ownerBytes = readFileSync(ownerPath);
  const owner = JSON.parse(ownerBytes.toString("utf8")) as { sourceSha256: string };
  owner.sourceSha256 = "0".repeat(64);
  writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`);
  expectError(() => generateRoutes(main, config), "FADENO_GENERATION_OUTPUT_IDENTITY");
  writeFileSync(ownerPath, ownerBytes);

  const diagnosticProject = createProject(["page.tsx", "handler.ts"]);
  try {
    let diagnostic: RouteContractError | undefined;
    try { generateRoutes(diagnosticProject, await loadConfig(diagnosticProject)); } catch (error) { if (error instanceof RouteContractError) diagnostic = error; }
    if (!diagnostic || diagnostic.severity !== "error" || diagnostic.locations.length !== 2 || !diagnostic.explanation.startsWith("https://fadeno.dev/diagnostics/routes/") || diagnostic.correction.length === 0) {
      throw new Error("FADENO_ROUTING_STRUCTURED_DIAGNOSTIC");
    }
  } finally { rmSync(diagnosticProject, { recursive: true, force: true }); }
} finally {
  rmSync(main, { recursive: true, force: true });
}

const appA = createProject(["alpha/page.tsx"]);
const appB = createProject(["beta/page.tsx"]);
try {
  const outputA = generateRoutes(appA, await loadConfig(appA)).output;
  const outputB = generateRoutes(appB, await loadConfig(appB)).output;
  const moduleA = await import(`${pathToFileURL(join(outputA, "index.js")).href}?a`) as { routeHref(input: unknown): string };
  const moduleB = await import(`${pathToFileURL(join(outputB, "index.js")).href}?b`) as { routeHref(input: unknown): string };
  if (moduleA.routeHref({ route: "/alpha" }) !== "/alpha" || moduleB.routeHref({ route: "/beta" }) !== "/beta") throw new Error("FADENO_ROUTING_APP_BINDING");
  expectError(() => moduleA.routeHref({ route: "/beta" }), "FADENO_ROUTE_LINK_ROUTE");
  expectError(() => moduleB.routeHref({ route: "/alpha" }), "FADENO_ROUTE_LINK_ROUTE");
} finally {
  rmSync(appA, { recursive: true, force: true });
  rmSync(appB, { recursive: true, force: true });
}

for (const invalid of [null, [], new (class Config {})(), new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }), { unknown: true }, { routes: null }, { routes: "src/routes" }, { routes: {} }, { routes: { root: 1 } }, { routes: { root: "src/routes", extra: true } }]) {
  expectError(() => normalizeConfig(invalid), "FADENO_CONFIG");
}
try { normalizeConfig({ unknown: true }); } catch (error) {
  if (!(error instanceof FadenoDiagnosticError) || error.severity !== "error" || error.locations[0] !== "fadeno.config.ts" || error.correction.length === 0) {
    throw new Error("FADENO_ROUTING_CONFIG_DIAGNOSTIC");
  }
}

const noRoutes = mkdtempSync(join(tmpdir(), "fadeno-v1-routing-empty-"));
try {
  writeFileSync(join(noRoutes, "fadeno.config.ts"), "export default {};\n");
  const config = await loadConfig(noRoutes);
  expectError(() => generateRoutes(noRoutes, config), "FADENO_GENERATION_ROUTES_REQUIRED");
} finally { rmSync(noRoutes, { recursive: true, force: true }); }

const configSymlinkProject = createProject(["page.tsx"]);
const configTarget = join(configSymlinkProject, "actual-config.ts");
try {
  rmSync(join(configSymlinkProject, "fadeno.config.ts"));
  writeFileSync(configTarget, "export default { routes: { root: 'src/routes' } };\n");
  symlinkSync(configTarget, join(configSymlinkProject, "fadeno.config.ts"));
  await loadConfig(configSymlinkProject).then(
    () => { throw new Error("FADENO_ROUTING_EXPECTED:CONFIG_FILE"); },
    (error: unknown) => { if (!(error instanceof Error) || !error.message.includes("FADENO_CONFIG_FILE")) throw error; },
  );
} finally { rmSync(configSymlinkProject, { recursive: true, force: true }); }

for (const kind of ["parent", "output"] as const) {
  const project = createProject(["page.tsx"]);
  const external = mkdtempSync(join(tmpdir(), "fadeno-v1-routing-external-"));
  try {
    if (kind === "parent") symlinkSync(external, join(project, ".fadeno"));
    else { mkdirSync(join(project, ".fadeno")); symlinkSync(external, join(project, ".fadeno/routes")); }
    const config = await loadConfig(project);
    expectError(() => generateRoutes(project, config), "FADENO_GENERATION_OUTPUT");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
}

console.log("V1 production routing passed (config, discovery, transaction, stock types, app-bound links, metadata matcher)");
