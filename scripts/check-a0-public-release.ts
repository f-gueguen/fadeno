import { execFileSync } from "node:child_process";

import {
  loadA0PublicReleaseEvidenceContext,
  validateA0PublicReleaseEvidence,
} from "./lib/a0-public-release-evidence.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0PublicReleaseEvidence(loadA0PublicReleaseEvidenceContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 public release passed (exact public alpha, mandatory aliases, provenance, credential cleanup, trusted publisher, recovery)");
