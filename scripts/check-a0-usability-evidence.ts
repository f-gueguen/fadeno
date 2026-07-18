import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { reconstructA0UsabilityPackage } from "./lib/a0-usability-artifact.ts";
import { verifyA0UsabilityPacket } from "./lib/a0-usability-contract.ts";
import {
  readA0UsabilityEvidenceArtifactIdentity,
  verifyA0UsabilityEvidence,
} from "./lib/a0-usability-evidence.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== "--manifest") {
  throw new TypeError("FADENO_A0_USABILITY_EVIDENCE_USAGE: --manifest <repository-relative-path>");
}

const manifestPath = arguments_[1]!;
const packet = verifyA0UsabilityPacket(JSON.parse(readFileSync(
  new URL("../evidence/a0/independent-usability/task-packet.json", import.meta.url),
  "utf8",
)) as unknown);
const claimedArtifact = readA0UsabilityEvidenceArtifactIdentity({ repositoryRoot, manifestPath });
const reconstructedArtifact = reconstructA0UsabilityPackage(repositoryRoot, claimedArtifact.sourceCommit);
const summary = verifyA0UsabilityEvidence({
  repositoryRoot,
  manifestPath,
  packet,
  mode: "real-evidence",
  reconstructedArtifact,
});

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
