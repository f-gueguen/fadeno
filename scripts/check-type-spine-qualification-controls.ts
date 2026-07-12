import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TypeSpineInput } from "../experiments/type-spine/contract.ts";
import { verifyQualificationControls } from "../experiments/type-spine/qualification-controls.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(
  readFileSync(join(root, "experiments/type-spine/qualification-corpus.json"), "utf8"),
) as { inputA: TypeSpineInput };

await verifyQualificationControls(corpus.inputA);
