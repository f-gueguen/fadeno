import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { createScanner, SyntaxKind } from "typescript/unstable/ast";

export type ModuleReference = Readonly<{
  kind: "dynamic-import" | "export-from" | "import" | "require";
  specifier: string;
}>;

export type PackageBoundaryViolation = Readonly<{
  code: "FADENO_PACKAGE_CROSS_RELATIVE" | "FADENO_PACKAGE_EXPORTS" | "FADENO_PACKAGE_SYMLINK_ESCAPE";
  file: string;
  kind: ModuleReference["kind"] | "manifest" | "symlink";
  specifier: string;
}>;

type Token = Readonly<{ kind: SyntaxKind; precedingLineBreak: boolean; value: string }>;

const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

export function scanModuleReferences(source: string): ModuleReference[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: Token[] = [];
  const templateExpressionDepth: number[] = [];
  let previousTokenEnd = -1;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    const templateIndex = templateExpressionDepth.length - 1;
    if (kind === SyntaxKind.CloseBraceToken && templateIndex >= 0) {
      if (templateExpressionDepth[templateIndex] === 0) kind = scanner.reScanTemplateToken(false);
      else templateExpressionDepth[templateIndex]! -= 1;
    }
    const tokenEnd = scanner.getTokenEnd();
    if (tokenEnd <= previousTokenEnd) throw new TypeError(`FADENO_PACKAGE_SCANNER_PROGRESS:${tokenEnd}`);
    previousTokenEnd = tokenEnd;
    tokens.push({ kind, precedingLineBreak: scanner.hasPrecedingLineBreak(), value: scanner.getTokenValue() });
    if (kind === SyntaxKind.TemplateHead) templateExpressionDepth.push(0);
    else if (kind === SyntaxKind.TemplateTail) templateExpressionDepth.pop();
    else if (kind === SyntaxKind.OpenBraceToken && templateIndex >= 0) templateExpressionDepth[templateIndex]! += 1;
  }

  const references: ModuleReference[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind === SyntaxKind.ImportKeyword) {
      const next = tokens[index + 1];
      if (next?.kind === SyntaxKind.DotToken) continue;
      if (next?.kind === SyntaxKind.OpenParenToken) {
        const specifier = tokens[index + 2];
        if (specifier?.kind === SyntaxKind.StringLiteral || specifier?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
          references.push({ kind: "dynamic-import", specifier: specifier.value });
        }
        continue;
      }
      if (next?.kind === SyntaxKind.StringLiteral) {
        references.push({ kind: "import", specifier: next.value });
        continue;
      }
      let braces = 0;
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (!candidate) break;
        if (candidate.kind === SyntaxKind.OpenBraceToken) braces += 1;
        if (candidate.kind === SyntaxKind.CloseBraceToken) braces -= 1;
        if (braces === 0 && candidate.kind === SyntaxKind.SemicolonToken) break;
        if (braces === 0 && candidate.kind === SyntaxKind.FromKeyword) {
          const specifier = tokens[cursor + 1];
          if (specifier?.kind === SyntaxKind.StringLiteral) references.push({ kind: "import", specifier: specifier.value });
          break;
        }
      }
    }
    if (token?.kind === SyntaxKind.ExportKeyword) {
      let braces = 0;
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (!candidate) break;
        if (candidate.kind === SyntaxKind.OpenBraceToken) braces += 1;
        if (candidate.kind === SyntaxKind.CloseBraceToken) braces -= 1;
        if (braces === 0 && candidate.kind === SyntaxKind.SemicolonToken) break;
        if (braces === 0 && candidate.kind === SyntaxKind.FromKeyword) {
          const specifier = tokens[cursor + 1];
          if (specifier?.kind === SyntaxKind.StringLiteral) references.push({ kind: "export-from", specifier: specifier.value });
          break;
        }
      }
    }
    if ((token?.kind === SyntaxKind.RequireKeyword || (token?.kind === SyntaxKind.Identifier && token.value === "require")) && tokens[index + 1]?.kind === SyntaxKind.OpenParenToken) {
      const specifier = tokens[index + 2];
      if (specifier?.kind === SyntaxKind.StringLiteral || specifier?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        references.push({ kind: "require", specifier: specifier.value });
      }
    }
  }
  return references;
}

function sourceFiles(directory: string, packageRoot: string, repositoryRoot: string, violations: PackageBoundaryViolation[], visited = new Set<string>()): string[] {
  if (!existsSync(directory)) return [];
  const canonicalDirectory = realpathSync(directory);
  if (visited.has(canonicalDirectory)) return [];
  visited.add(canonicalDirectory);
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) {
      const canonical = realpathSync(path);
      if (!containedBy(packageRoot, canonical)) {
        violations.push({ code: "FADENO_PACKAGE_SYMLINK_ESCAPE", file: relative(repositoryRoot, path), kind: "symlink", specifier: canonical });
        continue;
      }
      if (statSync(canonical).isDirectory()) files.push(...sourceFiles(canonical, packageRoot, repositoryRoot, violations, visited));
      else if (sourceExtensions.has(extname(entry.name))) files.push(canonical);
    } else if (entry.isDirectory()) files.push(...sourceFiles(path, packageRoot, repositoryRoot, violations, visited));
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
  const canonicalPackagesRoot = realpathSync(packagesRoot);
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    const lexicalPackageRoot = join(packagesRoot, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const packageRoot = realpathSync(lexicalPackageRoot);
    if (!containedBy(canonicalPackagesRoot, packageRoot)) {
      violations.push({ code: "FADENO_PACKAGE_SYMLINK_ESCAPE", file: relative(repositoryRoot, lexicalPackageRoot), kind: "symlink", specifier: packageRoot });
      continue;
    }
    const manifestPath = join(packageRoot, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { exports?: unknown };
      const exports = manifest.exports;
      if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
        violations.push({ code: "FADENO_PACKAGE_EXPORTS", file: relative(repositoryRoot, manifestPath), kind: "manifest", specifier: "missing explicit exports object" });
      } else {
        const subpaths = Object.keys(exports);
        const exactPublicSubpaths = [".", "./node", "./jsx-runtime", "./browser"];
        for (const required of exactPublicSubpaths) {
          if (!subpaths.includes(required)) {
            violations.push({ code: "FADENO_PACKAGE_EXPORTS", file: relative(repositoryRoot, manifestPath), kind: "manifest", specifier: `missing ${required}` });
          }
        }
        for (const subpath of subpaths) {
          if (!exactPublicSubpaths.includes(subpath)) {
            violations.push({ code: "FADENO_PACKAGE_EXPORTS", file: relative(repositoryRoot, manifestPath), kind: "manifest", specifier: subpath });
          }
        }
      }
    }
    for (const file of sourceFiles(packageRoot, packageRoot, repositoryRoot, violations)) {
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
