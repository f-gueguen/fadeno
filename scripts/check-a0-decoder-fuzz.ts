import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateA0DecoderFuzzSummary } from "./lib/a0-decoder-fuzz.ts";

const root = process.cwd();
const arguments_ = ["--no-warnings", "--experimental-strip-types", "scripts/run-a0-decoder-fuzz.ts"];

function run(): Readonly<{ bytes: string; document: unknown }> {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal !== null || result.stderr !== "") {
    throw new Error(`FADENO_A0_DECODER_FUZZ_WORKER:${result.status ?? result.signal ?? "unknown"}\n${result.stderr}`);
  }
  let document: unknown;
  try { document = JSON.parse(result.stdout) as unknown; }
  catch { throw new Error("FADENO_A0_DECODER_FUZZ_OUTPUT"); }
  const errors = validateA0DecoderFuzzSummary(document);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return Object.freeze({ bytes: result.stdout, document });
}

const first = run();
const second = run();
if (first.bytes !== second.bytes) throw new Error("FADENO_A0_DECODER_FUZZ_NONDETERMINISTIC");

const expectedBytes = readFileSync(join(root, "evidence/a0/security/decoder-fuzz.json"), "utf8");
const expected = JSON.parse(expectedBytes) as unknown;
const expectedErrors = validateA0DecoderFuzzSummary(expected);
if (expectedErrors.length > 0) throw new Error(expectedErrors.join("\n"));
if (`${JSON.stringify(first.document, null, 2)}\n` !== expectedBytes) {
  throw new Error("FADENO_A0_DECODER_FUZZ_EVIDENCE_DRIFT");
}

console.log("A0 decoder fuzz passed (2 deterministic replays, 13 external surfaces, 2,100 bounded cases, zero unexpected outcomes or leaks)");
