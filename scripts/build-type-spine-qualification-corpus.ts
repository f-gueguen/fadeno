import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TypeSpineEntry, TypeSpineInput, TypeSpineScalar } from "../experiments/type-spine/contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "experiments/type-spine/qualification-corpus.json");
const scalarTypes = ["string", "number", "boolean"] as const;

type Route = TypeSpineInput["routes"][number];

function entry(index: number, position: number): TypeSpineEntry {
  return {
    key: `p${String(position).padStart(2, "0")}`,
    type: scalarTypes[(index + position) % scalarTypes.length] as TypeSpineScalar,
  };
}

function route(index: number): Route {
  const parameterCount = index % 5 === 0 ? 0 : (index % 3) + 1;
  return {
    id: `r${String(index).padStart(4, "0")}`,
    parameters: Array.from({ length: parameterCount }, (_, position) => entry(index, position)),
  };
}

const routesA = Array.from({ length: 1_000 }, (_, index) => route(index));
const routesB = structuredClone(routesA);
routesB[999] = {
  ...routesB[999],
  parameters: [{ key: "p00", type: routesB[999].parameters[0]?.type === "boolean" ? "number" : "boolean" }],
};

const forms = Array.from({ length: 50 }, (_, index) => ({
  id: `f${String(index).padStart(3, "0")}`,
  fields: Array.from({ length: (index % 3) + 1 }, (_, position) => ({
    key: `v${String(position).padStart(2, "0")}`,
    type: scalarTypes[(index + position + 1) % scalarTypes.length],
  })),
}));

const context = Array.from({ length: 9 }, (_, index) => ({
  key: `c${String(index).padStart(2, "0")}`,
  type: scalarTypes[index % scalarTypes.length],
}));

const topology = routesA.map((candidate, index) => {
  const parentIndex = index === 0 ? null : Math.floor((index - 1) / 4);
  let depth = 0;
  for (let cursor = parentIndex; cursor !== null; cursor = cursor === 0 ? null : Math.floor((cursor - 1) / 4)) {
    depth += 1;
  }
  return {
    routeId: candidate.id,
    parentRouteId: parentIndex === null ? null : routesA[parentIndex].id,
    depth,
  };
});

const input = (routes: readonly Route[]): TypeSpineInput => ({
  schemaVersion: 1,
  visibility: "private-harness-control",
  routes,
  forms,
  context,
});

const document = {
  $schema: "https://fadeno.dev/schemas/experiment/type-spine-qualification-corpus-v1.json",
  schemaVersion: 1,
  visibility: "private-qualification-corpus",
  seed: "fadeno-k0-h3-corpus-v1",
  changedRouteId: "r0999",
  inputA: input(routesA),
  inputB: input(routesB),
  topology,
};
const bytes = `${JSON.stringify(document, null, 2)}\n`;
const digest = createHash("sha256").update(bytes).digest("hex");

if (process.argv[2] === "--check") {
  if (readFileSync(target, "utf8") !== bytes) {
    throw new Error("FADENO_TYPE_SPINE_CORPUS_DRIFT");
  }
  console.log(`type-spine corpus source passed (${routesA.length} routes, sha256:${digest})`);
} else if (process.argv.length === 2) {
  writeFileSync(target, bytes);
  console.log(`wrote ${target} (sha256:${digest})`);
} else {
  throw new Error("usage: build-type-spine-qualification-corpus.ts [--check]");
}
