import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePublicationEnvironment } from "./lib/a0-release.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "packages/framework/package.json"), "utf8")) as unknown;
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const clean = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim() === "";
const errors = validatePublicationEnvironment(process.env, manifest as Record<string, unknown>, { head, clean });
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log(`A0 publication guard passed (${head})`);
