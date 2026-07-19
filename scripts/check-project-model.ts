import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadExperimentRegistry } from "./lib/experiment-validation.ts";
import { V2_PLAN_ROWS } from "./lib/v2-plan.ts";

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
const retiredGateDecisionPath = "docs/adr/0043-defer-independent-usability-and-external-tooling.md";
const retiredGateIds = new Set(
  [...read(retiredGateDecisionPath)
    .matchAll(/\b(DG-[A-Z0-9]+-\d{2}) is removed\b/g)]
    .map((match) => match[1]),
);
const resolvedGateIds = new Set(
  collectMarkdown(join(root, "docs/adr"))
    .flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return content.includes("- Status: Accepted")
        ? [...content.matchAll(/\b(DG-[A-Z0-9]+-\d{2}) is resolved\b/g)]
        : [];
    })
    .map((match) => match[1]),
);
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
  const relativeFile = file.slice(root.length + 1);
  const permitsRetiredGateReference = relativeFile === retiredGateDecisionPath
    || (relativeFile.startsWith("docs/adr/") && content.includes("- Status: Superseded"));
  for (const match of content.matchAll(/\b(DG-[A-Z0-9]+-\d{2})\b/g)) {
    if (!gateSet.has(match[1])
      && !resolvedGateIds.has(match[1])
      && !(retiredGateIds.has(match[1]) && permitsRetiredGateReference)) {
      errors.push(`${relativeFile}: references unknown gate ${match[1]}`);
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
for (const match of v1.matchAll(/\b(DG-V1-\d{2})\b/g)) v1Gates.add(match[1]);
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

const expectedV1DxB = [
  { id: "V1-DX-B1", features: ["BUILD-01", "TEST-01", "DX-01"], dependency: "V1-09" },
  { id: "V1-DX-B2", features: ["TYPE-01", "TEST-01", "DX-01"], dependency: "V1-DX-B1" },
  { id: "V1-DX-B3", features: ["TYPE-01", "BUILD-01", "TEST-01", "DX-01"], dependency: "V1-DX-B2" },
  { id: "V1-DX-B4", features: ["BUILD-01", "TEST-01", "DX-01"], dependency: "V1-DX-B3" },
  { id: "V1-DX-B5", features: ["TEST-01", "DX-01", "DOC-01"], dependency: "V1-DX-B4" },
  { id: "V1-DX-B6", features: ["TEST-01", "DX-01", "DOC-01"], dependency: "V1-DX-B5" },
  { id: "V1-DX-B7A", features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependency: "V1-DX-B6" },
  { id: "V1-DX-B7B", features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependency: "V1-DX-B7A" },
  { id: "V1-DX-B7C", features: ["BUILD-01", "TEST-01", "DX-01"], dependency: "V1-DX-B7B" },
  { id: "V1-DX-B7D0", features: ["GOV-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-B7C"], commands: ["pnpm check", "pnpm ci:local"] },
  { id: "V1-DX-B7D1", features: ["BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-B7D0"], commands: ["pnpm check:v1-analyzer"] },
  { id: "V1-DX-B7D2", features: ["BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-B7D1"], commands: ["pnpm check:v1-analyzer"] },
  { id: "V1-DX-B7D3", features: ["TYPE-01", "BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-B7D2", "V1-DX-B7C"], commands: ["pnpm check:v1-analyzer"] },
  { id: "V1-DX-B7D4", features: ["BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-B7D3"], commands: ["pnpm check:v1-analyzer"] },
  { id: "V1-DX-B7D5", features: ["GOV-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-B7D3", "ADR 0033"], commands: ["pnpm check", "pnpm ci:local"] },
  { id: "V1-DX-B7D6", features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-B7D5"], commands: ["pnpm check:v1-analyzer", "pnpm ci:local"] },
  { id: "V1-DX-B7D7", features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-B7D4", "V1-DX-B7D5", "V1-DX-B7D6"], commands: ["pnpm check:v1-analyzer", "pnpm ci:local"] },
] as const;
const v1DxBRows = tableRows(v1, /^\| V1-DX-B[0-9A-Z]+ \|/);
const v1DxBIds = v1DxBRows.map((cells) => cells[0]);
const expectedV1DxBIds = expectedV1DxB.map((entry) => entry.id);
if (JSON.stringify(v1DxBIds) !== JSON.stringify(expectedV1DxBIds)) {
  errors.push(`docs/roadmap/v1.md: expected ordered V1-DX-B sub-slices ${expectedV1DxBIds.join(", ")}`);
}
for (const duplicate of duplicates(v1DxBIds)) errors.push(`docs/roadmap/v1.md: duplicate V1-DX-B sub-slice ${duplicate}`);
for (const [index, expected] of expectedV1DxB.entries()) {
  const cells = v1DxBRows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 7) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} must have exactly 7 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  const dependencies = "dependencies" in expected ? expected.dependencies : [expected.dependency];
  for (const dependency of dependencies) {
    if (!cells[3].includes(dependency)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing dependency ${dependency}`);
  }
  if (!cells[4]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no required artifacts`);
  const commands = "commands" in expected ? expected.commands : ["pnpm check:v1-analyzer"];
  for (const command of commands) {
    if (!cells[5].includes(`\`${command}\``)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing validation command ${command}`);
  }
  if (!cells[6]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no example boundary`);
}

const expectedV1DxC = [
  { id: "V1-DX-C0", features: ["GOV-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01", "PERF-01"], dependencies: ["V1-13", "V1-DX-B7D7"], commands: ["pnpm check:docs", "pnpm check:ledgers", "pnpm check:model", "pnpm check:policies", "pnpm check", "pnpm ci:local"] },
  { id: "V1-DX-C1", features: ["BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-C0"], commands: ["pnpm check:v1-analyzer", "pnpm check:v1-analyzer-lifecycle", "pnpm check:v1-analyzer-package", "pnpm ci:local"] },
  { id: "V1-DX-C2", features: ["BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-C1"], commands: ["pnpm check:v1-analyzer-lifecycle", "pnpm check:v1-analyzer-package", "pnpm ci:local"] },
  { id: "V1-DX-C3", features: ["TYPE-01", "BUILD-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-DX-C2"], commands: ["pnpm check:v1-analyzer-lifecycle", "pnpm check:v1-analyzer-workflow", "pnpm check:v1-analyzer-package", "pnpm ci:local"] },
  { id: "V1-DX-C4", features: ["BUILD-01", "TEST-01", "DX-01"], dependencies: ["V1-DX-C3"], commands: ["pnpm check:v1-analyzer-lifecycle", "pnpm check:v1-analyzer-package", "pnpm ci:local"] },
  { id: "V1-DX-C5A", features: ["GOV-01", "TEST-01", "DX-01", "DOC-01", "PERF-01"], dependencies: ["V1-DX-C4"], commands: ["pnpm check:v1-analyzer-feedback", "pnpm check:model", "pnpm check", "pnpm ci:local"] },
  { id: "V1-DX-C5B", features: ["TEST-01", "DX-01", "DOC-01", "PERF-01"], dependencies: ["V1-DX-C5A"], commands: ["pnpm check:v1-analyzer-feedback", "pnpm check:v1-analyzer-lifecycle", "pnpm ci:local"] },
] as const;
const expectedV1DxCContracts = new Map<string, readonly [string, string, string, string, string]>([
  ["V1-DX-C0", [
    "Decompose and enforce complete lifecycle and feedback qualification",
    "V1-13, V1-DX-B7D7",
    "Aligned roadmap, specifications, traceability, risks, ledger, project-model checks, and policy mutation tests; no implementation",
    "`pnpm check:docs`; `pnpm check:ledgers`; `pnpm check:model`; `pnpm check:policies`; `pnpm check`; `pnpm ci:local`",
    "Planning only; examples are not applicable because behavior does not change; no package, command, analyzer schema, protocol, or editor product",
  ]],
  ["V1-DX-C1", [
    "Integrate versioned document lifecycles with the private project analyzer authority",
    "V1-DX-C0",
    "One overlay-aware project operation boundary for open/change/replace/save/close/reopen; one declared-order position-dependent edit batch; exact saved/overlay ownership, line endings, and analyzer-text equivalence; immutable consumer events; version, URI, containment, symlink, and multi-root refusals",
    "`pnpm check:v1-analyzer`; `pnpm check:v1-analyzer-lifecycle`; `pnpm check:v1-analyzer-package`; `pnpm ci:local`",
    "Private integration fixtures only; no packed consumer, export, command, generic transport, schema, or editor product",
  ]],
  ["V1-DX-C2", [
    "Qualify the packed document and diagnostic lifecycle",
    "V1-DX-C1",
    "Current-tarball disposable private lifecycle consumer; initialize/open; one ordered position-dependent unsaved edit batch; line-ending and analyzer-text equivalence; full-replacement structured diagnostics and correction; repair; close/reopen; cleanup; stale-package canary",
    "`pnpm check:v1-analyzer-lifecycle`; `pnpm check:v1-analyzer-package`; `pnpm ci:local`",
    "Permanent packed canonical success, failure, correction, flow, and recovery evidence; public examples remain separate; no export, command, editor metadata, or stable machine schema",
  ]],
  ["V1-DX-C3", [
    "Qualify complete saved-project freshness at the consumer boundary",
    "V1-DX-C2",
    "Direct and three-level transitive changes; configuration epoch; rename/deletion; declaration and manifest regeneration; atomic diagnostic/artifact replacement and removal; accepted full-replacement consumer events",
    "`pnpm check:v1-analyzer-lifecycle`; `pnpm check:v1-analyzer-workflow`; `pnpm check:v1-analyzer-package`; `pnpm ci:local`",
    "Packed success, refusal, flow, and stale-artifact recovery evidence; stock TypeScript remains authoritative for ordinary TypeScript refresh",
  ]],
  ["V1-DX-C4", [
    "Qualify cancellation, supersession, and lifecycle cleanup",
    "V1-DX-C3",
    "Deterministic barriers for active cancellation, supersession, obsolete-result suppression, close during work, and zero retained operation/artifact ownership",
    "`pnpm check:v1-analyzer-lifecycle`; `pnpm check:v1-analyzer-package`; `pnpm ci:local`",
    "Packed interruption and recovery evidence; no timing sleeps, public protocol, or editor product",
  ]],
  ["V1-DX-C5A", [
    "Freeze the complete feedback workload and independent verifier before measurement",
    "V1-DX-C4",
    "Exact canonical mutations and save boundary; phase and accepted-event definitions; source/tarball identities; environment, monotonic clock, warmups, repetitions, raw schema, validity/refusal controls, stale-output canary, and explicit deep-timing flag",
    "`pnpm check:v1-analyzer-feedback`; `pnpm check:model`; `pnpm check`; `pnpm ci:local`",
    "Contract and dry-run evidence only; no retained timing result, budget, optimization, or performance claim",
  ]],
  ["V1-DX-C5B", [
    "Collect and verify complete edit-to-fresh and edit-to-cleared baseline evidence",
    "V1-DX-C5A",
    "Retained raw attempts and independent verification for invalidation, generation, TypeScript refresh, Fadeno analysis, and accepted consumer-visible replacement; updated risks and execution ledger",
    "`pnpm check:v1-analyzer-feedback`; `pnpm check:v1-analyzer-lifecycle`; `pnpm ci:local`",
    "Correctness and freshness failures block; timing values establish baseline evidence only and no incremental bound or public performance claim",
  ]],
]);
const v1DxCRows = tableRows(v1, /^\| V1-DX-C[0-9A-Z]+ \|/);
const v1DxCIds = v1DxCRows.map((cells) => cells[0]);
const expectedV1DxCIds = expectedV1DxC.map((entry) => entry.id);
if (JSON.stringify(v1DxCIds) !== JSON.stringify(expectedV1DxCIds)) {
  errors.push(`docs/roadmap/v1.md: expected ordered V1-DX-C sub-slices ${expectedV1DxCIds.join(", ")}`);
}
for (const duplicate of duplicates(v1DxCIds)) errors.push(`docs/roadmap/v1.md: duplicate V1-DX-C sub-slice ${duplicate}`);
for (const [index, expected] of expectedV1DxC.entries()) {
  const cells = v1DxCRows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 7) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} must have exactly 7 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  for (const dependency of expected.dependencies) {
    if (!cells[3].includes(dependency)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing dependency ${dependency}`);
  }
  if (!cells[4]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no required artifacts`);
  for (const command of expected.commands) {
    if (!cells[5].includes(`\`${command}\``)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing validation command ${command}`);
  }
  if (!cells[6]) errors.push(`docs/roadmap/v1.md: ${expected.id} has no evidence boundary`);
  const contract = expectedV1DxCContracts.get(expected.id);
  const actualContract = [cells[1], cells[3], cells[4], cells[5], cells[6]];
  if (!contract || JSON.stringify(actualContract) !== JSON.stringify(contract)) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} exact contract differs from the accepted plan`);
  }
}

const expectedV114 = [
  { id: "V1-14A", features: ["GOV-01", "TEST-01", "DOC-01"], dependencies: ["V1-13", "V1-DX-C5B"], commands: ["pnpm check:v1-documentation-source", "pnpm check:docs", "pnpm check:model", "pnpm check", "pnpm ci:local"] },
  { id: "V1-14B", features: ["BUILD-01", "CLI-01", "DX-01", "DOC-01"], dependencies: ["V1-14A"], commands: ["pnpm check:v1-documentation", "pnpm check"] },
  { id: "V1-14C", features: ["BUILD-01", "CLI-01", "TEST-01", "DX-01", "DOC-01"], dependencies: ["V1-14B"], commands: ["pnpm check:v1-independent-workflow", "pnpm check:v1-public-package", "pnpm check:v1-running-example", "pnpm check:v1-development", "pnpm check"] },
  { id: "V1-14D", features: ["GOV-01", "SEC-01", "TEST-01", "DX-01", "DOC-01", "ACCESS-01", "PERF-01"], dependencies: ["V1-14C"], commands: ["pnpm ci:local"] },
] as const;
const v114Rows = tableRows(v1, /^\| V1-14[A-D] \|/);
const v114Ids = v114Rows.map((cells) => cells[0]);
const expectedV114Ids = expectedV114.map((entry) => entry.id);
if (JSON.stringify(v114Ids) !== JSON.stringify(expectedV114Ids)) {
  errors.push(`docs/roadmap/v1.md: expected ordered V1-14 sub-slices ${expectedV114Ids.join(", ")}`);
}
for (const [index, expected] of expectedV114.entries()) {
  const cells = v114Rows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 7) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} must have exactly 7 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/v1.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  for (const dependency of expected.dependencies) {
    if (!cells[3].includes(dependency)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing dependency ${dependency}`);
  }
  for (const command of expected.commands) {
    if (!cells[5].includes(`\`${command}\``)) errors.push(`docs/roadmap/v1.md: ${expected.id} missing validation command ${command}`);
  }
  if (!cells[4] || !cells[6]) errors.push(`docs/roadmap/v1.md: ${expected.id} is missing artifacts or user boundary`);
}

const expectedA0 = [
  { id: "A0-00", features: ["GOV-01", "CLI-01", "DOC-01", "REL-01"], dependencies: "V1-14D", artifacts: "Detailed A0 plan, current ledger, registry/auth evidence, refreshed status documentation", validation: "Documentation/model/ledger gates; `pnpm check`; `pnpm ci:local`", commands: ["pnpm check", "pnpm ci:local"] },
  { id: "A0-01", features: ["CSS-01", "ACCESS-01", "WEB-02"], dependencies: "A0-00", artifacts: "ADR 0036; public-entrypoint native CSS application; normalized success, failure, correction, flow, recovery, and three-engine evidence", validation: "`pnpm check:a0-css`; `pnpm check:v1-renderer`; `pnpm check:v1-running-example`; `pnpm ci:local`", commands: ["pnpm check:a0-css", "pnpm check:v1-renderer", "pnpm check:v1-running-example", "pnpm ci:local"] },
  { id: "A0-02", features: ["GOV-01", "BUILD-01", "CLI-01", "REL-01"], dependencies: "A0-00, authenticated registry ownership", artifacts: "Registry-ownership evidence; ADR 0037 package-publication decision; exact entrypoint/bin/name mapping; trusted-publication and rollback decision", validation: "`pnpm check:a0-registry`; `pnpm check:a0-publication`; package/public-surface gates; decision/model gates; `pnpm ci:local`", commands: ["pnpm check:a0-registry", "pnpm check:a0-publication", "pnpm ci:local"] },
  { id: "A0-03", features: ["BUILD-01", "DOC-01", "REL-01"], dependencies: "A0-02", artifacts: "Lockstep alpha version, changeset/changelog machinery, package metadata/content/provenance checks, migration seed, rollback fixture", validation: "`pnpm check:a0-release`; `pnpm check:v1-public-package`; frozen pack/install; exact content/SBOM/provenance checks; release-policy mutations; `pnpm ci:local`", commands: ["pnpm check:a0-release", "pnpm check:v1-public-package", "pnpm ci:local"] },
  { id: "A0-04", features: ["CLI-01", "BUILD-01", "DOC-01", "TEST-01"], dependencies: "A0-03", artifacts: "Accepted create command, bounded arguments/refusals, canonical template sourced from the tested application, clean generated consumer", validation: "`pnpm check:a0-create`; public package install; create success/refusal; check/build/dev/start; byte-stable scaffold; docs snippets; `pnpm ci:local`", commands: ["pnpm check:a0-create", "pnpm ci:local"] },
  { id: "A0-05", features: ["CLI-01", "TEST-01", "DOC-01"], dependencies: "A0-04", artifacts: "Scaffolded test command and public helpers only if demonstrated; success/failure/recovery fixtures", validation: "`pnpm check:a0-test`; clean created project; stock test execution; package-boundary and example gates; `pnpm ci:local`", commands: ["pnpm check:a0-test", "pnpm ci:local"] },
  { id: "A0-06", features: ["CLI-01", "BUILD-01", "SEC-01", "DOC-01"], dependencies: "A0-04", artifacts: "ADR 0041; production-only artifact; configuration/secrets boundary; health/start/stop/rollback example; generated guide", validation: "`pnpm check:a0-deploy`; clean artifact deployment; HTTPS/origin/session controls; failure/rollback; no source/dev dependency; `pnpm ci:local`", commands: ["pnpm check:a0-deploy", "pnpm ci:local"] },
  { id: "A0-07", features: ["CLI-01", "DX-01", "DOC-01", "ACCESS-01", "TEST-01"], dependencies: "A0-05, A0-06", artifacts: "ADR 0043; retained ADR 0042 packet, replay, reconstruction, privacy, and synthetic-refusal controls; explicit `deferred-unqualified` outcome", validation: "`pnpm check:a0-usability-contract`; `pnpm check:a0-usability-replay-contract`; `pnpm check:a0-usability-artifact`; `pnpm check:a0-tooling-deferral`; no participant claim; `pnpm ci:local`", commands: ["pnpm check:a0-usability-contract", "pnpm check:a0-usability-replay-contract", "pnpm check:a0-usability-artifact", "pnpm check:a0-tooling-deferral", "pnpm ci:local"] },
  { id: "A0-08", features: ["DX-01", "TOOL-01", "DOC-01"], dependencies: "A0-07", artifacts: "ADR 0043; no editor product, public analyzer schema, or external compatibility promise; deferred re-entry trigger", validation: "`pnpm check:a0-tooling-deferral`; decision/deferral/model gates; `pnpm ci:local`", commands: ["pnpm check:a0-tooling-deferral", "pnpm ci:local"] },
  { id: "A0-09", features: ["SEC-01", "ACCESS-01", "PERF-01", "TEST-01", "DOC-01", "REL-01"], dependencies: "A0-01 through A0-08", artifacts: "Threat review, decoder fuzzing, package/readme/docs audit, clean-machine workflow, reproducibility and rollback evidence, alpha migration guide, explicit independent-usability/tooling caveat", validation: "Full security/accessibility/package/docs/performance/reproducibility gates; `pnpm check:a0-decoder-fuzz`; `pnpm check:a0-tooling-deferral`; `pnpm check:a0-alpha-qualification`; `pnpm check`; `pnpm ci:local`", commands: ["pnpm check:a0-decoder-fuzz", "pnpm check:a0-tooling-deferral", "pnpm check:a0-alpha-qualification", "pnpm check", "pnpm ci:local"] },
  { id: "A0-10", features: ["CLI-01", "DOC-01", "REL-01"], dependencies: "A0-09", artifacts: "Mechanical release commit, exact tag, public package, immutable docs artifact, install verification, release notes, normalized public transport recovery", validation: "Historical tagged-source `pnpm check:a0-first-alpha-release`; `pnpm verify:a0-release-event`; tag/source/package/docs identity; `pnpm verify:a0-public-alpha`; `pnpm check:a0-public-release`; exact `alpha` and `latest`; clean public install/create/test/check/build/deploy; rollback drill; `pnpm ci:local`", commands: ["pnpm check:a0-first-alpha-release", "pnpm verify:a0-release-event", "pnpm verify:a0-public-alpha", "pnpm check:a0-public-release", "pnpm ci:local"] },
] as const;
const a0 = read("docs/roadmap/a0.md");
const a0Rows = tableRows(a0, /^\| A0-\d{2} \|/);
const a0Ids = a0Rows.map((cells) => cells[0]);
const expectedA0Ids = expectedA0.map((entry) => entry.id);
if (JSON.stringify(a0Ids) !== JSON.stringify(expectedA0Ids)) {
  errors.push(`docs/roadmap/a0.md: expected ordered slices ${expectedA0Ids.join(", ")}`);
}
for (const duplicate of duplicates(a0Ids)) errors.push(`docs/roadmap/a0.md: duplicate slice ${duplicate}`);

for (const [index, expected] of expectedA0.entries()) {
  const cells = a0Rows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 6) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} must have exactly 6 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  for (const feature of features) {
    if (!scopeSet.has(feature)) errors.push(`docs/roadmap/a0.md: ${expected.id} references unknown feature ${feature}`);
  }
  if (cells[3] !== expected.dependencies) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} dependency contract differs from the accepted plan`);
  }
  if (/\bDG-A0-\d{2}\b/.test(cells[3])) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} lists an owned decision gate as a prerequisite`);
  }
  if (cells[4] !== expected.artifacts) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} artifact contract differs from the accepted plan`);
  }
  const rowGates = [...`${cells[1]} ${cells[4]} ${cells[5]}`.matchAll(/\b(DG-A0-\d{2})\b/g)].map((match) => match[1]);
  if (rowGates.length !== 0) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} decision ownership differs from the accepted plan`);
  }
  if (cells[5] !== expected.validation) {
    errors.push(`docs/roadmap/a0.md: ${expected.id} validation contract differs from the accepted plan`);
  }
  for (const command of expected.commands) {
    if (!cells[5].includes(`\`${command}\``)) {
      errors.push(`docs/roadmap/a0.md: ${expected.id} missing validation command ${command}`);
    }
  }
}
const openA0Gates = new Set(gateIds.filter((gate) => gate.startsWith("DG-A0-")));
for (const gate of openA0Gates) {
  errors.push(`docs/roadmap/a0.md: no atomic slice owns ${gate}`);
}

const expectedV2 = V2_PLAN_ROWS;
const v2 = read("docs/roadmap/v2.md");
const v2Rows = tableRows(v2, /^\| V2-\d{2}[A-Z]? \|/);
const v2Ids = v2Rows.map((cells) => cells[0]);
const expectedV2Ids = expectedV2.map((entry) => entry.id);
if (JSON.stringify(v2Ids) !== JSON.stringify(expectedV2Ids)) {
  errors.push(`docs/roadmap/v2.md: expected ordered slices ${expectedV2Ids.join(", ")}`);
}
for (const duplicate of duplicates(v2Ids)) errors.push(`docs/roadmap/v2.md: duplicate slice ${duplicate}`);
for (const [index, expected] of expectedV2.entries()) {
  const cells = v2Rows[index];
  if (!cells || cells[0] !== expected.id) continue;
  if (cells.length !== 6) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} must have exactly 6 columns`);
    continue;
  }
  const features = [...cells[2].matchAll(/\b([A-Z]+-\d{2})\b/g)].map((match) => match[1]);
  if (JSON.stringify(features) !== JSON.stringify(expected.features)) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} feature ownership differs from the accepted plan`);
  }
  for (const feature of features) {
    if (!scopeSet.has(feature)) errors.push(`docs/roadmap/v2.md: ${expected.id} references unknown feature ${feature}`);
  }
  if (cells[3] !== expected.dependencies) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} dependency contract differs from the accepted plan`);
  }
  if (cells[4] !== expected.artifacts) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} artifact contract differs from the accepted plan`);
  }
  if (cells[5] !== expected.validation) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} validation contract differs from the accepted plan`);
  }
  const gates = [...`${cells[1]} ${cells[3]} ${cells[4]}`.matchAll(/\bDG-V2-\d{2}\b/g)].map((match) => match[0]);
  const expectedGates = expected.id === "V2-00" || expected.id === "V2-01" ? ["DG-V2-01"] : [];
  if (JSON.stringify(gates) !== JSON.stringify(expectedGates)) {
    errors.push(`docs/roadmap/v2.md: ${expected.id} decision ownership differs from the accepted plan`);
  }
}
if (gateIds.includes("DG-V2-01")) errors.push("docs/roadmap/v2.md: resolved DG-V2-01 must leave the open gate ledger");

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
