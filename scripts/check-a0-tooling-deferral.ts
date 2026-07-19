import { execFileSync } from "node:child_process";

import {
  loadA0ToolingDeferralContext,
  validateA0ToolingDeferral,
} from "./lib/a0-tooling-deferral.ts";

const root = process.cwd();
const tracked = new Set(execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
).trim().split("\n"));
const errors = validateA0ToolingDeferral(loadA0ToolingDeferralContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 tooling deferral passed (newcomer usability unqualified, analyzer private, no editor product or public schema)");
