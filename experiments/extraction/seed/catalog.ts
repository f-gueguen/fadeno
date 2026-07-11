import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const modules = [
  { path: "document.html", requestPath: "/", role: "document", contentType: "text/html" },
  { path: "document.js", requestPath: "/document.js", role: "document", contentType: "text/javascript" },
  { path: "handler.js", requestPath: "/handler.js", role: "handler", contentType: "text/javascript" },
  { path: "shared.js", requestPath: "/shared.js", role: "shared", contentType: "text/javascript" },
] as const;

const edges = [
  { from: "/document.js", to: "/handler.js", kind: "lazy" },
  { from: "/handler.js", to: "/shared.js", kind: "static" },
] as const;

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function assertExactFiles(): void {
  const actual = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== "catalog.ts" && entry.name !== "inventory.golden.json")
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || lstatSync(join(root, entry.name)).isSymbolicLink()) {
        throw new Error(`FADENO_EXTRACTION_SEED_FILE: ${entry.name}`);
      }
      return entry.name;
    })
    .sort();
  const expected = modules.map((module) => module.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("FADENO_EXTRACTION_SEED_SET");
  }
}

export function loadExtractionHarnessSeed(): ReadonlyMap<
  string,
  Readonly<{ body: string; contentType: string }>
> {
  assertExactFiles();
  return new Map(modules.map((module) => [
    module.requestPath,
    { body: readFileSync(join(root, module.path), "utf8"), contentType: module.contentType },
  ]));
}

export function stableExtractionHarnessSeed(): string {
  assertExactFiles();
  return `${JSON.stringify({
    schemaVersion: 1,
    visibility: "private-harness-seed",
    modules: modules.map((module) => {
      const body = readFileSync(join(root, module.path), "utf8");
      return { ...module, sha256: sha256(body) };
    }),
    edges,
  })}\n`;
}
