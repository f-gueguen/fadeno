import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TypeSpineInput } from "./contract.ts";
import { generateTypeSpine } from "./generator.ts";

const root = dirname(fileURLToPath(import.meta.url));
const [mode, variant, output] = process.argv.slice(2);
if (mode !== "generator" || (variant !== "A" && variant !== "B") || !output) {
  throw new Error("FADENO_TYPE_SPINE_SAMPLE_USAGE");
}
const corpus = JSON.parse(readFileSync(join(root, "qualification-corpus.json"), "utf8")) as {
  inputA: TypeSpineInput;
  inputB: TypeSpineInput;
};
const result = generateTypeSpine(variant === "A" ? corpus.inputA : corpus.inputB, output);
const bytes = readFileSync(join(output, "generated/candidate-types.ts"));
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  variant,
  replacements: result.replacements,
  sha256: createHash("sha256").update(bytes).digest("hex"),
})}\n`);
