import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareA0UsabilityParticipantBundle } from "./lib/a0-usability-artifact.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== "--output") {
  throw new TypeError("FADENO_A0_USABILITY_BUNDLE_USAGE: --output <missing-path>");
}
const output = resolve(process.cwd(), arguments_[1]!);
const identity = prepareA0UsabilityParticipantBundle(root, output);
process.stdout.write(`${JSON.stringify({
  output,
  sourceCommit: identity.sourceCommit,
  packageVersion: identity.packageVersion,
  packageFilename: identity.packageFilename,
  packageSha256: identity.packageSha256,
}, null, 2)}\n`);
