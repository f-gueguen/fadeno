import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { createScanner, SyntaxKind } from "typescript/unstable/ast";

export type ModuleReference = Readonly<{
  kind: "dynamic-import" | "export-from" | "import";
  specifier: string;
}>;

export type PackageBoundaryViolation = Readonly<{
  code: "FADENO_PACKAGE_CROSS_RELATIVE";
  file: string;
  kind: ModuleReference["kind"];
  specifier: string;
}>;

type Token = Readonly<{ kind: SyntaxKind; value: string }>;

const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

export function scanModuleReferences(source: string): ModuleReference[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: Token[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({ kind, value: scanner.getTokenValue() });
  }

  const references: ModuleReference[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind === SyntaxKind.ImportKeyword) {
      const next = tokens[index + 1];
      if (next?.kind === SyntaxKind.DotToken) continue;
      if (next?.kind === SyntaxKind.OpenParenToken) {
        const specifier = tokens[index + 2];
        if (specifier?.kind === SyntaxKind.StringLiteral) {
          references.push({ kind: "dynamic-import", specifier: specifier.value });
        }
        continue;
      }
      if (next?.kind === SyntaxKind.StringLiteral) {
        references.push({ kind: "import", specifier: next.value });
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor]?.kind === SyntaxKind.SemicolonToken) break;
        if (tokens[cursor]?.kind === SyntaxKind.FromKeyword) {
          const specifier = tokens[cursor + 1];
          if (specifier?.kind === SyntaxKind.StringLiteral) references.push({ kind: "import", specifier: specifier.value });
          break;
        }
      }
    }
    if (token?.kind === SyntaxKind.ExportKeyword) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor]?.kind === SyntaxKind.SemicolonToken) break;
        if (tokens[cursor]?.kind === SyntaxKind.FromKeyword) {
          const specifier = tokens[cursor + 1];
          if (specifier?.kind === SyntaxKind.StringLiteral) references.push({ kind: "export-from", specifier: specifier.value });
          break;
        }
      }
    }
  }
  return references;
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function existingTarget(specifierPath: string): string | undefined {
  const candidates = [
    specifierPath,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${specifierPath}${extension}`),
    ...["index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.mjs", "index.cjs"].map((file) => join(specifierPath, file)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  return undefined;
}

function containedBy(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function inspectPackageBoundaries(repositoryRoot: string): PackageBoundaryViolation[] {
  const packagesRoot = join(repositoryRoot, "packages");
  if (!existsSync(packagesRoot)) return [];
  const violations: PackageBoundaryViolation[] = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = realpathSync(join(packagesRoot, entry.name));
    for (const file of sourceFiles(packageRoot)) {
      for (const reference of scanModuleReferences(readFileSync(file, "utf8"))) {
        if (!reference.specifier.startsWith(".")) continue;
        const lexicalTarget = resolve(dirname(file), reference.specifier);
        const canonicalTarget = existingTarget(lexicalTarget);
        if (!containedBy(packageRoot, lexicalTarget) || (canonicalTarget !== undefined && !containedBy(packageRoot, canonicalTarget))) {
          violations.push({
            code: "FADENO_PACKAGE_CROSS_RELATIVE",
            file: relative(repositoryRoot, file),
            kind: reference.kind,
            specifier: reference.specifier,
          });
        }
      }
    }
  }
  return violations;
}
