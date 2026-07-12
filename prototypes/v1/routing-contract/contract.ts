import {
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";

export type RouteSegment =
  | Readonly<{ kind: "static"; value: string }>
  | Readonly<{ kind: "parameter"; name: string }>
  | Readonly<{ kind: "rest"; name: string }>;

export type RouteParameter = Readonly<{
  name: string;
  kind: "single" | "rest";
}>;

export type RouteManifestEntry = Readonly<{
  id: string;
  kind: "page" | "handler";
  source: string;
  segments: readonly RouteSegment[];
  parameters: readonly RouteParameter[];
  layouts: readonly string[];
  notFound: string | null;
  error: string | null;
}>;

export type RouteManifest = Readonly<{
  schemaVersion: 1;
  visibility: "internal-route-manifest";
  root: string;
  routes: readonly RouteManifestEntry[];
}>;

export type RouteConfig = Readonly<{ root: string }>;

export class RouteContractError extends Error {
  readonly code: string;
  readonly locations: readonly string[];

  constructor(code: string, locations: readonly string[] = []) {
    const ordered = [...locations].sort(compareText);
    super(`FADENO_ROUTE_${code}${ordered.length === 0 ? "" : `:${ordered.join(":")}`}`);
    this.name = "RouteContractError";
    this.code = code;
    this.locations = ordered;
  }
}

const roleNames = new Set(["page.tsx", "handler.ts", "layout.tsx", "not-found.tsx", "error.tsx"]);
const staticSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const parameterSegment = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/u;
const restSegment = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/u;
const forbiddenParameters = new Set(["__proto__", "constructor", "prototype"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, locations: readonly string[] = []): never {
  throw new RouteContractError(code, locations);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function posixRelative(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
}

function assertRouteRoot(projectRoot: string, configuredRoot: string): string {
  if (
    configuredRoot.length === 0 || configuredRoot.includes("\0") || configuredRoot.includes("\\") ||
    isAbsolute(configuredRoot) || /^[A-Za-z]:/u.test(configuredRoot)
  ) fail("ROOT_PATH");
  const parts = configuredRoot.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) fail("ROOT_PATH");

  let canonicalProject: string;
  try {
    canonicalProject = realpathSync(projectRoot);
  } catch {
    fail("PROJECT_ROOT");
  }
  let cursor = canonicalProject;
  for (const part of parts) {
    cursor = join(cursor, part);
    let status;
    try {
      status = lstatSync(cursor);
    } catch {
      fail("ROOT_MISSING", [posixRelative(canonicalProject, cursor)]);
    }
    if (status.isSymbolicLink()) fail("SYMLINK", [posixRelative(canonicalProject, cursor)]);
  }
  if (!lstatSync(cursor).isDirectory()) fail("ROOT_NOT_DIRECTORY", [configuredRoot]);
  if (realpathSync(cursor) !== cursor) fail("ROOT_ESCAPE", [configuredRoot]);
  return cursor;
}

function parseSegment(name: string, location: string): RouteSegment {
  const parameter = name.match(parameterSegment)?.[1];
  if (parameter !== undefined) {
    if (forbiddenParameters.has(parameter)) fail("PARAMETER_NAME", [location]);
    return { kind: "parameter", name: parameter };
  }
  const rest = name.match(restSegment)?.[1];
  if (rest !== undefined) {
    if (forbiddenParameters.has(rest)) fail("PARAMETER_NAME", [location]);
    return { kind: "rest", name: rest };
  }
  if (!staticSegment.test(name)) fail("SEGMENT_NAME", [location]);
  return { kind: "static", value: name };
}

function routeId(segments: readonly RouteSegment[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.map((segment) => {
    if (segment.kind === "static") return segment.value;
    if (segment.kind === "parameter") return `[${segment.name}]`;
    return `[...${segment.name}]`;
  }).join("/")}`;
}

type InheritedRoles = Readonly<{
  layouts: readonly string[];
  notFound: string | null;
  error: string | null;
}>;

export function discoverRouteManifest(projectRoot: string, config: RouteConfig): RouteManifest {
  if (!isPlainRecord(config) || Object.keys(config).length !== 1 || typeof config["root"] !== "string") fail("CONFIG");
  const root = assertRouteRoot(projectRoot, config.root);
  const canonicalProject = realpathSync(projectRoot);
  const routes: RouteManifestEntry[] = [];
  const identities = new Map<string, string>();

  const walk = (
    directory: string,
    segments: readonly RouteSegment[],
    parameterNames: ReadonlySet<string>,
    inherited: InheritedRoles,
    insideRest: boolean,
  ): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      fail("READ_DIRECTORY", [posixRelative(canonicalProject, directory)]);
    }
    entries.sort((left, right) => compareText(left.name, right.name));

    const roles = new Map<string, string>();
    const children: { path: string; source: string; segment: RouteSegment }[] = [];
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const source = posixRelative(canonicalProject, absolute);
      let status;
      try {
        status = lstatSync(absolute);
      } catch {
        fail("ENTRY_STAT", [source]);
      }
      if (entry.isSymbolicLink() || status.isSymbolicLink()) fail("SYMLINK", [source]);
      if (entry.isFile()) {
        if (!roleNames.has(entry.name)) fail("UNSUPPORTED_ENTRY", [source]);
        roles.set(entry.name, source);
      } else if (entry.isDirectory()) {
        if (insideRest) fail("REST_NOT_TERMINAL", [posixRelative(canonicalProject, directory), source]);
        children.push({ path: absolute, source, segment: parseSegment(entry.name, source) });
      } else {
        fail("UNSUPPORTED_ENTRY", [source]);
      }
    }

    const dynamicChildren = children.filter(({ segment }) => segment.kind === "parameter");
    if (dynamicChildren.length > 1) fail("DYNAMIC_SIBLING_COLLISION", dynamicChildren.map(({ source }) => source));
    const restChildren = children.filter(({ segment }) => segment.kind === "rest");
    if (restChildren.length > 1) fail("REST_SIBLING_COLLISION", restChildren.map(({ source }) => source));
    const page = roles.get("page.tsx");
    const handler = roles.get("handler.ts");
    if (page && handler) fail("ROUTE_ROLE_COLLISION", [page, handler]);

    const layout = roles.get("layout.tsx");
    const nextInherited: InheritedRoles = {
      layouts: layout ? [...inherited.layouts, layout] : inherited.layouts,
      notFound: roles.get("not-found.tsx") ?? inherited.notFound,
      error: roles.get("error.tsx") ?? inherited.error,
    };
    const source = page ?? handler;
    if (source) {
      const id = routeId(segments);
      const previous = identities.get(id);
      if (previous) fail("ROUTE_ID_COLLISION", [previous, source]);
      identities.set(id, source);
      routes.push({
        id,
        kind: page ? "page" : "handler",
        source,
        segments,
        parameters: segments.flatMap((segment): readonly RouteParameter[] => {
          if (segment.kind === "parameter") return [{ name: segment.name, kind: "single" }];
          if (segment.kind === "rest") return [{ name: segment.name, kind: "rest" }];
          return [];
        }),
        layouts: nextInherited.layouts,
        notFound: nextInherited.notFound,
        error: nextInherited.error,
      });
    }

    for (const child of children) {
      const name = child.segment.kind === "static" ? undefined : child.segment.name;
      if (name && parameterNames.has(name)) fail("PARAMETER_DUPLICATE", [child.source]);
      const nextNames = new Set(parameterNames);
      if (name) nextNames.add(name);
      walk(child.path, [...segments, child.segment], nextNames, nextInherited, child.segment.kind === "rest");
    }
  };

  walk(root, [], new Set(), { layouts: [], notFound: null, error: null }, false);
  routes.sort((left, right) => compareText(left.id, right.id));
  return Object.freeze({ schemaVersion: 1, visibility: "internal-route-manifest", root: config.root, routes });
}

export function stableRouteManifest(manifest: RouteManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function safeManifestPath(path: unknown, suffix = ""): path is string {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || path.includes("\\") ||
      path.startsWith("/") || /^[A-Za-z]:/u.test(path) || !path.endsWith(suffix)) return false;
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function assertRouteManifestSemantics(manifest: RouteManifest): void {
  if (!safeManifestPath(manifest.root)) fail("MANIFEST_ROOT");
  const identities = new Set<string>();
  const sources = new Set<string>();
  let previousId: string | undefined;
  for (const route of manifest.routes) {
    if (identities.has(route.id) || (previousId !== undefined && compareText(previousId, route.id) >= 0)) fail("MANIFEST_ORDER");
    identities.add(route.id);
    previousId = route.id;
    if (!safeManifestPath(route.source, route.kind === "page" ? "/page.tsx" : "/handler.ts") || sources.has(route.source)) {
      fail("MANIFEST_SOURCE");
    }
    sources.add(route.source);
    if (route.id !== routeId(route.segments)) fail("MANIFEST_ID");

    const segmentDirectories = route.segments.map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "parameter") return `[${segment.name}]`;
      return `[...${segment.name}]`;
    });
    const routeDirectory = [manifest.root, ...segmentDirectories].join("/");
    const expectedSource = `${routeDirectory}/${route.kind === "page" ? "page.tsx" : "handler.ts"}`;
    if (route.source !== expectedSource) fail("MANIFEST_SOURCE_OWNERSHIP");
    const ancestors = Array.from({ length: segmentDirectories.length + 1 }, (_, index) =>
      [manifest.root, ...segmentDirectories.slice(0, index)].join("/"));

    const names = new Set<string>();
    const expectedParameters: RouteParameter[] = [];
    for (const [index, segment] of route.segments.entries()) {
      if (segment.kind === "static") {
        if (!staticSegment.test(segment.value)) fail("MANIFEST_SEGMENT");
        continue;
      }
      if (!parameterSegment.test(`[${segment.name}]`) || forbiddenParameters.has(segment.name) || names.has(segment.name)) {
        fail("MANIFEST_PARAMETER");
      }
      names.add(segment.name);
      if (segment.kind === "rest" && index !== route.segments.length - 1) fail("MANIFEST_REST");
      expectedParameters.push({ name: segment.name, kind: segment.kind === "rest" ? "rest" : "single" });
    }
    if (JSON.stringify(route.parameters) !== JSON.stringify(expectedParameters)) fail("MANIFEST_PARAMETERS");
    if (route.layouts.some((path) => !safeManifestPath(path, "/layout.tsx")) || new Set(route.layouts).size !== route.layouts.length ||
        (route.notFound !== null && !safeManifestPath(route.notFound, "/not-found.tsx")) ||
        (route.error !== null && !safeManifestPath(route.error, "/error.tsx"))) {
      fail("MANIFEST_ROLE_SOURCE");
    }
    let previousLayoutIndex = -1;
    for (const layout of route.layouts) {
      const index = ancestors.indexOf(layout.slice(0, -"/layout.tsx".length));
      if (index <= previousLayoutIndex) fail("MANIFEST_LAYOUT_OWNERSHIP");
      previousLayoutIndex = index;
    }
    for (const [role, suffix] of [[route.notFound, "/not-found.tsx"], [route.error, "/error.tsx"]] as const) {
      if (role !== null && !ancestors.includes(role.slice(0, -suffix.length))) fail("MANIFEST_ROLE_OWNERSHIP");
    }
  }
}

function encodePathValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") fail("LINK_PARAMETER");
  try {
    return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
      `%${character.codePointAt(0)!.toString(16).toUpperCase()}`);
  } catch {
    fail("LINK_PARAMETER");
  }
}

export function routeHref(manifest: RouteManifest, input: unknown): string {
  if (!isPlainRecord(input)) fail("LINK_INPUT");
  const record = input;
  if (typeof record["route"] !== "string") fail("LINK_INPUT");
  const route = manifest.routes.find(({ id }) => id === record["route"]);
  if (!route) fail("LINK_ROUTE");
  const expectedKeys = route.parameters.length === 0 ? ["route"] : ["route", "parameters"];
  if (Object.keys(record).sort(compareText).join("\0") !== expectedKeys.sort(compareText).join("\0")) fail("LINK_INPUT");
  const parameters = record["parameters"];
  if (route.parameters.length === 0) return route.id;
  if (!isPlainRecord(parameters)) fail("LINK_PARAMETERS");
  const values = parameters;
  const expectedParameters = route.parameters.map(({ name }) => name).sort(compareText);
  if (Object.keys(values).sort(compareText).join("\0") !== expectedParameters.join("\0")) fail("LINK_PARAMETERS");

  const encoded = route.segments.flatMap((segment): readonly string[] => {
    if (segment.kind === "static") return [segment.value];
    if (segment.kind === "parameter") return [encodePathValue(values[segment.name])];
    const rest = values[segment.name];
    if (!Array.isArray(rest) || rest.length === 0) fail("LINK_PARAMETER");
    return rest.map(encodePathValue);
  });
  return `/${encoded.join("/")}`;
}
