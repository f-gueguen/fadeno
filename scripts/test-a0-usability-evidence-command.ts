import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const invoke = (arguments_: readonly string[]) => spawnSync(process.execPath, [
  "--no-warnings",
  "--experimental-strip-types",
  "scripts/check-a0-usability-evidence.ts",
  ...arguments_,
], { encoding: "utf8" });

const missingArguments = invoke([]);
assert.notEqual(missingArguments.status, 0);
assert.match(missingArguments.stderr, /FADENO_A0_USABILITY_EVIDENCE_USAGE/u);

const syntheticAttemptAsManifest = invoke([
  "--manifest",
  "fixtures/a0-independent-usability/valid-attempt-fixture.json",
]);
assert.notEqual(syntheticAttemptAsManifest.status, 0);
assert.match(syntheticAttemptAsManifest.stderr, /FADENO_A0_USABILITY_EVIDENCE_MANIFEST/u);

console.log("A0 real usability evidence command refusals passed (usage, non-manifest input)");
