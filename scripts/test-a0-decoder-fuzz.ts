import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateA0DecoderFuzzSummary } from "./lib/a0-decoder-fuzz.ts";

const source = JSON.parse(readFileSync(join(process.cwd(), "evidence/a0/security/decoder-fuzz.json"), "utf8")) as Record<string, unknown>;

function copy(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function expectMutation(expected: string, mutate: (value: Record<string, unknown>) => void): void {
  const value = copy();
  mutate(value);
  const errors = validateA0DecoderFuzzSummary(value);
  if (!errors.includes(expected)) {
    throw new Error(`A0 decoder fuzz mutation was not refused: ${expected}\n${errors.join("\n")}`);
  }
}

const validErrors = validateA0DecoderFuzzSummary(source);
if (validErrors.length > 0) throw new Error(`valid A0 decoder fuzz evidence refused:\n${validErrors.join("\n")}`);

expectMutation("A0 decoder fuzz seed drifted", (value) => { value["seed"] = 1; });
expectMutation("A0 decoder fuzz deterministic replay is not proven", (value) => { value["deterministicReplay"] = false; });
expectMutation("A0 decoder fuzz observed secret leakage", (value) => { value["secretLeakageObserved"] = true; });
expectMutation("A0 decoder fuzz surface order drifted: adapter-request-target", (value) => {
  const surfaces = value["surfaces"] as Record<string, unknown>[];
  [surfaces[0], surfaces[1]] = [surfaces[1]!, surfaces[0]!];
});
expectMutation("A0 decoder fuzz unexpected outcome: action-body", (value) => {
  const action = (value["surfaces"] as Record<string, unknown>[]).find(({ id }) => id === "action-body")!;
  action["unexpected"] = 1;
  action["refused"] = (action["refused"] as number) - 1;
});
expectMutation("A0 decoder fuzz input bound drifted: configuration-source", (value) => {
  const config = (value["surfaces"] as Record<string, unknown>[]).find(({ id }) => id === "configuration-source")!;
  config["largestInputBytes"] = 4_097;
});

console.log("A0 decoder fuzz mutation tests passed (seed, replay, redaction, surface order, classification, input bounds)");
