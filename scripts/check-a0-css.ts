import { execFileSync } from "node:child_process";
import { loadA0CssContext, validateA0Css } from "./lib/a0-css.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0Css(loadA0CssContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 CSS boundary passed (native external CSS, inline refusal, complete executable evidence, private package)");
