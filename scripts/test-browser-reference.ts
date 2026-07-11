import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyFrozenReference } from "./lib/browser-reference-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const document = readFileSync(join(root, "experiments/reference-environment.json"));
const golden = readFileSync(join(root, "experiments/reference-environment.sha256"), "utf8");
verifyFrozenReference(document, golden);

let detected = 0;
for (const [label, candidate, digest] of [
  ["document", Buffer.concat([document, Buffer.from("\n")]), golden],
  ["digest", document, `${"0".repeat(64)}\n`],
  ["digest shape", document, golden.trim()],
] as const) {
  try {
    verifyFrozenReference(candidate, digest);
    throw new Error(`browser reference mutation was not detected: ${label}`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith(label)) throw error;
  }
  detected += 1;
}

console.log(`browser reference negative tests passed (${detected} mutations)`);
