import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const errors = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const hypotheses = read("docs/ledgers/hypotheses.md");
const hypothesisBlocks = hypotheses.split(/^## /m).slice(1);
const hypothesisIds = new Set();

for (const block of hypothesisBlocks) {
  const heading = block.split("\n", 1)[0];
  const idMatch = heading.match(/^(H\d+) — /);
  if (!idMatch) {
    errors.push(`hypothesis ledger: invalid active-hypothesis heading ${heading}`);
    continue;
  }

  const id = idMatch[1];
  if (hypothesisIds.has(id)) {
    errors.push(`hypothesis ledger: duplicate stable identifier ${id}`);
  }
  hypothesisIds.add(id);

  for (const field of ["- Claim:", "- Experiment:", "- Pass:", "- Pivot:", "- Status:"]) {
    if (!block.includes(field)) {
      errors.push(`hypothesis ${id}: missing ${field}`);
    }
  }

  const status = block.match(/^- Status: ([^\n]+)$/m)?.[1]?.replace(/\.$/, "");
  if (status && !["Not started", "In progress", "Blocked"].includes(status)) {
    errors.push(`hypothesis ${id}: status must describe an active claim`);
  }
}

const risks = read("docs/ledgers/risks.md");
const riskRows = risks
  .split("\n")
  .filter((line) => line.startsWith("|") && !line.includes("---"));
if (riskRows.length < 2) {
  errors.push("docs/ledgers/risks.md: expected a populated risk table");
}

const deferrals = read("docs/ledgers/deferrals.md");
const deferralRows = deferrals
  .split("\n")
  .filter((line) => line.startsWith("|") && !line.includes("---"));
if (deferralRows.length < 2) {
  errors.push("docs/ledgers/deferrals.md: expected a populated deferral table");
}

const decisionGates = read("docs/ledgers/decision-gates.md");
const gateRows = decisionGates
  .split("\n")
  .filter((line) => /^\| DG-[A-Z0-9]+-\d{2} \|/.test(line));
if (gateRows.length === 0) {
  errors.push("docs/ledgers/decision-gates.md: expected a populated gate table");
}
for (const row of gateRows) {
  if (!row.endsWith("| Open |")) {
    errors.push("docs/ledgers/decision-gates.md: current gates must have Open status");
  }
}

const roadmapLedger = read("ROADMAP_LEDGER.md");
for (const section of [
  "## Current slice",
  "## Exit criteria",
  "## In progress",
  "## Blockers",
  "## Open questions",
  "## Completed slices",
]) {
  if (!roadmapLedger.includes(section)) {
    errors.push(`ROADMAP_LEDGER.md: missing section ${section}`);
  }
}

if (!/^[-*] \[[ x]\] /m.test(roadmapLedger)) {
  errors.push("ROADMAP_LEDGER.md: exit criteria must use checkboxes");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("ledger check passed");
