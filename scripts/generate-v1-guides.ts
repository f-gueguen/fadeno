import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { checkV1DocumentationAuthority } from "./lib/v1-documentation-authority.ts";
import { renderV1DocumentationTemplate } from "./lib/v1-documentation-templates.ts";

interface DocumentationSource {
  readonly applicationRoots: readonly string[];
  readonly scenarioRoot: string;
  readonly evidence: Readonly<Record<string, readonly string[]>>;
}

const root = process.cwd();
const appRoot = join(root, "examples/v1-app");
const tracked = new Set(
  execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n"),
);
const authorityErrors = checkV1DocumentationAuthority(root, tracked);
if (authorityErrors.length > 0) throw new Error(authorityErrors.join("\n"));
const source = JSON.parse(readFileSync(join(appRoot, "documentation-source.json"), "utf8")) as DocumentationSource;

function files(path: string): readonly string[] {
  if (lstatSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : [];
  });
}

const authorityFiles = [
  ...source.applicationRoots.flatMap((path) => files(join(appRoot, path))),
  ...files(join(appRoot, source.scenarioRoot)),
  ...Object.values(source.evidence).flatMap((paths) => paths.map((path) => join(appRoot, path))),
];
const authorizedPaths = new Set(authorityFiles.map((path) => relative(root, path).replaceAll("\\", "/")));
const documents = [
  ["docs/templates/v1/getting-started.md.tmpl", "docs/guides/getting-started.md"],
  ["docs/templates/v1/resources-actions.md.tmpl", "docs/guides/resources-actions.md"],
  ["docs/templates/v1/diagnostics-recovery.md.tmpl", "docs/guides/diagnostics-recovery.md"],
  ["docs/templates/v1/migration-seed.md.tmpl", "docs/migrations/v1-private-preview.md"],
] as const;
const check = process.argv.includes("--check");

for (const [templatePath, outputPath] of documents) {
  const template = readFileSync(join(root, templatePath), "utf8");
  const rendered = renderV1DocumentationTemplate(template, root, authorizedPaths);
  const output = join(root, outputPath);
  if (check) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== rendered) {
      console.error(`${outputPath} is stale; run pnpm generate:v1-documentation`);
      process.exitCode = 1;
    }
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, rendered);
    console.log(`generated ${outputPath}`);
  }
}

if (check && process.exitCode !== 1) console.log("V1 generated tutorials and guidance passed");
