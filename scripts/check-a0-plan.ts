import { execFileSync } from "node:child_process";
import { loadA0PlanContext, validateA0Plan } from "./lib/a0-plan.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0Plan(loadA0PlanContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 plan passed (11 ordered slices, registry identity selected, 3 decisions pending)");
