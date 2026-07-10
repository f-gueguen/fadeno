import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const errors = [];

const requiredFiles = [
  "AGENTS.md",
  "LICENSE",
  "PROJECT_INVARIANTS.md",
  "ROADMAP_LEDGER.md",
  "docs/architecture/overview.md",
  "docs/adr/README.md",
  "docs/contributor-workflow.md",
  "docs/product/scope.md",
  "docs/traceability.md",
  "docs/roadmap/k0.md",
  "docs/migrations/README.md",
  "docs/migrations/template.md",
  "docs/migrations/fixtures/README.md",
  "docs/spec/README.md",
  "docs/security/requirements.md",
  "docs/ledgers/decision-gates.md",
  "docs/ledgers/hypotheses.md",
  "docs/ledgers/risks.md",
  "docs/ledgers/deferrals.md",
  "docs/roadmap.md",
  "docs/release-policy.md",
];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    errors.push(`missing required documentation: ${file}`);
  }
}

if (existsSync(join(root, "docs/archive"))) {
  errors.push("docs/archive is forbidden in the canonical repository");
}

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    if (entry.isFile()) files.push(path);
  }

  return files;
}

const staleBrand = ["Pli", "nth"].join("");
const staleAnalysisFolder = ["codex", " analysis"].join("");
const removedInvalidationTerm = ["tou", "ches"].join("");
const removedExecutionMode = ["full", "-client"].join("");
const forbiddenText = [
  staleBrand,
  staleAnalysisFolder,
  removedInvalidationTerm,
  removedExecutionMode,
];
const repositoryFiles = collectFiles(root);
const markdownFiles = repositoryFiles.filter((file) => extname(file) === ".md");
const checkedTextExtensions = new Set([
  "",
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".ts",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const anchorCache = new Map();

function headingAnchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);

  const content = readFileSync(file, "utf8");
  const counts = new Map();
  const anchors = new Set();

  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const heading = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!heading) continue;

    const count = counts.get(heading) ?? 0;
    counts.set(heading, count + 1);
    anchors.add(count === 0 ? heading : `${heading}-${count}`);
  }

  anchorCache.set(file, anchors);
  return anchors;
}

for (const file of repositoryFiles) {
  if (!checkedTextExtensions.has(extname(file))) continue;

  const content = readFileSync(file, "utf8");
  const displayPath = relative(root, file);

  for (const forbidden of forbiddenText) {
    if (content.toLowerCase().includes(forbidden.toLowerCase())) {
      errors.push(`${displayPath}: contains stale or non-canonical wording`);
    }
  }
}

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  const displayPath = relative(root, file);

  for (const match of content.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }

    if (
      target.startsWith("https://") ||
      target.startsWith("http://") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }

    const hashIndex = target.indexOf("#");
    const pathPart = decodeURIComponent(hashIndex === -1 ? target : target.slice(0, hashIndex));
    const fragment =
      hashIndex === -1 ? "" : decodeURIComponent(target.slice(hashIndex + 1)).toLowerCase();

    const resolved = pathPart ? resolve(dirname(file), pathPart) : file;
    if (!resolved.startsWith(`${root}/`) && resolved !== root) {
      errors.push(`${displayPath}: link escapes repository: ${target}`);
      continue;
    }

    if (!existsSync(resolved)) {
      errors.push(`${displayPath}: broken link: ${target}`);
      continue;
    }

    if (pathPart.endsWith("/") && !lstatSync(resolved).isDirectory()) {
      errors.push(`${displayPath}: directory link targets a file: ${target}`);
    }

    if (fragment) {
      if (!lstatSync(resolved).isFile() || extname(resolved) !== ".md") {
        errors.push(`${displayPath}: anchor targets a non-Markdown file: ${target}`);
      } else if (!headingAnchors(resolved).has(fragment)) {
        errors.push(`${displayPath}: broken anchor: ${target}`);
      }
    }
  }
}

const specDirectory = join(root, "docs/spec");
const specIndex = readFileSync(join(specDirectory, "README.md"), "utf8");
const specFiles = readdirSync(specDirectory)
  .filter((file) => file !== "README.md" && file.endsWith(".md"))
  .sort();
const indexedSpecs = [...specIndex.matchAll(/\(([a-z0-9-]+\.md)\)/g)].map(
  (match) => match[1],
);

for (const file of specFiles) {
  if (!indexedSpecs.includes(file)) {
    errors.push(`docs/spec/${file}: missing from docs/spec/README.md`);
  }
}

for (const file of indexedSpecs) {
  if (!specFiles.includes(file)) {
    errors.push(`docs/spec/README.md: references missing specification ${file}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`documentation check passed (${markdownFiles.length} Markdown files)`);
