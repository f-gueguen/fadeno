import { execFileSync } from "node:child_process";

import { loadV2PlanContext, validateV2Plan } from "./lib/v2-plan.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateV2Plan(loadV2PlanContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("V2 plan passed (20 atomic slices, evaluator-ready demo, form security, relative baseline, and historical release evidence retained)");
