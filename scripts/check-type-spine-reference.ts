import { readdirSync } from "node:fs";
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
if (JSON.stringify(results) !== JSON.stringify(["README.md"])) {
  throw new Error("K0-08A must not contain immutable H3 results");
}

console.log(`type-spine reference contract passed (${reference.id}, no result)`);
