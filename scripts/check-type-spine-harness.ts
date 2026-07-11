import { executeTypeSpineHarness } from "../experiments/type-spine/harness.ts";

const result = executeTypeSpineHarness();
if (result.replacements !== 1 || JSON.stringify(result.files) !== '["generated/candidate-types.ts"]') {
  throw new Error("K0-07 type-spine harness result differed");
}

console.log("type-spine harness passed (contained deterministic generation, 5 valid, 5 invalid)");
