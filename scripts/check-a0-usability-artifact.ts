import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareA0UsabilityParticipantBundle, verifyA0UsabilityParticipantBundle } from "./lib/a0-usability-artifact.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(realpathSync(tmpdir()), "fadeno-a0-usability-artifact-"));
const output = join(temporary, "participant-bundle");
try {
  const prepared = prepareA0UsabilityParticipantBundle(root, output);
  const verified = verifyA0UsabilityParticipantBundle(output, "participant-artifact");
  assert.deepEqual(verified, prepared);
  assert.equal(readdirSync(output).length, 5);
  console.log(`A0 usability artifact passed (${prepared.packageFilename}, exact source reconstruction, 5 bounded files)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
