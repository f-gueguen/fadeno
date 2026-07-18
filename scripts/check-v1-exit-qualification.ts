import { execFileSync } from "node:child_process";
import { createV1ExitContext, readV1ExitDocument, validateV1ExitDocument } from "./lib/v1-exit-qualification.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateV1ExitDocument(readV1ExitDocument(root), createV1ExitContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("V1 exit qualification passed (15 features, 6 audits, historical V1 scope evidence preserved)");
