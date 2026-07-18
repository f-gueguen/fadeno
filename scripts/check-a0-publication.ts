import { execFileSync } from "node:child_process";
import { loadA0PublicationContext, validateA0Publication } from "./lib/a0-publication.ts";

const root = process.cwd();
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
const errors = validateA0Publication(loadA0PublicationContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 publication boundary passed (owned identity, exact surface, publishable seed, provenance bootstrap, trusted releases)");
