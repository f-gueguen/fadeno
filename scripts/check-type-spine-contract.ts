import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  stableTypeSpineContract,
  TYPE_SPINE_CANDIDATE_ABI,
  TYPE_SPINE_INPUT,
  TYPE_SPINE_INVALID_FIXTURES,
  TYPE_SPINE_VALID_FIXTURES,
} from "../experiments/type-spine/contract.ts";
import { readJsonDocument } from "./lib/experiment-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experimentRoot = join(root, "experiments/type-spine");
const fixturesRoot = join(experimentRoot, "fixtures");
const golden = readFileSync(join(experimentRoot, "contract.golden.json"), "utf8");

if (stableTypeSpineContract() !== golden) {
  throw new Error("K0-07 type-spine contract differs from its golden snapshot");
}

const actualSources = ["valid", "invalid"].flatMap((directory) =>
  readdirSync(join(fixturesRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "README.md") return [];
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.isSymbolicLink()) {
      throw new Error(`K0-07 fixture entry differs: ${directory}/${entry.name}`);
    }
    return relative(fixturesRoot, join(fixturesRoot, directory, entry.name))
      .split(sep).join("/");
  })
).sort();
const declaredSources = [
  ...TYPE_SPINE_VALID_FIXTURES,
  ...Object.keys(TYPE_SPINE_INVALID_FIXTURES),
].sort();
if (JSON.stringify(actualSources) !== JSON.stringify(declaredSources)) {
  throw new Error("K0-07 type-spine fixture inventory differs");
}

for (const path of actualSources) {
  const source = readFileSync(join(fixturesRoot, path), "utf8");
  if (
    source.includes("@ts-ignore") || source.includes("@ts-expect-error") ||
    !source.includes('../../generated/candidate-types.ts')
  ) throw new Error(`K0-07 fixture can suppress or bypass diagnostics: ${path}`);
}

const safeIdentifier = /^[A-Za-z][A-Za-z0-9]*$/u;
const safeId = /^[a-z][a-z0-9-]*$/u;
const scalarTypes = new Set(["string", "number", "boolean"]);
type SemanticEntry = Readonly<{ key: string; type: string }>;
type SemanticInput = Readonly<{
  routes: readonly Readonly<{ id: string; parameters: readonly SemanticEntry[] }>[];
  forms: readonly Readonly<{ id: string; fields: readonly SemanticEntry[] }>[];
  context: readonly SemanticEntry[];
}>;
function validateInput(input: SemanticInput): void {
  const ids = [...input.routes.map((item) => item.id), ...input.forms.map((item) => item.id)];
  if (new Set(ids).size !== ids.length || ids.some((id) => !safeId.test(id))) {
    throw new Error("K0-07 semantic ids differ");
  }
  const groups = [
    ...input.routes.map((item) => item.parameters),
    ...input.forms.map((item) => item.fields),
    input.context,
  ];
  for (const group of groups) {
    const keys = group.map((item) => item.key);
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => !safeIdentifier.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)) ||
      group.some((item) => !scalarTypes.has(item.type))
    ) throw new Error("K0-07 semantic fields differ");
  }
}
validateInput(TYPE_SPINE_INPUT);

for (const mutation of [
  { ...TYPE_SPINE_INPUT, routes: [...TYPE_SPINE_INPUT.routes, TYPE_SPINE_INPUT.routes[0]] },
  { ...TYPE_SPINE_INPUT, routes: [{ id: 'bad";export type Leak=never;//', parameters: [] }] },
  { ...TYPE_SPINE_INPUT, routes: [{ id: "safe", parameters: [{ key: "__proto__", type: "string" }] }] },
  { ...TYPE_SPINE_INPUT, context: [{ key: "line\nbreak", type: "string" }] },
] as readonly SemanticInput[]) {
  try {
    validateInput(mutation);
    throw new Error("K0-07 hostile semantic mutation was accepted");
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("mutation was accepted")) throw error;
  }
}

if (TYPE_SPINE_CANDIDATE_ABI !== "generated/candidate-types.ts") {
  throw new Error("K0-07 private candidate ABI path differs");
}
const registry = readJsonDocument(join(root, "experiments/registry.json"));
const entry = registry.experiments.find((item: { id: string }) => item.id === "type-spine");
const packageJson = readJsonDocument(join(root, "package.json"));
if (entry?.status !== "planned" || packageJson.scripts["experiment:type-spine"] !== undefined) {
  throw new Error("K0-07 pre-candidate contract exposed an experiment command");
}

console.log("type-spine pre-candidate contract passed (4 valid, 4 invalid fixtures)");
