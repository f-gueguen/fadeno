import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { normalizeTypeSpineInput, renderTypeSpineCandidate } from "../experiments/type-spine/generator.ts";
import type { TypeSpineInput } from "../experiments/type-spine/contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(root, "experiments/type-spine/qualification-corpus.json");
const schema = JSON.parse(readFileSync(join(root, "experiments/type-spine/qualification-corpus.schema.json"), "utf8"));
const corpusBytes = readFileSync(corpusPath, "utf8");
const corpus = JSON.parse(corpusBytes) as {
  changedRouteId: string;
  inputA: TypeSpineInput;
  inputB: TypeSpineInput;
  topology: readonly { routeId: string; parentRouteId: string | null; depth: number }[];
};
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => {
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
};
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(corpus)) throw new Error(`FADENO_TYPE_SPINE_CORPUS_SCHEMA:${JSON.stringify(validate.errors)}`);

const a = normalizeTypeSpineInput(corpus.inputA);
const b = normalizeTypeSpineInput(corpus.inputB);
const ids = new Set(a.routes.map(({ id }) => id));
if (ids.size !== 1_000 || b.routes.length !== 1_000) throw new Error("FADENO_TYPE_SPINE_CORPUS_COUNT");
if (corpus.topology.length !== ids.size || new Set(corpus.topology.map(({ routeId }) => routeId)).size !== ids.size) {
  throw new Error("FADENO_TYPE_SPINE_CORPUS_TOPOLOGY_COUNT");
}
const depthById = new Map<string, number>();
for (const node of corpus.topology) {
  if (!ids.has(node.routeId) || depthById.has(node.routeId)) throw new Error("FADENO_TYPE_SPINE_CORPUS_TOPOLOGY_ID");
  if (node.parentRouteId === null) {
    if (node.depth !== 0) throw new Error("FADENO_TYPE_SPINE_CORPUS_TOPOLOGY_DEPTH");
  } else {
    const parentDepth = depthById.get(node.parentRouteId);
    if (parentDepth === undefined || node.depth !== parentDepth + 1) throw new Error("FADENO_TYPE_SPINE_CORPUS_TOPOLOGY_PARENT");
  }
  depthById.set(node.routeId, node.depth);
}
if (![...depthById.values()].some((depth) => depth >= 4)) throw new Error("FADENO_TYPE_SPINE_CORPUS_NOT_NESTED");

const changed = a.routes.filter((route, index) => JSON.stringify(route) !== JSON.stringify(b.routes[index]));
if (changed.length !== 1 || changed[0]?.id !== corpus.changedRouteId) throw new Error("FADENO_TYPE_SPINE_CORPUS_DELTA");
if (JSON.stringify(a.forms) !== JSON.stringify(b.forms) || JSON.stringify(a.context) !== JSON.stringify(b.context)) {
  throw new Error("FADENO_TYPE_SPINE_CORPUS_NON_ROUTE_DELTA");
}
const parameterized = a.routes.filter(({ parameters }) => parameters.length > 0).length;
const scalarCoverage = new Set(a.routes.flatMap(({ parameters }) => parameters.map(({ type }) => type)));
if (parameterized < 750 || scalarCoverage.size !== 3) throw new Error("FADENO_TYPE_SPINE_CORPUS_COVERAGE");
const outputA = renderTypeSpineCandidate(a);
const outputB = renderTypeSpineCandidate(b);
if (outputA === outputB) throw new Error("FADENO_TYPE_SPINE_CORPUS_OUTPUT_DELTA");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
console.log(`type-spine qualification corpus passed (1000 routes, ${parameterized} parameterized, A:${hash(outputA)}, B:${hash(outputB)})`);
