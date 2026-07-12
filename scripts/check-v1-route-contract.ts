import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import Ajv2020Module from "ajv/dist/2020.js";

import {
  assertRouteManifestSemantics,
  discoverRouteManifest,
  routeHref,
  RouteContractError,
  stableRouteManifest,
  type RouteManifest,
} from "../prototypes/v1/routing-contract/contract.ts";
import {
  routeTypeModel,
  type RouteHrefInput,
  type RouteHrefFunction,
} from "../prototypes/v1/routing-contract/types/generated-routes.ts";

const root = join(import.meta.dirname, "..");
const contractRoot = join(root, "prototypes/v1/routing-contract");
const schema = JSON.parse(readFileSync(join(contractRoot, "route-manifest.schema.json"), "utf8"));
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
};
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const file = "export {};\n";

type FixtureEntry = readonly [path: string, kind?: "directory" | "file"];

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function materialize(project: string, entries: readonly FixtureEntry[], seed = 1): void {
  mkdirSync(join(project, "src/routes"), { recursive: true });
  for (const [path, kind = "file"] of shuffled(entries, seed)) {
    const absolute = join(project, "src/routes", path);
    if (kind === "directory") mkdirSync(absolute, { recursive: true });
    else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, file);
    }
  }
}

function withProject<T>(entries: readonly FixtureEntry[], run: (project: string) => T, seed = 1): T {
  const project = mkdtempSync(join(tmpdir(), "fadeno-v1-route-"));
  try {
    materialize(project, entries, seed);
    return run(project);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function expectCode(code: string, entries: readonly FixtureEntry[], locations?: readonly string[]): void {
  withProject(entries, (project) => {
    try {
      discoverRouteManifest(project, { root: "src/routes" });
    } catch (error) {
      if (error instanceof RouteContractError && error.code === code &&
          error.locations.every((path) => !path.startsWith("/")) &&
          (locations === undefined || JSON.stringify(error.locations) === JSON.stringify([...locations].sort()))) return;
      throw error;
    }
    throw new Error(`FADENO_V1_ROUTE_EXPECTED:${code}`);
  });
}

const validEntries: readonly FixtureEntry[] = [
  ["layout.tsx"], ["not-found.tsx"], ["error.tsx"], ["page.tsx"],
  ["accounts/[accountId]/page.tsx"],
  ["teams/layout.tsx"], ["teams/[teamId]/members/[memberId]/page.tsx"],
  ["files/[...parts]/handler.ts"],
  ["docs/about/page.tsx"], ["docs/[slug]/page.tsx"], ["docs/[...parts]/page.tsx"],
];

const manifests = Array.from({ length: 7 }, (_, index) => withProject(validEntries, (project) =>
  stableRouteManifest(discoverRouteManifest(project, { root: "src/routes" })), index + 1));
if (new Set(manifests).size !== 1) throw new Error("FADENO_V1_ROUTE_NONDETERMINISTIC");
const manifest = JSON.parse(manifests[0]!) as RouteManifest;
if (!validate(manifest)) throw new Error(`FADENO_V1_ROUTE_SCHEMA:${JSON.stringify(validate.errors)}`);
assertRouteManifestSemantics(manifest);
if (manifests[0]!.includes(tmpdir()) || manifests[0]!.includes("\\")) throw new Error("FADENO_V1_ROUTE_HOST_PATH");
const ids = manifest.routes.map(({ id }) => id);
if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) throw new Error("FADENO_V1_ROUTE_ORDER");
const member = manifest.routes.find(({ id }) => id === "/teams/[teamId]/members/[memberId]");
if (JSON.stringify(member?.layouts) !== JSON.stringify(["src/routes/layout.tsx", "src/routes/teams/layout.tsx"]) ||
    member?.notFound !== "src/routes/not-found.tsx" || member.error !== "src/routes/error.tsx") {
  throw new Error("FADENO_V1_ROUTE_INHERITANCE");
}

const manifestTypeModel = Object.fromEntries(manifest.routes.map((route) => [
  route.id,
  Object.fromEntries(route.parameters.map(({ name, kind }) => [name, kind === "rest" ? "rest" : "single"])),
]));
if (JSON.stringify(manifestTypeModel) !== JSON.stringify(routeTypeModel)) throw new Error("FADENO_V1_ROUTE_TYPE_MODEL_LINK");

const publicRouteHref = ((input: RouteHrefInput): string => routeHref(manifest, input)) as RouteHrefFunction;

const exactLinks = [
  [{ route: "/" }, "/"],
  [{ route: "/accounts/[accountId]", parameters: { accountId: "a/b ?#% ü !" } }, "/accounts/a%2Fb%20%3F%23%25%20%C3%BC%20%21"],
  [{ route: "/teams/[teamId]/members/[memberId]", parameters: { teamId: "one", memberId: "two" } }, "/teams/one/members/two"],
  [{ route: "/files/[...parts]", parameters: { parts: ["a/b", "two words"] } }, "/files/a%2Fb/two%20words"],
] as const satisfies readonly (readonly [RouteHrefInput, string])[];
for (const [input, expected] of exactLinks) {
  if (publicRouteHref(input) !== expected) throw new Error(`FADENO_V1_ROUTE_LINK:${expected}`);
}
for (const invalid of [
  { route: "/missing" },
  { route: "/", parameters: {} },
  { route: "/accounts/[accountId]" },
  { route: "/accounts/[accountId]", parameters: { accountId: "" } },
  { route: "/accounts/[accountId]", parameters: { accountId: ".." } },
  { route: "/accounts/[accountId]", parameters: { accountId: "ok", extra: "no" } },
  { route: "/files/[...parts]", parameters: { parts: [] } },
  { route: "/files/[...parts]", parameters: { parts: ["ok", "."] } },
  { route: "/accounts/[accountId]", parameters: { accountId: "\ud800" } },
  Object.assign(Object.create({ inherited: true }) as object, { route: "/" }),
]) {
  let refused = false;
  try { routeHref(manifest, invalid); } catch (error) { refused = error instanceof RouteContractError; }
  if (!refused) throw new Error("FADENO_V1_ROUTE_LINK_REFUSAL");
}

for (const [code, entries, locations] of [
  ["ROUTE_ROLE_COLLISION", [["page.tsx"], ["handler.ts"]], ["src/routes/handler.ts", "src/routes/page.tsx"]],
  ["DYNAMIC_SIBLING_COLLISION", [["[id]/page.tsx"], ["[slug]/page.tsx"]], ["src/routes/[id]", "src/routes/[slug]"]],
  ["REST_SIBLING_COLLISION", [["[...one]/page.tsx"], ["[...two]/page.tsx"]], ["src/routes/[...one]", "src/routes/[...two]"]],
  ["REST_NOT_TERMINAL", [["[...parts]/child/page.tsx"]], ["src/routes/[...parts]", "src/routes/[...parts]/child"]],
  ["PARAMETER_DUPLICATE", [["[id]/child/[id]/page.tsx"]]],
  ["PARAMETER_NAME", [["[constructor]/page.tsx"]]],
  ["SEGMENT_NAME", [["Upper/page.tsx"]]],
  ["SEGMENT_NAME", [["café/page.tsx"]]],
  ["SEGMENT_NAME", [["percent%20name/page.tsx"]]],
  ["SEGMENT_NAME", [["bad\\name/page.tsx"]]],
  ["UNSUPPORTED_ENTRY", [["page.ts"]]],
  ["UNSUPPORTED_ENTRY", [[".hidden"]]],
] as const) expectCode(code, entries as readonly FixtureEntry[], locations);

withProject([["page.tsx"]], (project) => {
  const outside = join(project, "outside.tsx");
  writeFileSync(outside, file);
  symlinkSync(outside, join(project, "src/routes", "layout.tsx"));
  try {
    discoverRouteManifest(project, { root: "src/routes" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:SYMLINK");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "SYMLINK") throw error;
  }
});
withProject([], (project) => {
  const outside = join(project, "outside-directory");
  mkdirSync(outside);
  writeFileSync(join(outside, "page.tsx"), file);
  symlinkSync(outside, join(project, "src/routes", "linked"));
  try {
    discoverRouteManifest(project, { root: "src/routes" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:DIRECTORY_SYMLINK");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "SYMLINK") throw error;
  }
});
withProject([], (project) => {
  mkdirSync(join(project, "real-routes"));
  symlinkSync(join(project, "real-routes"), join(project, "linked-routes"));
  try {
    discoverRouteManifest(project, { root: "linked-routes" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:ROOT_SYMLINK");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "SYMLINK") throw error;
  }
});
withProject([], (project) => {
  mkdirSync(join(project, "actual"));
  symlinkSync(join(project, "actual"), join(project, "linked"));
  try {
    discoverRouteManifest(project, { root: "linked/routes" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:INTERMEDIATE_SYMLINK");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "SYMLINK") throw error;
  }
});

withProject([["page.tsx"]], (project) => {
  for (const configured of ["", ".", "../routes", "src/../routes", "src/routes/..", "src/routes/.", "src\\routes", "/tmp/routes", "C:/routes", "src//routes", "src/\0routes"]) {
    try {
      discoverRouteManifest(project, { root: configured });
      throw new Error(`FADENO_V1_ROUTE_EXPECTED:ROOT_PATH:${configured}`);
    } catch (error) {
      if (!(error instanceof RouteContractError) || error.code !== "ROOT_PATH") throw error;
    }
  }
  try {
    discoverRouteManifest(project, { root: "src/routes", extra: true } as never);
    throw new Error("FADENO_V1_ROUTE_EXPECTED:CONFIG");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "CONFIG") throw error;
  }
  try {
    discoverRouteManifest(project, { root: "missing/routes" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:ROOT_MISSING");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "ROOT_MISSING") throw error;
  }
  writeFileSync(join(project, "route-file"), file);
  try {
    discoverRouteManifest(project, { root: "route-file" });
    throw new Error("FADENO_V1_ROUTE_EXPECTED:ROOT_NOT_DIRECTORY");
  } catch (error) {
    if (!(error instanceof RouteContractError) || error.code !== "ROOT_NOT_DIRECTORY") throw error;
  }
});

const missingProject = join(tmpdir(), `fadeno-v1-route-missing-${process.pid}`);
rmSync(missingProject, { recursive: true, force: true });
try {
  discoverRouteManifest(missingProject, { root: "src/routes" });
  throw new Error("FADENO_V1_ROUTE_EXPECTED:PROJECT_ROOT");
} catch (error) {
  if (!(error instanceof RouteContractError) || error.code !== "PROJECT_ROOT") throw error;
}

for (const mutate of [
  (value: any) => { value.visibility = "public"; },
  (value: any) => { value.routes[0].source = "/absolute/page.tsx"; },
  (value: any) => { value.routes[0].extra = true; },
  (value: any) => { value.routes[0].segments[0] = { kind: "unknown" }; },
  (value: any) => { value.routes[1].id = value.routes[0].id; },
  (value: any) => { value.routes[0].source = "src/routes/../page.tsx"; },
  (value: any) => { value.routes[0].source = "C:/src/routes/page.tsx"; },
  (value: any) => { value.routes[1].id = "/wrong"; },
  (value: any) => { value.routes[1].parameters = []; },
  (value: any) => {
    const route = value.routes.find(({ id }: { id: string }) => id === "/files/[...parts]");
    route.segments.push({ kind: "static", value: "child" });
  },
  (value: any) => {
    const route = value.routes.find(({ id }: { id: string }) => id === "/accounts/[accountId]");
    route.segments[1].name = "constructor";
  },
]) {
  const candidate = structuredClone(manifest);
  mutate(candidate);
  let accepted = validate(candidate);
  if (accepted) {
    try { assertRouteManifestSemantics(candidate as RouteManifest); } catch { accepted = false; }
  }
  if (accepted) throw new Error("FADENO_V1_ROUTE_SCHEMA_MUTATION");
}

const typeSources = ["generated-routes.ts", "valid.ts", "invalid.ts"].map((name) => readFileSync(join(contractRoot, "types", name), "utf8"));
if (typeSources.some((source) => source.includes("@ts-ignore"))) throw new Error("FADENO_V1_ROUTE_TYPE_IGNORE");
const digest = createHash("sha256").update(manifests[0]!).digest("hex");
console.log(`V1 route contract passed (${manifest.routes.length} routes, deterministic ${digest.slice(0, 12)}, filesystem/type/link refusals)`);
