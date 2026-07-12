import type { RouteManifest, RouteManifestEntry, RouteSegment } from "./discovery.ts";

export type RouteMatch = Readonly<{
  route: RouteManifestEntry;
  parameters: Readonly<Record<string, string | readonly string[]>>;
}>;

type Candidate = Readonly<{
  match: RouteMatch;
  rank: readonly number[];
}>;

function decodeSegment(value: string): string | undefined {
  if ([...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point < 0x21 || point > 0x7e || character === "\\" || character === "/" || character === "?" || character === "#";
  })) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    return decoded === "" || decoded === "." || decoded === ".." ? undefined : decoded;
  } catch {
    return undefined;
  }
}

function compareRank(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function matchEntry(route: RouteManifestEntry, encoded: readonly string[], decoded: readonly string[]): Candidate | undefined {
  const parameters = Object.create(null) as Record<string, string | readonly string[]>;
  const rank: number[] = [];
  let inputIndex = 0;
  for (const segment of route.segments) {
    if (segment.kind === "rest") {
      if (inputIndex >= decoded.length) return undefined;
      parameters[segment.name] = Object.freeze(decoded.slice(inputIndex));
      rank.push(1);
      inputIndex = decoded.length;
      continue;
    }
    if (inputIndex >= decoded.length) return undefined;
    if (segment.kind === "static") {
      if (encoded[inputIndex] !== segment.value) return undefined;
      rank.push(3);
    } else {
      parameters[segment.name] = decoded[inputIndex]!;
      rank.push(2);
    }
    inputIndex += 1;
  }
  if (inputIndex !== decoded.length) return undefined;
  return {
    match: Object.freeze({ route, parameters: Object.freeze(parameters) }),
    rank,
  };
}

export function matchRoutePathname(manifest: RouteManifest, pathname: string): RouteMatch | undefined {
  if (pathname === "/") {
    const root = manifest.routes.find(({ segments }) => segments.length === 0);
    return root ? Object.freeze({ route: root, parameters: Object.freeze(Object.create(null) as Record<string, never>) }) : undefined;
  }
  if (!pathname.startsWith("/") || pathname.endsWith("/") || pathname.includes("//") || pathname.includes("?") || pathname.includes("#")) {
    return undefined;
  }
  const encoded = pathname.slice(1).split("/");
  const decoded: string[] = [];
  for (const segment of encoded) {
    const value = decodeSegment(segment);
    if (value === undefined) return undefined;
    decoded.push(value);
  }

  let selected: Candidate | undefined;
  for (const route of manifest.routes) {
    const candidate = matchEntry(route, encoded, decoded);
    if (candidate && (!selected || compareRank(candidate.rank, selected.rank) > 0)) selected = candidate;
  }
  return selected?.match;
}

export function segmentDirectoryName(segment: RouteSegment): string {
  if (segment.kind === "static") return segment.value;
  if (segment.kind === "parameter") return `[${segment.name}]`;
  return `[...${segment.name}]`;
}
