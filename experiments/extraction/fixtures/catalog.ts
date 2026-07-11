import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTRACTION_ACCEPTED_CLASSES = [
  "toggle",
  "disclosure",
  "tabs",
  "menu",
  "local-counter",
] as const;

export const EXTRACTION_REJECTION_CLASSES = [
  "server-secret",
  "server-module",
  "opaque-capability",
  "class-instance",
  "cyclic-data",
  "dynamic-import",
  "ambient-switch",
  "async-lifetime",
  "oversized-capture",
  "non-deterministic-closure",
] as const;

type AcceptedClass = (typeof EXTRACTION_ACCEPTED_CLASSES)[number];
type RejectionClass = (typeof EXTRACTION_REJECTION_CLASSES)[number];

type Fixture = Readonly<{
  id: string;
  classification: "accepted" | "rejected";
  interactionClass?: AcceptedClass;
  rejectionClass?: RejectionClass;
  source: string;
  trigger: "click";
  modules: readonly Readonly<{ id: string; role: "document" | "handler" | "shared" | "server" }>[];
  edges: readonly Readonly<{ from: string; to: string; kind: "lazy" | "static" | "forbidden" }>[];
}>;

const accepted = EXTRACTION_ACCEPTED_CLASSES.map((interactionClass): Fixture => ({
  id: interactionClass,
  classification: "accepted",
  interactionClass,
  source: `accepted/${interactionClass}.ts`,
  trigger: "click",
  modules: [
    { id: "document", role: "document" },
    { id: "handler", role: "handler" },
    { id: "shared", role: "shared" },
  ],
  edges: [
    { from: "document", to: "handler", kind: "lazy" },
    { from: "handler", to: "shared", kind: "static" },
  ],
}));

const rejected = EXTRACTION_REJECTION_CLASSES.map((rejectionClass): Fixture => ({
  id: rejectionClass,
  classification: "rejected",
  rejectionClass,
  source: `rejected/${rejectionClass}.ts`,
  trigger: "click",
  modules: [
    { id: "document", role: "document" },
    { id: "handler", role: "handler" },
    ...(rejectionClass === "server-secret" || rejectionClass === "server-module"
      ? [{ id: "server", role: "server" as const }]
      : []),
  ],
  edges: rejectionClass === "server-secret" || rejectionClass === "server-module"
    ? [{ from: "handler", to: "server", kind: "forbidden" as const }]
    : [],
}));

export const EXTRACTION_FIXTURES: readonly Fixture[] = [...accepted, ...rejected];

const fixtureRoot = dirname(fileURLToPath(import.meta.url));

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function actualSourceFiles(root: string): string[] {
  return ["accepted", "rejected"].flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
        throw new Error(`FADENO_EXTRACTION_FIXTURE_FILE: ${directory}/${entry.name}`);
      }
      if (entry.name === "README.md") return [];
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        throw new Error(`FADENO_EXTRACTION_FIXTURE_FILE: ${directory}/${entry.name}`);
      }
      return relative(root, path).split(sep).join("/");
    })
  ).sort();
}

export function stableExtractionInventory(root = fixtureRoot): string {
  const declared = EXTRACTION_FIXTURES.map((fixture) => fixture.source).sort();
  const actual = actualSourceFiles(root);
  if (JSON.stringify(actual) !== JSON.stringify(declared)) {
    throw new Error("FADENO_EXTRACTION_FIXTURE_SET: declared and actual sources differ");
  }
  return `${JSON.stringify({
    schemaVersion: 1,
    visibility: "private-experiment",
    fixtures: EXTRACTION_FIXTURES.map((fixture) => ({
      ...fixture,
      source: { path: fixture.source, sha256: sha256(join(root, fixture.source)) },
    })),
  })}\n`;
}
