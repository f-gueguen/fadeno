import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type A0PlanContext = Readonly<{
  registry: unknown;
  roadmap: string;
  decisionGates: string;
  readme: string;
  packageDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadA0PlanContext(root: string, tracked: ReadonlySet<string>): A0PlanContext {
  return Object.freeze({
    registry: JSON.parse(readFileSync(join(root, "evidence/a0/registry-discovery.json"), "utf8")) as unknown,
    roadmap: readFileSync(join(root, "docs/roadmap/a0.md"), "utf8"),
    decisionGates: readFileSync(join(root, "docs/ledgers/decision-gates.md"), "utf8"),
    readme: readFileSync(join(root, "README.md"), "utf8"),
    packageDocument: JSON.parse(readFileSync(join(root, "packages/framework/package.json"), "utf8")) as unknown,
    tracked,
  });
}

export function validateA0Plan(context: A0PlanContext): readonly string[] {
  const errors: string[] = [];
  if (!context.tracked.has("evidence/a0/registry-discovery.json")) errors.push("A0 registry evidence is not tracked");
  const registry = context.registry;
  if (!isRecord(registry)) errors.push("A0 registry evidence must be an object");
  else {
    if (registry["schemaVersion"] !== 1) errors.push("A0 registry schemaVersion must be 1");
    if (registry["observedAt"] !== "2026-07-17") errors.push("A0 registry observation date mismatch");
    if (registry["registry"] !== "https://registry.npmjs.org/") errors.push("A0 registry authority mismatch");
    if (registry["unscopedIdentity"] !== "fadeno" || registry["unscopedAvailability"] !== "occupied") errors.push("A0 unscoped registry evidence mismatch");
    if (registry["authenticatedOwner"] !== null || registry["selectedIdentity"] !== null) errors.push("A0 registry identity was selected before ownership verification");
    if (registry["blocker"] !== "registry-authentication-required" || registry["publicationAuthorized"] !== false) errors.push("A0 registry blocker must remain fail-closed");
  }

  const slices = [...context.roadmap.matchAll(/^\| A0-(\d{2}) \|/gmu)].map((match) => match[1]);
  const expectedSlices = Array.from({ length: 11 }, (_value, index) => String(index).padStart(2, "0"));
  if (JSON.stringify(slices) !== JSON.stringify(expectedSlices)) errors.push("A0 roadmap slices must be exactly A0-00 through A0-10 in order");
  const rows = context.roadmap
    .split("\n")
    .filter((line) => /^\| A0-\d{2} \|/u.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const expectedDependencies = [
    "V1-14D",
    "A0-00",
    "A0-00, authenticated registry ownership",
    "A0-02",
    "A0-03",
    "A0-04",
    "A0-04",
    "A0-05, A0-06",
    "A0-07",
    "A0-01 through A0-08",
    "A0-09",
  ];
  const expectedOwners = new Map([
    ["A0-01", "DG-A0-03"],
    ["A0-02", "DG-A0-01"],
    ["A0-06", "DG-A0-04"],
    ["A0-08", "DG-A0-02"],
  ]);
  for (const [index, row] of rows.entries()) {
    const slice = row[0] ?? `A0-${String(index).padStart(2, "0")}`;
    if (row.length !== 6) {
      errors.push(`A0 roadmap ${slice} must have exactly 6 columns`);
      continue;
    }
    if (row[3] !== expectedDependencies[index]) errors.push(`A0 roadmap ${slice} dependency contract mismatch`);
    if (/\bDG-A0-\d{2}\b/u.test(row[3] ?? "")) errors.push(`A0 roadmap ${slice} uses its decision outcome as a prerequisite`);
    const actualOwners = [...(row[4] ?? "").matchAll(/\b(DG-A0-\d{2})\b/gu)].map((match) => match[1]);
    const expectedOwner = expectedOwners.get(slice);
    if (JSON.stringify(actualOwners) !== JSON.stringify(expectedOwner ? [expectedOwner] : [])) {
      errors.push(`A0 roadmap ${slice} decision ownership mismatch`);
    }
  }
  for (const gate of ["DG-A0-01", "DG-A0-02", "DG-A0-03", "DG-A0-04"]) {
    const line = context.decisionGates.split("\n").find((candidate) => candidate.startsWith(`| ${gate} |`));
    if (!line?.endsWith("| Open |")) errors.push(`A0 unresolved decision gate drifted: ${gate}`);
  }

  const packageDocument = context.packageDocument;
  if (!isRecord(packageDocument)
    || packageDocument["name"] !== "fadeno-framework-internal"
    || packageDocument["version"] !== "0.0.0-private"
    || packageDocument["private"] !== true
    || Object.hasOwn(packageDocument, "publishConfig")) {
    errors.push("A0 planning crossed the private package boundary");
  }
  if (!context.readme.includes("completed its qualified private V1") || !context.readme.includes("current A0 plan")) errors.push("A0 repository status is stale");
  return errors;
}
