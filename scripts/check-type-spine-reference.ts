import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadTypeSpineReference,
  verifyTypeSpineReferenceSemantics,
} from "./lib/type-spine-reference.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = loadTypeSpineReference(root);
verifyTypeSpineReferenceSemantics(root, reference);

const results = readdirSync(join(root, "experiments/type-spine/results")).sort();
const registry = JSON.parse(readFileSync(join(root, "experiments/registry.json"), "utf8")) as {
  experiments: readonly { id: string; status: string }[];
};
const status = registry.experiments.find(({ id }) => id === "type-spine")?.status;
const expectedResults = status === "qualified"
  ? ["20260712T022123Z-122ba57-a1", "README.md"]
  : ["README.md"];
if (JSON.stringify(results) !== JSON.stringify(expectedResults)) {
  throw new Error("type-spine result inventory differs from its registry lifecycle");
}

console.log(`type-spine reference contract passed (${reference.id}, ${status})`);
