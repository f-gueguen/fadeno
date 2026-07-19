import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type V2PlanContext = Readonly<{
  roadmap: string;
  outcomeRoadmap: string;
  decisionGates: string;
  scope: string;
  traceability: string;
  risks: string;
  ledger: string;
  packageDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadV2PlanContext(root: string, tracked: ReadonlySet<string>): V2PlanContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    roadmap: read("docs/roadmap/v2.md"),
    outcomeRoadmap: read("docs/roadmap.md"),
    decisionGates: read("docs/ledgers/decision-gates.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    tracked,
  });
}

export function validateV2Plan(context: V2PlanContext): readonly string[] {
  const errors: string[] = [];
  for (const path of [
    "docs/roadmap/v2.md",
    "scripts/check-v2-plan.ts",
    "scripts/lib/v2-plan.ts",
    "scripts/test-v2-plan.ts",
  ]) if (!context.tracked.has(path)) errors.push(`V2 plan artifact is not tracked: ${path}`);

  const rows = context.roadmap
    .split("\n")
    .filter((line) => /^\| V2-\d{2} \|/u.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const ids = rows.map((row) => row[0]);
  const expectedIds = Array.from({ length: 12 }, (_value, index) => `V2-${String(index).padStart(2, "0")}`);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) errors.push("V2 roadmap slices must be exactly V2-00 through V2-11 in order");

  const dependencies = [
    "A0-10, ADR 0014",
    "DG-V2-01; V2-00; ADR 0014; V1 action round trip",
    "V2-01",
    "V2-02",
    "V2-03",
    "V2-04; ADR 0014",
    "V2-03, V2-04",
    "V2-05, V2-06",
    "V2-05, V2-07; K0-04",
    "V2-07, V2-08",
    "V2-09",
    "V2-09, V2-10",
  ];
  for (const [index, row] of rows.entries()) {
    const id = row[0] ?? expectedIds[index] ?? "V2-unknown";
    if (row.length !== 6) {
      errors.push(`V2 roadmap ${id} must have exactly 6 columns`);
      continue;
    }
    if (row[3] !== dependencies[index]) errors.push(`V2 roadmap ${id} dependency contract mismatch`);
    const gates = [...`${row[1]} ${row[3]} ${row[4]}`.matchAll(/\bDG-V2-\d{2}\b/gu)].map((match) => match[0]);
    const expectedGates = id === "V2-00" || id === "V2-01" ? ["DG-V2-01"] : [];
    if (JSON.stringify(gates) !== JSON.stringify(expectedGates)) {
      errors.push(`V2 roadmap ${id} decision ownership mismatch`);
    }
    if (!(row[4] ?? "").length || !(row[5] ?? "").length) errors.push(`V2 roadmap ${id} is missing artifacts or validation`);
  }

  const roadmap = context.roadmap.replace(/\s+/gu, " ");
  for (const fragment of [
    "optional browser delivery path",
    "same server-owned application outcome",
    "DG-V2-01 remains open",
    "Native links and forms remain the correctness baseline",
    "Islands remain V3",
    "Every user-observable slice extends the canonical application",
    "success, deliberate failure or refusal",
    "ownership/causal flow inspection",
  ]) if (!roadmap.includes(fragment)) errors.push(`V2 roadmap is missing ${fragment}`);

  const gateRow = context.decisionGates.split("\n").find((line) => line.startsWith("| DG-V2-01 |")) ?? "";
  for (const fragment of ["ENH-01 implementation", "scroll boundary", "ordering", "recovery", "version negotiation", "Open"]) {
    if (!gateRow.includes(fragment)) errors.push(`DG-V2-01 is missing ${fragment}`);
  }
  if (!context.outcomeRoadmap.includes("[V2 plan](roadmap/v2.md)")) errors.push("outcome roadmap does not link the V2 plan");
  if (!context.ledger.includes("V2-00 — decompose browser enhancement")
    || !context.ledger.includes("A0-10 — Merge commit `60d55c7`")
    || !context.ledger.includes("No V2 implementation may begin before DG-V2-01")) {
    errors.push("V2 roadmap ledger state drifted");
  }

  for (const feature of ["ENH-01", "PATCH-01"]) {
    const scope = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const trace = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scope.includes("V2 plan") || !scope.includes("DG-V2-01")) errors.push(`${feature} scope is missing V2-00 ownership`);
    if (!trace.includes("V2 plan") || !trace.includes("DG-V2-01")) errors.push(`${feature} traceability is missing V2-00 ownership`);
  }
  const risk = context.risks.split("\n").find((line) => line.startsWith("| Browser updates destroy user state")) ?? "";
  if (!risk.includes("V2-00") || !risk.includes("DG-V2-01")) errors.push("V2 browser-state risk is missing plan ownership");

  const packageDocument = context.packageDocument;
  if (!isRecord(packageDocument)
    || packageDocument["name"] !== "@fadeno/framework"
    || packageDocument["version"] !== "0.1.0-alpha.1"
    || Object.hasOwn(packageDocument, "private")) errors.push("V2 entry package identity drifted");
  return Object.freeze(errors);
}
