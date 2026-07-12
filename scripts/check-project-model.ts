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
  "K0-10A",
  "K0-10B",
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

const v1 = read("docs/roadmap/v1.md");
const expectedV1Ids = Array.from({ length: 14 }, (_, index) => `V1-${String(index + 1).padStart(2, "0")}`);
const v1Rows = tableRows(v1, /^\| V1-\d{2} \|/);
const v1Ids = v1Rows.map((cells) => cells[0]);
const v1Set = new Set(v1Ids);
const v1Order = new Map(v1Ids.map((id, index) => [id, index]));
if (JSON.stringify(v1Ids) !== JSON.stringify(expectedV1Ids)) {
  errors.push(`docs/roadmap/v1.md: expected ordered slices ${expectedV1Ids.join(", ")}`);
}
for (const duplicate of duplicates(v1Ids)) errors.push(`docs/roadmap/v1.md: duplicate slice ${duplicate}`);

const v1Features = new Set();
const v1Gates = new Set();
for (const cells of v1Rows) {
  const slice = cells[0];
  if (cells.length !== 6) {
    errors.push(`docs/roadmap/v1.md: ${slice} must have exactly 6 columns`);
    continue;
  }
  for (const match of cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)) {
    if (!scopeSet.has(match[1])) errors.push(`docs/roadmap/v1.md: ${slice} references unknown feature ${match[1]}`);
    v1Features.add(match[1]);
  }
  for (const match of cells[3].matchAll(/\b(DG-V1-\d{2})\b/g)) {
    if (!gateSet.has(match[1])) errors.push(`docs/roadmap/v1.md: ${slice} references unknown gate ${match[1]}`);
    v1Gates.add(match[1]);
  }
  for (const dependency of cells[3].matchAll(/(?<!DG-)\b(V1-\d{2})\b/g)) {
    if (!v1Set.has(dependency[1])) errors.push(`docs/roadmap/v1.md: ${slice} depends on missing ${dependency[1]}`);
    else if ((v1Order.get(dependency[1]) ?? Infinity) >= (v1Order.get(slice) ?? -1)) {
      errors.push(`docs/roadmap/v1.md: ${slice} dependency ${dependency[1]} is not earlier`);
    }
  }
  if (!cells[4] || !cells[5]) errors.push(`docs/roadmap/v1.md: ${slice} is missing artifacts or validation`);
}
const requiredV1Features = new Set([
  "GOV-01", "WEB-01", "WEB-02", "WEB-03", "DATA-01", "DATA-02", "DATA-03", "STATE-01",
  "TYPE-01", "SEC-01", "BUILD-01", "ADP-01", "TEST-01", "DX-01", "CLI-01", "DOC-01", "ACCESS-01", "PERF-01",
]);
for (const feature of setDifference(requiredV1Features, v1Features)) errors.push(`docs/roadmap/v1.md: missing V1 feature ${feature}`);
for (const gate of gateIds.filter((id) => id.startsWith("DG-V1-"))) {
  if (!v1Gates.has(gate)) errors.push(`docs/roadmap/v1.md: missing gate ${gate}`);
}

const expectedV1Dx = [
  {
    id: "V1-DX-A",
    features: ["GOV-01", "TYPE-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01", "PERF-01"],
    dependencies: ["V1-08"],
    commands: ["pnpm check:docs", "pnpm check:decisions", "pnpm check:ledgers", "pnpm check:model", "pnpm check:policies", "pnpm check"],
  },
  {
    id: "V1-DX-B",
    features: ["TYPE-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01"],
    dependencies: ["V1-DX-A", "V1-09"],
    commands: ["pnpm check:v1-analyzer", "pnpm check:v1-analyzer-package", "pnpm check"],
  },
  {
    id: "V1-DX-C",
    features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01", "PERF-01"],
    dependencies: ["V1-DX-B", "V1-13"],
    commands: ["pnpm check:v1-analyzer-lifecycle", "pnpm check:v1-analyzer-feedback", "pnpm ci:local"],
  },
] as const;
const v1DxRows = tableRows(v1, /^\| V1-DX-[A-Z] \|/);
const v1DxIds = v1DxRows.map((cells) => cells[0]);
const expectedV1DxIds = expectedV1Dx.map((entry) => entry.id);
if (JSON.stringify(v1DxIds) !== JSON.stringify(expectedV1DxIds)) {
  errors.push(`docs/roadmap/v1.md: expected ordered V1/DX milestones ${expectedV1DxIds.join(", ")}`);
}
for (const duplicate of duplicates(v1DxIds)) {
  errors.push(`docs/roadmap/v1.md: duplicate V1/DX milestone ${duplicate}`);
}

for (const [index, expected] of expectedV1Dx.entries()) {
  const cells = v1DxRows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 7) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} must have exactly 7 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  for (const feature of features) {
    if (!scopeSet.has(feature)) {
      errors.push(`docs/roadmap/v1.md: ${expected.id} references unknown feature ${feature}`);
    }
  }
  for (const dependency of expected.dependencies) {
    if (!cells[3].includes(dependency)) {
      errors.push(`docs/roadmap/v1.md: ${expected.id} missing dependency ${dependency}`);
    }
  }
  if (!cells[4]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no required artifacts`);
  for (const command of expected.commands) {
    if (!cells[5].includes(`\`${command}\``)) {
      errors.push(`docs/roadmap/v1.md: ${expected.id} missing validation command ${command}`);
    }
  }
  if (!cells[6]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no delivery boundary`);
}

const requiredNumberedV1DxDependencies = new Map([
  ["V1-09", "V1-DX-A"],
  ["V1-10", "V1-DX-B"],
  ["V1-14", "V1-DX-C"],
]);
for (const [slice, dependency] of requiredNumberedV1DxDependencies) {
  const row = v1Rows.find((cells) => cells[0] === slice);
  if (!row?.[3].includes(dependency)) {
    errors.push(`docs/roadmap/v1.md: ${slice} missing dependency ${dependency}`);
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
