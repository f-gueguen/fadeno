export const ROUTE_ARTIFACT_NAMES = [
  "app.ts",
  "index.d.ts",
  "index.js",
  "loader.ts",
  "manifest.json",
  "owner.json",
  "virtual.ts",
] as const;

export type RouteArtifactName = typeof ROUTE_ARTIFACT_NAMES[number];

export const ROUTE_ARTIFACT_OWNER_NODE_ID = "route:artifact-plan" as const;
export const ROUTE_ARTIFACT_MODULE = Object.freeze({
  namespace: "fadeno.routes" as const,
  version: 1 as const,
  transformation: "artifact-plan" as const,
});

export const ROUTE_ARTIFACT_DESCRIPTORS = Object.freeze(ROUTE_ARTIFACT_NAMES.map((name) => Object.freeze({
  name,
  id: `generated:routes-${name.replaceAll(".", "-")}`,
  path: `.fadeno/routes/${name}`,
})));
