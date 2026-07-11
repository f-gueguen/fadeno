import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as ast from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import { visitEachChild } from "typescript/unstable/ast/visitor";
import { API, SymbolFlags } from "typescript/unstable/sync";
import type { Project, Symbol as TypeScriptSymbol } from "typescript/unstable/sync";

import type { ExtractionDiagnostic } from "./contract.ts";
import {
  EXTRACTION_DIAGNOSTIC_EXPECTATIONS,
  EXTRACTION_ROOT_EXPORTS,
} from "./qualification-contract.ts";

export type ExtractionFixtureId = keyof typeof EXTRACTION_ROOT_EXPORTS;

export type ExtractionAnalysis = Readonly<{
  fixtureId: ExtractionFixtureId;
  rootExport: string;
  rootSource: string;
  closureSource: string;
  captureStatements: readonly string[];
  behaviorAlias: string;
  behaviorName: string;
  behaviorSource: string;
  behaviorPath: string;
  diagnostic?: ExtractionDiagnostic;
}>;

export type GeneratedHandler = Readonly<{
  fixtureId: ExtractionFixtureId;
  path: string;
  sha256: string;
  bytes: number;
  handlerIdentity: string;
}>;

export function runQualificationBoundary(
  analysis: ExtractionAnalysis,
  secretCanary: string,
  callbacks: Readonly<{
    emitBrowserArtifact: (source: string) => void;
    startServer: () => void;
    startBrowser: () => void;
  }>,
): ExtractionDiagnostic | undefined {
  if (analysis.diagnostic) return analysis.diagnostic;
  callbacks.emitBrowserArtifact(`export const leaked = ${JSON.stringify(secretCanary)};`);
  callbacks.startServer();
  callbacks.startBrowser();
}

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(experimentRoot, "../..");
const fixtureRoot = join(experimentRoot, "fixtures");
const rootSourcePath = join(fixtureRoot, "qualification/roots.ts");
const projectPath = join(experimentRoot, "tsconfig.json");

function visit(root: Node, callback: (node: Node) => void): void {
  const visitor = (node: Node): Node => {
    callback(node);
    return visitEachChild(node, visitor);
  };
  visitor(root);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceName(sourceFile: SourceFile): string {
  const path = relative(fixtureRoot, sourceFile.fileName).split(sep).join("/");
  return path.startsWith("../") ? basename(sourceFile.fileName) : path;
}

function range(sourceFile: SourceFile, node: Node) {
  const start = node.getStart(sourceFile);
  const before = sourceFile.text.slice(0, start);
  return {
    line: before.split("\n").length,
    column: start - before.lastIndexOf("\n"),
    length: node.getWidth(sourceFile),
  };
}

function diagnosticFor(
  sourceFile: SourceFile,
  node: Node,
  code: keyof typeof diagnosticByCode,
  serverKind?: "secret" | "database",
): ExtractionDiagnostic {
  const template = code === "FADENO_K0_EXTRACT_SERVER_IMPORT"
    ? EXTRACTION_DIAGNOSTIC_EXPECTATIONS[
        serverKind === "database" ? "server-module" : "server-secret"
      ]
    : diagnosticByCode[code];
  return {
    ...template,
    source: sourceName(sourceFile),
    range: range(sourceFile, node),
  };
}

const diagnosticByCode = {
  FADENO_K0_EXTRACT_SERVER_IMPORT: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["server-secret"],
  FADENO_K0_EXTRACT_OPAQUE_CAPTURE: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["opaque-capability"],
  FADENO_K0_EXTRACT_CLASS_CAPTURE: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["class-instance"],
  FADENO_K0_EXTRACT_CYCLIC_CAPTURE: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["cyclic-data"],
  FADENO_K0_EXTRACT_DYNAMIC_IMPORT: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["dynamic-import"],
  FADENO_K0_EXTRACT_AMBIENT_CAPTURE: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["ambient-switch"],
  FADENO_K0_EXTRACT_ASYNC_LIFETIME: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["async-lifetime"],
  FADENO_K0_EXTRACT_CAPTURE_SIZE: EXTRACTION_DIAGNOSTIC_EXPECTATIONS["oversized-capture"],
  FADENO_K0_EXTRACT_NON_DETERMINISTIC_CAPTURE:
    EXTRACTION_DIAGNOSTIC_EXPECTATIONS["non-deterministic-closure"],
  FADENO_K0_EXTRACT_AMBIGUOUS_FLOW: {
    id: "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW",
    severity: "error" as const,
    message: "A browser handler dependency cannot be resolved conservatively.",
    explanation: "docs/diagnostics/extraction.md#fadeno-k0-extract-ambiguous-flow",
    correction: "Use a statically resolvable dependency or an explicit island.",
  },
} as const;

function identifierText(node: Node | undefined): string | undefined {
  return node && ast.isIdentifier(node) ? node.text : undefined;
}

function isTopLevelVariableInitializer(node: ast.CallExpression): boolean {
  if (!ast.isVariableDeclaration(node.parent) || node.parent.initializer !== node) return false;
  let cursor: Node | undefined = node.parent.parent;
  while (cursor && !ast.isSourceFile(cursor)) {
    if (ast.isFunctionLikeDeclaration(cursor)) return false;
    cursor = cursor.parent;
  }
  return Boolean(cursor);
}

export function classifyModule(sourceFile: SourceFile): ExtractionDiagnostic | undefined {
  for (const statement of sourceFile.statements) {
    if (
      (ast.isImportDeclaration(statement) || ast.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ast.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("server-only:")
    ) {
      return diagnosticFor(
        sourceFile,
        statement.moduleSpecifier,
        "FADENO_K0_EXTRACT_SERVER_IMPORT",
        statement.moduleSpecifier.text.includes("database") ? "database" : "secret",
      );
    }
  }

  let found: ExtractionDiagnostic | undefined;
  visit(sourceFile, (node) => {
    if (found) return;
    if (
      ast.isTypeOfExpression(node) &&
      identifierText(node.expression) === "window"
    ) {
      found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_AMBIENT_CAPTURE");
      return;
    }
    if (ast.isNewExpression(node)) {
      const name = identifierText(node.expression);
      if (name === "AbortController") {
        found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_OPAQUE_CAPTURE");
        return;
      }
      if (
        name &&
        sourceFile.statements.some((statement) =>
          ast.isClassDeclaration(statement) && statement.name?.text === name
        )
      ) {
        found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_CLASS_CAPTURE");
        return;
      }
    }
    if (ast.isCallExpression(node)) {
      if (
        ast.isImportExpression(node.expression) &&
        (!node.arguments[0] || !ast.isStringLiteral(node.arguments[0]))
      ) {
        found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_DYNAMIC_IMPORT");
        return;
      }
      const direct = identifierText(node.expression);
      if (direct === "setInterval" || direct === "setTimeout") {
        found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_ASYNC_LIFETIME");
        return;
      }
      if (ast.isPropertyAccessExpression(node.expression)) {
        const owner = identifierText(node.expression.expression);
        const member = node.expression.name.text;
        if (owner === "Math" && member === "random") {
          found = diagnosticFor(
            sourceFile,
            node,
            "FADENO_K0_EXTRACT_NON_DETERMINISTIC_CAPTURE",
          );
          return;
        }
        const argument = node.arguments[0];
        if (
          member === "repeat" &&
          argument &&
          ast.isNumericLiteral(argument) &&
          Number(argument.text) > 65_536
        ) {
          found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_CAPTURE_SIZE");
          return;
        }
      }
      if (isTopLevelVariableInitializer(node)) {
        found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW");
      }
    }
    if (
      ast.isBinaryExpression(node) &&
      node.operatorToken.kind === ast.SyntaxKind.EqualsToken &&
      ast.isPropertyAccessExpression(node.left) &&
      ast.isIdentifier(node.left.expression) &&
      ast.isIdentifier(node.right) &&
      node.left.expression.text === node.right.text
    ) {
      found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_CYCLIC_CAPTURE");
    }
  });
  return found;
}

export function classifyReachableModule(
  project: Project,
  sourceFile: SourceFile,
  seen = new Set<string>(),
): ExtractionDiagnostic | undefined {
  if (seen.has(sourceFile.fileName)) return;
  seen.add(sourceFile.fileName);
  const direct = classifyModule(sourceFile);
  if (direct) return direct;
  for (const statement of sourceFile.statements) {
    if (
      (!ast.isImportDeclaration(statement) && !ast.isExportDeclaration(statement)) ||
      !statement.moduleSpecifier ||
      !ast.isStringLiteral(statement.moduleSpecifier)
    ) continue;
    const symbol = project.checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!symbol) {
      return diagnosticFor(
        sourceFile,
        statement.moduleSpecifier,
        "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW",
      );
    }
    const target = resolveAlias(project, symbol);
    const declaration = target.declarations[0]?.resolve(project) ??
      target.valueDeclaration?.resolve(project);
    const dependency = declaration?.getSourceFile();
    if (!dependency || dependency.fileName.includes(`${sep}node_modules${sep}`)) continue;
    const nested = classifyReachableModule(project, dependency, seen);
    if (nested) return nested;
  }
}

function resolveAlias(
  project: Project,
  symbol: TypeScriptSymbol,
): TypeScriptSymbol {
  return (symbol.flags & SymbolFlags.Alias) !== 0
    ? project.checker.getAliasedSymbol(symbol)
    : symbol;
}

function findBehavior(
  project: Project,
  closure: Node,
): Readonly<{ alias: string; declaration: Node; sourceFile: SourceFile }> {
  const candidates: Array<Readonly<{ alias: string; declaration: Node; sourceFile: SourceFile }>> = [];
  visit(closure, (node) => {
    if (!ast.isCallExpression(node) || !ast.isIdentifier(node.expression)) return;
    const symbol = project.checker.getSymbolAtLocation(node.expression);
    if (!symbol) return;
    const target = resolveAlias(project, symbol);
    const declaration = target.valueDeclaration?.resolve(project) ??
      target.declarations[0]?.resolve(project);
    if (!declaration || !ast.isFunctionDeclaration(declaration)) return;
    const sourceFile = declaration.getSourceFile();
    if (!sourceFile.fileName.startsWith(fixtureRoot)) return;
    candidates.push({ alias: node.expression.text, declaration, sourceFile });
  });
  if (candidates.length !== 1) {
    throw new Error("FADENO_EXTRACTION_REACHABLE_BEHAVIOR");
  }
  return candidates[0]!;
}

function findRoot(project: Project, fixtureId: ExtractionFixtureId) {
  const sourceFile = project.program.getSourceFile({ uri: new URL(`file://${rootSourcePath}`).href });
  if (!sourceFile) throw new Error("FADENO_EXTRACTION_ROOT_SOURCE");
  const rootExport = EXTRACTION_ROOT_EXPORTS[fixtureId];
  const declaration = sourceFile.statements.find((statement) =>
    ast.isFunctionDeclaration(statement) && statement.name?.text === rootExport
  );
  if (!declaration || !ast.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`FADENO_EXTRACTION_ROOT_EXPORT: ${rootExport}`);
  }
  const markers: ast.CallExpression[] = [];
  visit(declaration.body, (node) => {
    if (
      ast.isCallExpression(node) &&
      ast.isIdentifier(node.expression) &&
      node.expression.text === "seedInteraction"
    ) markers.push(node);
  });
  const marker = markers[0];
  const closure = marker?.arguments[0];
  if (
    markers.length !== 1 ||
    !closure ||
    (!ast.isArrowFunction(closure) && !ast.isFunctionExpression(closure))
  ) {
    throw new Error(`FADENO_EXTRACTION_SELECTED_CLOSURE: ${rootExport}`);
  }
  const captureStatements = declaration.body.statements
    .filter(ast.isVariableStatement)
    .map((statement) => statement.getText(sourceFile));
  const isPlainCapture = (node: Node): boolean => {
    if (
      ast.isStringLiteral(node) ||
      ast.isNumericLiteral(node) ||
      node.kind === ast.SyntaxKind.TrueKeyword ||
      node.kind === ast.SyntaxKind.FalseKeyword ||
      node.kind === ast.SyntaxKind.NullKeyword
    ) return true;
    if (
      ast.isPrefixUnaryExpression(node) &&
      node.operator === ast.SyntaxKind.MinusToken &&
      ast.isNumericLiteral(node.operand)
    ) return true;
    if (
      ast.isCallExpression(node) &&
      ast.isPropertyAccessExpression(node.expression) &&
      ast.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "freeze" &&
      node.arguments.length === 1
    ) return isPlainCapture(node.arguments[0]!);
    if (ast.isArrayLiteralExpression(node)) {
      return node.elements.every(isPlainCapture);
    }
    if (ast.isObjectLiteralExpression(node)) {
      return node.properties.every((property) =>
        ast.isPropertyAssignment(property) && isPlainCapture(property.initializer)
      );
    }
    return false;
  };
  let captureDiagnostic: ExtractionDiagnostic | undefined;
  for (const statement of declaration.body.statements.filter(ast.isVariableStatement)) {
    for (const item of statement.declarationList.declarations) {
      const initializer = item.initializer;
      const plainFrozenObject = Boolean(initializer && isPlainCapture(initializer));
      if (!plainFrozenObject && initializer) {
        captureDiagnostic = diagnosticFor(
          sourceFile,
          initializer,
          "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW",
        );
      }
    }
  }
  return { sourceFile, rootExport, closure, captureStatements, captureDiagnostic };
}

export class ExtractionCandidate implements Disposable {
  readonly #api: API;
  readonly #project: Project;

  constructor() {
    this.#api = new API({ cwd: repositoryRoot });
    const snapshot = this.#api.updateSnapshot({
      openProjects: [{ uri: new URL(`file://${projectPath}`).href }],
    });
    const project = snapshot.getProject(projectPath) ?? snapshot.getProjects()[0];
    if (!project) throw new Error("FADENO_EXTRACTION_TYPESCRIPT_PROJECT");
    this.#project = project;
  }

  analyze(fixtureId: ExtractionFixtureId): ExtractionAnalysis {
    const { sourceFile, rootExport, closure, captureStatements, captureDiagnostic } = findRoot(
      this.#project,
      fixtureId,
    );
    const behavior = findBehavior(this.#project, closure);
    return {
      fixtureId,
      rootExport,
      rootSource: sourceFile.getText(),
      closureSource: closure.getText(sourceFile),
      captureStatements,
      behaviorAlias: behavior.alias,
      behaviorName: ast.isFunctionDeclaration(behavior.declaration)
        ? behavior.declaration.name?.text ?? ""
        : "",
      behaviorSource: behavior.declaration.getText(behavior.sourceFile),
      behaviorPath: sourceName(behavior.sourceFile),
      diagnostic: captureDiagnostic ?? classifyReachableModule(this.#project, behavior.sourceFile),
    };
  }

  [Symbol.dispose](): void {
    this.#api.close();
  }
}

export function assertContainedOutput(root: string, destination: string): void {
  const resolvedRoot = resolve(root);
  const resolvedDestination = resolve(destination);
  if (
    resolvedDestination === resolvedRoot ||
    !resolvedDestination.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error("FADENO_EXTRACTION_OUTPUT_ESCAPE");
  }
  let cursor = dirname(resolvedDestination);
  while (cursor.startsWith(resolvedRoot) && cursor !== resolvedRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error("FADENO_EXTRACTION_OUTPUT_SYMLINK");
    }
    cursor = dirname(cursor);
  }
}

export function emitAcceptedHandler(
  analysis: ExtractionAnalysis,
  outputRoot: string,
): GeneratedHandler {
  if (analysis.diagnostic) throw new Error("FADENO_EXTRACTION_EMIT_REJECTED");
  const destination = join(outputRoot, `${analysis.fixtureId}.js`);
  assertContainedOutput(outputRoot, destination);
  mkdirSync(outputRoot, { recursive: true });
  const transaction = mkdtempSync(join(dirname(outputRoot), ".extraction-emit-"));
  try {
    const input = join(transaction, "handler.ts");
    const emittedRoot = join(transaction, "emitted");
    const handlerIdentity = sha256([
      analysis.rootExport,
      analysis.closureSource,
      analysis.behaviorPath,
      analysis.behaviorSource,
      ...analysis.captureStatements,
    ].join("\n"));
    writeFileSync(input, [
      ...analysis.captureStatements,
      analysis.behaviorSource,
      `const ${analysis.behaviorAlias} = ${analysis.behaviorName};`,
      `const extractedHandler = ${analysis.closureSource};`,
      "const moduleState = globalThis as typeof globalThis & {",
      "  __fadenoExtractionModuleEvaluations?: number;",
      "};",
      "moduleState.__fadenoExtractionModuleEvaluations =",
      "  (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;",
      `export const handlerIdentity = ${JSON.stringify(handlerIdentity)};`,
      "export { extractedHandler as handler };",
      "",
    ].join("\n"));
    const require = createRequire(import.meta.url);
    const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
    const child = spawnSync(process.execPath, [
      tsc,
      "--target", "ES2022",
      "--module", "ES2022",
      "--lib", "ES2024,DOM,DOM.Iterable",
      "--strict",
      "--skipLibCheck",
      "--outDir", emittedRoot,
      input,
    ], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    if (child.status !== 0 || child.error || child.signal) {
      throw new Error(`FADENO_EXTRACTION_TYPESCRIPT_EMIT: ${child.stderr || child.stdout}`);
    }
    const emitted = readFileSync(join(emittedRoot, "handler.js"));
    const staged = join(transaction, `${analysis.fixtureId}.js`);
    writeFileSync(staged, emitted);
    if (existsSync(destination)) rmSync(destination);
    renameSync(staged, destination);
    return {
      fixtureId: analysis.fixtureId,
      path: destination,
      sha256: sha256(emitted),
      bytes: emitted.byteLength,
      handlerIdentity,
    };
  } finally {
    rmSync(transaction, { recursive: true, force: true });
  }
}
