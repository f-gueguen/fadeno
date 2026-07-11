import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadExperimentRegistry } from "./lib/experiment-validation.ts";

const root = process.cwd();
const errors = [];

let experimentRegistry;
try {
  experimentRegistry = loadExperimentRegistry(root);
} catch (error) {
  errors.push(`experiments/registry.json: invalid contract (${error.code ?? error.message})`);
  experimentRegistry = { experiments: [] };
}
const registryEntries = experimentRegistry.experiments;

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function tableIds(content, pattern) {
  return content
    .split("\n")
    .map((line) => line.match(pattern)?.[1])
    .filter(Boolean);
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function tableRows(content, pattern) {
  return content
    .split("\n")
    .filter((line) => pattern.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

const featurePattern = /^\| ([A-Z]+-\d{2}) \|/;
const scopeFeatures = tableIds(read("docs/product/scope.md"), featurePattern);
const traceFeatures = tableIds(read("docs/traceability.md"), featurePattern);

for (const duplicate of duplicates(scopeFeatures)) {
  errors.push(`docs/product/scope.md: duplicate feature ID ${duplicate}`);
}
for (const duplicate of duplicates(traceFeatures)) {
  errors.push(`docs/traceability.md: duplicate feature ID ${duplicate}`);
}

const scopeSet = new Set(scopeFeatures);
const traceSet = new Set(traceFeatures);
for (const missing of setDifference(scopeSet, traceSet)) {
  errors.push(`docs/traceability.md: missing feature ${missing}`);
}
for (const unknown of setDifference(traceSet, scopeSet)) {
  errors.push(`docs/traceability.md: unknown feature ${unknown}`);
}

if (scopeSet.size < 20) {
  errors.push("docs/product/scope.md: feature inventory is unexpectedly incomplete");
}

const scopeRows = new Map<string, string[]>(
  tableRows(read("docs/product/scope.md"), /^\| [A-Z]+-\d{2} \|/).map((cells) => [
    cells[0],
    cells,
  ]),
);
const traceRows = new Map<string, string[]>(
  tableRows(read("docs/traceability.md"), /^\| [A-Z]+-\d{2} \|/).map((cells) => [
    cells[0],
    cells,
  ]),
);

for (const [feature, cells] of traceRows) {
  if (cells.length !== 6) {
    errors.push(`docs/traceability.md: ${feature} must have exactly 6 columns`);
    continue;
  }

  const authorityLinks = [...cells[1].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
  if (authorityLinks.length === 0) {
    errors.push(`docs/traceability.md: ${feature} has no linked decision authority`);
  }

  for (const target of authorityLinks) {
    const allowed =
      target.startsWith("adr/") ||
      target.startsWith("../PROJECT_INVARIANTS.md") ||
      target === "ledgers/deferrals.md";
    if (!allowed) {
      errors.push(`docs/traceability.md: ${feature} has invalid authority ${target}`);
    }

    if (target.startsWith("adr/")) {
      const adr = read(`docs/${target}`);
      if (!adr.includes("- Status: Accepted")) {
        errors.push(`docs/traceability.md: ${feature} cites a non-effective ADR ${target}`);
      }
    }
  }

  const specificationLinks = [...cells[2].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
  const state = scopeRows.get(feature)?.[3] ?? "";
  const permitsNoSpecification =
    state.includes("Deferred") || cells[2] === "Decision gate only";
  if (specificationLinks.length === 0 && !permitsNoSpecification) {
    errors.push(`docs/traceability.md: ${feature} has no linked current specification`);
  }

  if (!cells[4] || !cells[5]) {
    errors.push(`docs/traceability.md: ${feature} is missing delivery or executable proof`);
  }
}

const gateContent = read("docs/ledgers/decision-gates.md");
const gateIds = tableIds(gateContent, /^\| (DG-[A-Z0-9]+-\d{2}) \|/);
for (const duplicate of duplicates(gateIds)) {
  errors.push(`docs/ledgers/decision-gates.md: duplicate gate ID ${duplicate}`);
}

const gateSet = new Set(gateIds);
if (gateSet.size === 0) {
  errors.push("docs/ledgers/decision-gates.md: expected at least one open gate");
}

function collectMarkdown(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(path));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

for (const file of collectMarkdown(root)) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\b(DG-[A-Z0-9]+-\d{2})\b/g)) {
    if (!gateSet.has(match[1])) {
      errors.push(`${file.slice(root.length + 1)}: references unknown gate ${match[1]}`);
    }
  }

  for (const match of content.matchAll(/\b([A-Z]+-\d{2})\b/g)) {
    if (!scopeSet.has(match[1])) {
      errors.push(`${file.slice(root.length + 1)}: references unknown feature ${match[1]}`);
    }
  }
}

const hypotheses = read("docs/ledgers/hypotheses.md");
const hypothesisIds = new Set(
  [...hypotheses.matchAll(/^## (H\d+) — /gm)].map((match) => match[1]),
);
const resolvedHypothesisIds = new Set(
  registryEntries
    .filter((entry) => entry.status === "qualified")
    .map((entry) => entry.hypothesis),
);
const knownHypothesisIds = new Set([...hypothesisIds, ...resolvedHypothesisIds]);
const k0 = read("docs/roadmap/k0.md");
for (const id of ["H1", "H2", "H3", "H4"]) {
  if (!knownHypothesisIds.has(id)) {
    errors.push(`project model: K0 references missing active or resolved ${id}`);
  }
  if (!new RegExp(`\\b${id}\\b`).test(k0)) {
    errors.push(`docs/roadmap/k0.md: missing ${id} threshold`);
  }
}

const expectedK0Ids = [
  "K0-01",
  "K0-02",
  "K0-03",
  "K0-04",
  "K0-05",
  "K0-06",
  "K0-07",
  "K0-08A",
  "K0-08B",
  "K0-09",
  "K0-10",
  "K0-11",
];
const k0Rows = tableRows(k0, /^\| K0-\d{2}[A-Z]? \|/);
const k0Ids = k0Rows.map((cells) => cells[0]);
const k0Set = new Set(k0Ids);
const k0Order = new Map(k0Ids.map((id, index) => [id, index]));
if (k0Ids.length !== expectedK0Ids.length) {
  errors.push(
    `docs/roadmap/k0.md: expected ${expectedK0Ids.length} slices, found ${k0Ids.length}`,
  );
}
for (const duplicate of duplicates(k0Ids)) {
  errors.push(`docs/roadmap/k0.md: duplicate slice ${duplicate}`);
}

for (const [index, cells] of k0Rows.entries()) {
  const slice = cells[0];
  const expected = expectedK0Ids[index];
  if (slice !== expected) {
    errors.push(`docs/roadmap/k0.md: expected slice ${expected}, found ${slice}`);
  }
  if (cells.length !== 7) {
    errors.push(`docs/roadmap/k0.md: ${slice} must have exactly 7 columns`);
    continue;
  }

  const featureIds = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map(
    (match) => match[1],
  );
  if (featureIds.length === 0) {
    errors.push(`docs/roadmap/k0.md: ${slice} has no feature IDs`);
  }
  for (const feature of featureIds) {
    if (!scopeSet.has(feature)) {
      errors.push(`docs/roadmap/k0.md: ${slice} references unknown feature ${feature}`);
    }
  }

  for (const hypothesis of cells[3].matchAll(/\b(H\d+)\b/g)) {
    if (!knownHypothesisIds.has(hypothesis[1])) {
      errors.push(`docs/roadmap/k0.md: ${slice} references unknown ${hypothesis[1]}`);
    }
  }
  for (const gate of cells[3].matchAll(/\b(DG-[A-Z0-9]+-\d{2})\b/g)) {
    if (!gateSet.has(gate[1])) {
      errors.push(`docs/roadmap/k0.md: ${slice} references unknown ${gate[1]}`);
    }
  }

  const dependencies = cells[4]
    .split(",")
    .map((dependency) => dependency.trim())
    .filter((dependency) => dependency.startsWith("K0-"));
  for (const dependency of dependencies) {
    if (!k0Set.has(dependency)) {
      errors.push(`docs/roadmap/k0.md: ${slice} depends on missing ${dependency}`);
    } else if ((k0Order.get(dependency) ?? Infinity) >= (k0Order.get(slice) ?? -1)) {
      errors.push(`docs/roadmap/k0.md: ${slice} dependency ${dependency} is not earlier`);
    }
  }

  if (!cells[5].includes("`pnpm ")) {
    errors.push(`docs/roadmap/k0.md: ${slice} has no exact pnpm validation command`);
  }
  if (!cells[6]) {
    errors.push(`docs/roadmap/k0.md: ${slice} has no required artifacts`);
  }
}

for (const hypothesis of ["H1", "H2", "H3", "H4"]) {
  if (!k0Rows.some((cells) => new RegExp(`\\b${hypothesis}\\b`).test(cells[3]))) {
    errors.push(`docs/roadmap/k0.md: no atomic slice owns ${hypothesis}`);
  }
}

const registryIds = registryEntries.map((entry) => entry.id).filter(Boolean);
const plannedDirectoryIds = [...k0.matchAll(/^  ([a-z][a-z-]+)\/$/gm)].map(
  (match) => match[1],
);
for (const missing of setDifference(new Set(plannedDirectoryIds), new Set(registryIds))) {
  errors.push(`experiments/registry.json: missing K0 directory ${missing}`);
}
for (const unknown of setDifference(new Set(registryIds), new Set(plannedDirectoryIds))) {
  errors.push(`experiments/registry.json: unknown K0 directory ${unknown}`);
}
const roadmapExperimentMappings = new Map();
for (const row of k0Rows) {
  const command = row[5].match(
    /`pnpm experiment:([a-z-]+) -- --(list|qualify)`/,
  );
  if (!command) continue;
  const [, id, mode] = command;
  const hypothesis = row[3].match(/\bH[1-4]\b/)?.[0];
  const mapping = roadmapExperimentMappings.get(id) ?? {};
  mapping[mode === "list" ? "harness" : "qualification"] = {
    slice: row[0],
    hypothesis,
  };
  roadmapExperimentMappings.set(id, mapping);
}
for (const duplicate of duplicates(registryEntries.map((entry) => entry.hypothesis))) {
  errors.push(`experiments/registry.json: duplicate hypothesis ${duplicate}`);
}
for (const entry of registryEntries) {
  const expected = roadmapExperimentMappings.get(entry.id);
  if (
    !expected?.harness ||
    !expected?.qualification ||
    expected.harness.slice !== entry.harnessSlice ||
    expected.qualification.slice !== entry.qualificationSlice ||
    expected.harness.hypothesis !== entry.hypothesis ||
    expected.qualification.hypothesis !== entry.hypothesis
  ) {
    errors.push(`experiments/registry.json: ${entry.id} mapping differs from K0 plan`);
  }
  if (
    (k0Order.get(String(entry.harnessSlice)) ?? Infinity) >=
    (k0Order.get(String(entry.qualificationSlice)) ?? -1)
  ) {
    errors.push(`experiments/registry.json: ${entry.id} qualifies before its harness`);
  }
}

const workflow = read("docs/contributor-workflow.md");
for (const heading of [
  "## 1. Orient before editing",
  "## 2. Keep the change atomic",
  "## 3. Deliver the complete slice",
  "## 4. Examples and documentation",
  "## 5. Version and changelog workflow",
  "## 6. Validate proportionally",
  "## 7. Prepare review and handoff",
  "## Definition of done",
]) {
  if (!workflow.includes(heading)) {
    errors.push(`docs/contributor-workflow.md: missing section ${heading}`);
  }
}

for (const requirement of [
  "one pull request",
  "atomic commit",
  "executable example",
  "Changeset",
  "version intent",
  "changelog",
  "migration",
  "rollback",
  "pnpm check",
]) {
  if (!workflow.toLowerCase().includes(requirement.toLowerCase())) {
    errors.push(`docs/contributor-workflow.md: missing workflow requirement ${requirement}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `project-model check passed (${scopeSet.size} features, ${gateSet.size} open gates)`,
);
