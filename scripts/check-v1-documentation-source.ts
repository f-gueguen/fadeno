import { execFileSync } from "node:child_process";
import { checkV1DocumentationAuthority } from "./lib/v1-documentation-authority.ts";

const root = process.cwd();
const tracked = new Set(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n"),
);
const errors = checkV1DocumentationAuthority(root, tracked);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("V1 documentation source authority passed");
