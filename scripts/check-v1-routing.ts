import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig, normalizeConfig } from "../packages/framework/src/internal/config.ts";
import { FadenoDiagnosticError, formatDiagnostic } from "../packages/framework/src/internal/diagnostic.ts";
import type { FadenoConfig } from "../packages/framework/src/index.ts";
import { RouteContractError, type RouteManifest } from "../packages/framework/src/internal/routing/discovery.ts";
import {
  applyRouteArtifactPlan,
  createRouteArtifactPlan,
  verifyRouteArtifactPlanFreshness,
  type RouteArtifactMutationFileSystem,
  type RouteGenerationResult,
} from "../packages/framework/src/internal/routing/generator.ts";
import { matchRoutePathname } from "../packages/framework/src/internal/routing/matcher.ts";

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const moduleSource = "throw new Error('FADENO_ROUTE_MODULE_EXECUTED');\nexport {};\n";

type GenerationFailurePoint = "manifest" | "runtime" | "declaration" | "owner" | "beforeReplace";
type GenerationOperationFailure = "afterBackup" | "replace" | "restore" | "cleanup";

function injected(code: string): never {
  throw new TypeError(`FADENO_GENERATION_INJECTED_${code}`);
}

function generateRoutes(
  projectRoot: string,
  config: FadenoConfig,
  failurePoint?: GenerationFailurePoint,
  beforeSourceValidation?: () => void,
  operationFailure?: GenerationOperationFailure,
  afterReplaceValidation?: () => void,
): RouteGenerationResult {
  const plan = createRouteArtifactPlan(projectRoot, config);
  const operationFileSystem: RouteArtifactMutationFileSystem = Object.freeze({
    mkdir: (path) => mkdirSync(path),
    writeFile: (path, bytes) => writeFileSync(path, bytes),
    rename: (from, to) => {
      const fromName = basename(from);
      const toName = basename(to);
      if ((operationFailure === "replace" || operationFailure === "restore") && fromName.startsWith("routes.pending-") && toName === "routes") {
        injected("REPLACE");
      }
      if (operationFailure === "restore" && fromName.startsWith("routes.previous-") && toName === "routes") injected("RESTORE");
      renameSync(from, to);
    },
    remove: (path) => {
      if (operationFailure === "cleanup" && basename(path).startsWith("routes.garbage-")) injected("CLEANUP");
      rmSync(path, { recursive: true, force: true });
    },
  });
  let replaced = false;
  return applyRouteArtifactPlan(projectRoot, plan, {
    assertFresh: () => {
      try { verifyRouteArtifactPlanFreshness(projectRoot, config, plan); } catch (error) {
        if (replaced && error instanceof FadenoDiagnosticError && error.id === "FADENO_GENERATION_SOURCE_CHANGED") {
          throw new TypeError("FADENO_GENERATION_SOURCE_CHANGED_AFTER_REPLACE");
        }
        throw error;
      }
    },
    fileSystem: operationFileSystem,
    afterWrite: (name) => {
      const point = name === "manifest.json" ? "manifest"
        : name === "index.d.ts" ? "declaration"
          : name === "owner.json" ? "owner" : "runtime";
      if (failurePoint === point) injected(point.toUpperCase());
    },
    observe: (phase) => {
      if (phase === "after-stage") {
        beforeSourceValidation?.();
        if (failurePoint === "beforeReplace") injected("BEFORE_REPLACE");
      }
      if (phase === "after-backup" && operationFailure === "afterBackup") injected("AFTER_BACKUP");
      if (phase === "after-replace") {
        replaced = true;
        afterReplaceValidation?.();
      }
    },
  });
}

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
    '// @ts-expect-error internal generator helper is not exported',
    'import type { RouteDefinitionMap } from "fadeno:routes";',
    '// @ts-expect-error internal exactness helper is not exported',
    'import type { NoExtra } from "fadeno:routes";',
    '// @ts-expect-error internal input helper is not exported',
    'import type { ExactRouteHrefInput } from "fadeno:routes";',
    'routeHref({ route: "/" });',
    'routeHref({ route: "/accounts/[accountId]", parameters: { accountId: "a" } });',
    'routeHref({ route: "/docs/[...parts]", parameters: { parts: ["one", "two"] } });',
    'const union: RouteHrefInput<"/" | "/accounts/[accountId]"> = Math.random() ? { route: "/" } : { route: "/accounts/[accountId]", parameters: { accountId: "a" } };',
    'routeHref(union);',
    '// @ts-expect-error unknown route',
    'routeHref({ route: "/unknown" });',
    'declare const broad: string;',
    '// @ts-expect-error broad strings are not route identities',
    'routeHref({ route: broad });',
    '// @ts-expect-error missing parameters',
    'routeHref({ route: "/accounts/[accountId]" });',
    '// @ts-expect-error static routes do not accept parameters',
    'routeHref({ route: "/", parameters: {} });',
    '// @ts-expect-error wrong parameter name',
    'routeHref({ route: "/accounts/[accountId]", parameters: { wrong: "a" } });',
    '// @ts-expect-error rest parameters are non-empty tuples',
    'routeHref({ route: "/docs/[...parts]", parameters: { parts: [] } });',
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
  const planned = createRouteArtifactPlan(main, config);
  const repeatedPlan = createRouteArtifactPlan(main, config);
  if (existsSync(join(main, ".fadeno"))) throw new Error("FADENO_ROUTING_PLAN_WROTE_OUTPUT");
  if (!Object.isFrozen(planned) || !Object.isFrozen(planned.sources) || !Object.isFrozen(planned.files)) {
    throw new Error("FADENO_ROUTING_PLAN_MUTABLE");
  }
  if (!Object.isFrozen(planned.manifest.routes) || !Object.isFrozen(planned.manifest.routes[0]) ||
      !Object.isFrozen(planned.manifest.routes[0]!.segments) || !Object.isFrozen(planned.manifest.routes[0]!.segments[0]) ||
      !Object.isFrozen(planned.manifest.routes[0]!.parameters) || !Object.isFrozen(planned.manifest.routes[0]!.layouts)) {
    throw new Error("FADENO_ROUTING_PLAN_NESTED_MUTABLE");
  }
  assert.throws(() => (planned.manifest.routes as RouteManifest["routes"][number][]).push(planned.manifest.routes[0]!));
  assert.throws(() => { (planned.manifest.routes[0] as { id: string }).id = "/mutated"; });
  if (planned.sourceSha256 !== planned.manifest.generation.sourceSha256 ||
      JSON.stringify(planned.files) !== JSON.stringify(repeatedPlan.files)) {
    throw new Error("FADENO_ROUTING_PLAN_IDENTITY");
  }
  writeRoute(main, "orphan/layout.tsx");
  const orphanPlan = createRouteArtifactPlan(main, config);
  if (!Object.hasOwn(orphanPlan.sources, "src/routes/orphan/layout.tsx")) throw new Error("FADENO_ROUTING_PLAN_COMPLETE_SOURCES");
  rmSync(join(main, "src/routes/orphan"), { recursive: true, force: true });
  writeRoute(main, "late/page.tsx");
  expectError(() => verifyRouteArtifactPlanFreshness(main, config, planned), "FADENO_GENERATION_SOURCE_CHANGED");
  rmSync(join(main, "src/routes/late"), { recursive: true, force: true });
  verifyRouteArtifactPlanFreshness(main, config, planned);
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
    ["/docs/a%2Fb/%25/%C3%BC", "/docs/[...parts]", { parts: ["a/b", "%", "ü"] }],
    ["/accounts/%3F%23%5C", "/accounts/[accountId]", { accountId: "?#\\" }],
    ["/docs/%61bout", "/docs/[...parts]", { parts: ["about"] }],
    ["/docs", undefined],
    ["/docs/", undefined],
    ["/docs//about", undefined],
    ["/accounts/%", undefined],
    ["/accounts/%C3", undefined],
    ["/accounts/%2E", undefined],
    ["/accounts/%2E%2E", undefined],
    ["/accounts/raw space", undefined],
    ["/accounts/ü", undefined],
    ["/accounts/raw\\slash", undefined],
    [`/accounts/${String.fromCharCode(0)}`, undefined],
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
  const nullParameters = Object.assign(Object.create(null) as object, { accountId: "null-prototype" });
  const nullInput = Object.assign(Object.create(null) as object, { route: "/accounts/[accountId]", parameters: nullParameters });
  if (runtime.routeHref(nullInput) !== "/accounts/null-prototype") throw new Error("FADENO_ROUTING_RUNTIME_NULL_PROTOTYPE");
  const encoded = runtime.routeHref({ route: "/docs/[...parts]", parameters: { parts: ["!'()*", "a/b", "?#%", "ü"] } });
  if (encoded !== "/docs/%21%27%28%29%2A/a%2Fb/%3F%23%25/%C3%BC") throw new Error(`FADENO_ROUTING_RUNTIME_ENCODING:${encoded}`);
  expectError(() => runtime.routeHref({ route: "/unknown" }), "FADENO_ROUTE_LINK_ROUTE");
  expectError(() => runtime.routeHref({ route: "constructor" }), "FADENO_ROUTE_LINK_ROUTE");
  const sparseFirst = new Array<string>(2); sparseFirst[1] = "two";
  const sparseMiddle = ["one", "three"] as string[]; sparseMiddle.length = 3; sparseMiddle[2] = "three"; delete sparseMiddle[1];
  const sparseLast = ["one"] as string[]; sparseLast.length = 2;
  const restExtraKey = ["one"] as string[] & { extra?: string }; restExtraKey.extra = "no";
  for (const invalid of [
    { route: "/", extra: true },
    { route: "/", parameters: {} },
    { route: "/accounts/[accountId]" },
    { route: "/accounts/[accountId]", parameters: { wrong: "a" } },
    { route: "/accounts/[accountId]", parameters: { accountId: "a", extra: "no" } },
    { route: "/accounts/[accountId]", parameters: { accountId: "" } },
    { route: "/accounts/[accountId]", parameters: { accountId: "." } },
    { route: "/accounts/[accountId]", parameters: { accountId: ".." } },
    { route: "/accounts/[accountId]", parameters: { accountId: "\ud800" } },
    { route: "/docs/[...parts]", parameters: { parts: [] } },
    { route: "/docs/[...parts]", parameters: { parts: sparseFirst } },
    { route: "/docs/[...parts]", parameters: { parts: sparseMiddle } },
    { route: "/docs/[...parts]", parameters: { parts: sparseLast } },
    { route: "/docs/[...parts]", parameters: { parts: restExtraKey } },
    { route: "/docs/[...parts]", parameters: { parts: [undefined] } },
  ]) expectError(() => runtime.routeHref(invalid), "FADENO_ROUTE_LINK");

  writeRoute(main, "new/page.tsx");
  for (const point of ["manifest", "runtime", "declaration", "owner", "beforeReplace"] satisfies readonly GenerationFailurePoint[]) {
    expectError(() => generateRoutes(main, config, point), "FADENO_GENERATION_INJECTED");
    assertSnapshot(first.output, accepted);
    if (readdirSync(join(main, ".fadeno")).some((name) => name.startsWith("routes.pending-") || name.startsWith("routes.previous-"))) {
      throw new Error("FADENO_ROUTING_TRANSACTION_DEBRIS");
    }
  }
  for (const operation of ["afterBackup", "replace"] as const) {
    expectError(() => generateRoutes(main, config, undefined, undefined, operation), "FADENO_GENERATION_INJECTED");
    assertSnapshot(first.output, accepted, true);
    if (readdirSync(join(main, ".fadeno")).some((name) => name.startsWith("routes.pending-") || name.startsWith("routes.previous-"))) {
      throw new Error(`FADENO_ROUTING_REPLACEMENT_DEBRIS:${operation}`);
    }
  }
  expectError(() => generateRoutes(main, config, undefined, undefined, "restore"), "FADENO_GENERATION_INJECTED");
  if (existsSync(first.output) || readdirSync(join(main, ".fadeno")).filter((name) => name.startsWith("routes.previous-")).length !== 1) {
    throw new Error("FADENO_ROUTING_RESTORE_RECOVERY_STATE");
  }
  rmSync(join(main, "src/routes/new"), { recursive: true });
  if (generateRoutes(main, config).changed) throw new Error("FADENO_ROUTING_RESTORE_RECOVERY_REWROTE");
  assertSnapshot(first.output, accepted, true);
  writeRoute(main, "new/page.tsx");
  const accountSource = join(main, "src/routes/accounts/[accountId]/page.tsx");
  expectError(() => generateRoutes(main, config, undefined, () => writeFileSync(accountSource, `${moduleSource}// changed\n`)), "FADENO_GENERATION_SOURCE_CHANGED");
  assertSnapshot(first.output, accepted);
  writeFileSync(accountSource, moduleSource);
  expectError(
    () => generateRoutes(main, config, undefined, undefined, undefined, () => writeFileSync(accountSource, `${moduleSource}// changed after replace\n`)),
    "FADENO_GENERATION_SOURCE_CHANGED_AFTER_REPLACE",
  );
  assertSnapshot(first.output, accepted);
  writeFileSync(accountSource, moduleSource);
  expectError(
    () => generateRoutes(main, config, undefined, undefined, undefined, () => { throw new Error("post-validation failed"); }),
    "post-validation failed",
  );
  assertSnapshot(first.output, accepted);
  expectError(
    () => generateRoutes(main, config, undefined, undefined, undefined, () => writeFileSync(join(main, "src/routes/unsupported.txt"), "invalid\n")),
    "FADENO_ROUTE_UNSUPPORTED_ENTRY",
  );
  assertSnapshot(first.output, accepted);
  rmSync(join(main, "src/routes/unsupported.txt"));

  const changed = generateRoutes(main, config);
  if (!changed.changed || !readFileSync(join(changed.output, "index.d.ts"), "utf8").includes('Id extends "/new"')) throw new Error("FADENO_ROUTING_STALE_ADD");
  writeRoute(main, "cleanup/page.tsx");
  if (!generateRoutes(main, config, undefined, undefined, "cleanup").changed) throw new Error("FADENO_ROUTING_CLEANUP_ACCEPTANCE");
  if (!readdirSync(join(main, ".fadeno")).some((name) => name.startsWith("routes.garbage-"))) {
    throw new Error("FADENO_ROUTING_CLEANUP_PUBLICATION");
  }
  if (generateRoutes(main, config).changed || readdirSync(join(main, ".fadeno")).some((name) => name.startsWith("routes.garbage-"))) {
    throw new Error("FADENO_ROUTING_CLEANUP_RECOVERY");
  }
  rmSync(join(main, "src/routes/cleanup"), { recursive: true });
  rmSync(join(main, "src/routes/new"), { recursive: true });
  generateRoutes(main, config);
  if (readFileSync(join(changed.output, "index.d.ts"), "utf8").includes('Id extends "/new"')) throw new Error("FADENO_ROUTING_STALE_REMOVE");

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
    try { createRouteArtifactPlan(diagnosticProject, await loadConfig(diagnosticProject)); } catch (error) { if (error instanceof RouteContractError) diagnostic = error; }
    const expectedDiagnostic = `${JSON.stringify({
      id: "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
      severity: "error",
      summary: "Route contract violation: route role collision",
      locations: ["src/routes/handler.ts", "src/routes/page.tsx"],
      sourceRanges: [
        { path: "src/routes/handler.ts", range: null },
        { path: "src/routes/page.tsx", range: null },
      ],
      explanation: "https://fadeno.dev/diagnostics/routes/route-role-collision",
      correction: "Correct the reported route configuration or filesystem locations and run fadeno check again.",
    })}\n`;
    if (!diagnostic || formatDiagnostic(diagnostic) !== expectedDiagnostic || formatDiagnostic(diagnostic).includes(diagnosticProject) || formatDiagnostic(diagnostic).includes("ROUTE_MODULE_EXECUTED")) {
      throw new Error("FADENO_ROUTING_STRUCTURED_DIAGNOSTIC");
    }
    if (existsSync(join(diagnosticProject, ".fadeno"))) throw new Error("FADENO_ROUTING_REFUSED_PLAN_WROTE_OUTPUT");
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

const fallbackProject = createProject(["shop/sale/page.tsx", "shop/[id]/details/page.tsx"]);
try {
  const output = generateRoutes(fallbackProject, await loadConfig(fallbackProject)).output;
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")) as RouteManifest;
  const match = matchRoutePathname(manifest, "/shop/sale/details");
  if (match?.route.id !== "/shop/[id]/details" || match.parameters["id"] !== "sale") {
    throw new Error("FADENO_ROUTING_STATIC_DEAD_END_FALLBACK");
  }
} finally { rmSync(fallbackProject, { recursive: true, force: true }); }

const hiddenRoutes = Object.defineProperty({}, "routes", { value: { root: "src/routes" }, enumerable: false });
const hiddenRoot = { routes: Object.defineProperty({ extra: true }, "root", { value: "src/routes", enumerable: false }) };
const topSymbol = { [Symbol("extra")]: true };
const nestedSymbol = { routes: { root: "src/routes", [Symbol("extra")]: true } };
for (const invalid of [null, [], new (class Config {})(), new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }), hiddenRoutes, hiddenRoot, topSymbol, nestedSymbol, { unknown: true }, { get routes() { return { root: "src/routes" }; } }, { routes: { get root() { return "src/routes"; } } }, { routes: null }, { routes: "src/routes" }, { routes: {} }, { routes: { root: 1 } }, { routes: { root: "src/routes", extra: true } }]) {
  expectError(() => normalizeConfig(invalid), "FADENO_CONFIG");
}
try { normalizeConfig({ unknown: true }); } catch (error) {
  const expected = `${JSON.stringify({
    id: "FADENO_CONFIG_SHAPE",
    severity: "error",
    summary: "Configuration violation: shape",
    locations: ["fadeno.config.ts"],
    sourceRanges: [{ path: "fadeno.config.ts", range: null }],
    explanation: "https://fadeno.dev/diagnostics/config/shape",
    correction: "Export one plain configuration object with only accepted fields.",
  })}\n`;
  if (!(error instanceof FadenoDiagnosticError) || formatDiagnostic(error) !== expected) {
    throw new Error("FADENO_ROUTING_CONFIG_DIAGNOSTIC");
  }
}

const noRoutes = mkdtempSync(join(tmpdir(), "fadeno-v1-routing-empty-"));
try {
  writeFileSync(join(noRoutes, "fadeno.config.ts"), "export default {};\n");
  const config = await loadConfig(noRoutes);
  let routesRequired = false;
  try { generateRoutes(noRoutes, config); } catch (error) {
    const expected = `${JSON.stringify({
      id: "FADENO_GENERATION_ROUTES_REQUIRED",
      severity: "error",
      summary: "Route generation violation: routes required",
      locations: [".fadeno/routes"],
      sourceRanges: [{ path: ".fadeno/routes", range: null }],
      explanation: "https://fadeno.dev/diagnostics/generation/routes-required",
      correction: "Correct the route source or generated-output ownership issue and run fadeno check again.",
    })}\n`;
    if (!(error instanceof FadenoDiagnosticError) || formatDiagnostic(error) !== expected) throw error;
    routesRequired = true;
  }
  if (!routesRequired) throw new Error("FADENO_ROUTING_EXPECTED:ROUTES_REQUIRED");
} finally { rmSync(noRoutes, { recursive: true, force: true }); }

const firstPublicationFailure = createProject(["page.tsx"]);
try {
  const config = await loadConfig(firstPublicationFailure);
  expectError(
    () => generateRoutes(firstPublicationFailure, config, undefined, undefined, undefined, () => { throw new Error("first publication validation failed"); }),
    "first publication validation failed",
  );
  if (readdirSync(join(firstPublicationFailure, ".fadeno")).some((name) => name === "routes" || name.startsWith("routes.previous-"))) {
    throw new Error("FADENO_ROUTING_FIRST_PUBLICATION_ROLLBACK");
  }
} finally { rmSync(firstPublicationFailure, { recursive: true, force: true }); }

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

for (const child of ["index.d.ts", "index.js", "manifest.json", "owner.json"] as const) {
  const project = createProject(["page.tsx"]);
  const external = join(project, `external-${child.replaceAll(".", "-")}`);
  try {
    const config = await loadConfig(project);
    const output = generateRoutes(project, config).output;
    const childPath = join(output, child);
    writeFileSync(external, readFileSync(childPath));
    rmSync(childPath);
    symlinkSync(external, childPath);
    expectError(() => generateRoutes(project, config), "FADENO_GENERATION_OUTPUT_CHILD_TYPE");
  } finally { rmSync(project, { recursive: true, force: true }); }
}

const malformed = createProject(["page.tsx"]);
try {
  const config = await loadConfig(malformed);
  const output = generateRoutes(malformed, config).output;
  const manifestPath = join(output, "manifest.json");
  writeFileSync(manifestPath, "{\n");
  const ownerPath = join(output, "owner.json");
  const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { files: { path: string; sha256: string }[] };
  owner.files.find(({ path }) => path === "manifest.json")!.sha256 = createHash("sha256").update("{\n").digest("hex");
  writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`);
  expectError(() => generateRoutes(malformed, config), "FADENO_GENERATION_OUTPUT_MANIFEST");
} finally { rmSync(malformed, { recursive: true, force: true }); }

const malformedOwner = createProject(["page.tsx"]);
try {
  const config = await loadConfig(malformedOwner);
  const output = generateRoutes(malformedOwner, config).output;
  const ownerPath = join(output, "owner.json");
  const original = JSON.parse(readFileSync(ownerPath, "utf8")) as { files: unknown[] } & Record<string, unknown>;
  const mutations: unknown[][] = [
    [null, null, null],
    [1, "two", []],
    [original.files[0], original.files[0], original.files[2]],
    [{ ...(original.files[0] as object), extra: true }, original.files[1], original.files[2]],
  ];
  for (const files of mutations) {
    writeFileSync(ownerPath, `${JSON.stringify({ ...original, files }, null, 2)}\n`);
    let rejected = false;
    try { generateRoutes(malformedOwner, config); } catch (error) {
      const expected = `${JSON.stringify({
        id: "FADENO_GENERATION_OUTPUT_OWNER",
        severity: "error",
        summary: "Route generation violation: output owner",
        locations: [".fadeno/routes"],
        sourceRanges: [{ path: ".fadeno/routes", range: null }],
        explanation: "https://fadeno.dev/diagnostics/generation/output-owner",
        correction: "Correct the route source or generated-output ownership issue and run fadeno check again.",
      })}\n`;
      if (!(error instanceof FadenoDiagnosticError) || formatDiagnostic(error) !== expected) throw error;
      rejected = true;
    }
    if (!rejected) throw new Error("FADENO_ROUTING_EXPECTED:OUTPUT_OWNER");
  }
} finally { rmSync(malformedOwner, { recursive: true, force: true }); }

console.log("V1 production routing passed (config, discovery, transaction, stock types, app-bound links, metadata matcher)");
