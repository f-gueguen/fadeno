import { execFileSync } from "node:child_process";

import {
  loadA0AlphaQualificationContext,
  validateA0AlphaQualification,
} from "./lib/a0-alpha-qualification.ts";

const root = process.cwd();
const tracked = new Set(execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
).trim().split("\n"));
const errors = validateA0AlphaQualification(loadA0AlphaQualificationContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 alpha qualification passed (9 fail-closed audits, packed workflows, caveats retained, publication remains A0-10)");
