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
const MAX_CAPTURE_BYTES = 65_536;

type PlainCapture = null | boolean | number | string | PlainCapture[] | {
  [key: string]: PlainCapture;
};

type CaptureEvaluation =
  | Readonly<{ known: true; overLimit: false; value: PlainCapture }>
  | Readonly<{ known: false; overLimit: false }>
  | Readonly<{ known: false; overLimit: true }>;

const unknownCapture: CaptureEvaluation = { known: false, overLimit: false };

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

function propertyName(node: Node): string | undefined {
  if (ast.isIdentifier(node) || ast.isStringLiteral(node) || ast.isNumericLiteral(node)) {
    return node.text;
  }
}

function evaluatePlainCapture(node: Node): CaptureEvaluation {
  if (ast.isStringLiteral(node)) return { known: true, overLimit: false, value: node.text };
  if (ast.isNumericLiteral(node)) {
    return { known: true, overLimit: false, value: Number(node.text) };
  }
  if (node.kind === ast.SyntaxKind.TrueKeyword) {
    return { known: true, overLimit: false, value: true };
  }
  if (node.kind === ast.SyntaxKind.FalseKeyword) {
    return { known: true, overLimit: false, value: false };
  }
  if (node.kind === ast.SyntaxKind.NullKeyword) {
    return { known: true, overLimit: false, value: null };
  }
  if (
    ast.isPrefixUnaryExpression(node) &&
    node.operator === ast.SyntaxKind.MinusToken &&
    ast.isNumericLiteral(node.operand)
  ) return { known: true, overLimit: false, value: -Number(node.operand.text) };
  if (
    ast.isCallExpression(node) &&
    ast.isPropertyAccessExpression(node.expression) &&
    ast.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    node.expression.name.text === "freeze" &&
    node.arguments.length === 1
  ) return evaluatePlainCapture(node.arguments[0]!);
  if (
    ast.isCallExpression(node) &&
    ast.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "repeat" &&
    node.arguments.length === 1 &&
    ast.isNumericLiteral(node.arguments[0]!)
  ) {
    const owner = evaluatePlainCapture(node.expression.expression);
    const repetitions = Number(node.arguments[0]!.text);
    if (
      owner.known && typeof owner.value === "string" &&
      Number.isSafeInteger(repetitions) && repetitions >= 0
    ) {
      if (
        owner.value.length > 0 &&
        repetitions > MAX_CAPTURE_BYTES / owner.value.length
      ) return { known: false, overLimit: true };
      return { known: true, overLimit: false, value: owner.value.repeat(repetitions) };
    }
    return unknownCapture;
  }
  if (ast.isArrayLiteralExpression(node)) {
    const values: PlainCapture[] = [];
    for (const element of node.elements) {
      const result = evaluatePlainCapture(element);
      if (!result.known && result.overLimit) return result;
      if (!result.known) return unknownCapture;
      values.push(result.value);
    }
    return { known: true, overLimit: false, value: values };
  }
  if (ast.isObjectLiteralExpression(node)) {
    const value: { [key: string]: PlainCapture } = {};
    for (const property of node.properties) {
      if (!ast.isPropertyAssignment(property)) return unknownCapture;
      const key = propertyName(property.name);
      const result = evaluatePlainCapture(property.initializer);
      if (!result.known && result.overLimit) return result;
      if (key === undefined || !result.known) return unknownCapture;
      value[key] = result.value;
    }
    return { known: true, overLimit: false, value };
  }
  return unknownCapture;
}

function captureBytes(value: PlainCapture): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function measurePlainCapture(node: Node): number | undefined {
  const evaluated = evaluatePlainCapture(node);
  return evaluated.known
    ? captureBytes(evaluated.value)
    : evaluated.overLimit ? MAX_CAPTURE_BYTES + 1 : undefined;
}

function evaluateCaptureEnvelope(
  entries: readonly (readonly [string, Node])[],
): CaptureEvaluation {
  const payload: { [key: string]: PlainCapture } = {};
  for (const [name, initializer] of entries) {
    const evaluated = evaluatePlainCapture(initializer);
    if (!evaluated.known) return evaluated;
    payload[name] = evaluated.value;
  }
  return { known: true, overLimit: false, value: payload };
}

export function measureCaptureEnvelope(
  entries: readonly (readonly [string, Node])[],
): number | undefined {
  const evaluated = evaluateCaptureEnvelope(entries);
  return evaluated.known
    ? captureBytes(evaluated.value)
    : evaluated.overLimit ? MAX_CAPTURE_BYTES + 1 : undefined;
}

function classifySyntax(
  sourceFile: SourceFile,
  root: Node,
): ExtractionDiagnostic | undefined {
  const classNames = new Set(
    sourceFile.statements.flatMap((statement) =>
      ast.isClassDeclaration(statement) && statement.name ? [statement.name.text] : []
    ),
  );
  let found: ExtractionDiagnostic | undefined;
  visit(root, (node) => {
    if (found) return;
    if (ast.isTypeOfExpression(node) && identifierText(node.expression) === "window") {
      found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_AMBIENT_CAPTURE");
      return;
    }
    if (
      ast.isIdentifier(node) && node.text === "window" &&
      !(ast.isPropertyAccessExpression(node.parent) && node.parent.name === node)
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
      if (name && classNames.has(name)) {
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
        const evaluated = member === "repeat" ? evaluatePlainCapture(node) : unknownCapture;
        if (!evaluated.known && evaluated.overLimit) {
          found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_CAPTURE_SIZE");
          return;
        }
        if (evaluated.known) {
          if (captureBytes(evaluated.value) > MAX_CAPTURE_BYTES) {
            found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_CAPTURE_SIZE");
          }
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

  return classifySyntax(sourceFile, sourceFile);
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

export function classifySelectedClosure(
  project: Project,
  sourceFile: SourceFile,
  closure: Node,
  options: Readonly<{
    allowedDeclarations?: ReadonlySet<Node>;
    allowedExternalFunctions?: number;
  }> = {},
): ExtractionDiagnostic | undefined {
  const direct = classifySyntax(sourceFile, closure);
  if (direct) return direct;
  let found: ExtractionDiagnostic | undefined;
  const externalFunctions = new Set<Node>();
  const isInsideClosure = (declaration: Node): boolean => {
    let cursor: Node | undefined = declaration;
    while (cursor && !ast.isSourceFile(cursor)) {
      if (cursor === closure) return true;
      cursor = cursor.parent;
    }
    return false;
  };
  visit(closure, (node) => {
    if (found) return;
    if (
      ast.isCallExpression(node) && ast.isIdentifier(node.expression) &&
      !project.checker.getSymbolAtLocation(node.expression)
    ) {
      found = diagnosticFor(sourceFile, node.expression, "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW");
      return;
    }
    if (
      !ast.isIdentifier(node) ||
      (ast.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) return;
    const symbol = project.checker.getSymbolAtLocation(node);
    if (!symbol) {
      found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW");
      return;
    }
    for (const symbolDeclaration of symbol.declarations) {
      let cursor: Node | undefined = symbolDeclaration.resolve(project);
      while (cursor && !ast.isImportDeclaration(cursor) && !ast.isSourceFile(cursor)) {
        cursor = cursor.parent;
      }
      if (
        !cursor || !ast.isImportDeclaration(cursor) ||
        !ast.isStringLiteral(cursor.moduleSpecifier)
      ) continue;
      const moduleSymbol = project.checker.getSymbolAtLocation(cursor.moduleSpecifier);
      const moduleTarget = moduleSymbol && resolveAlias(project, moduleSymbol);
      const moduleDeclaration = moduleTarget?.declarations[0]?.resolve(project) ??
        moduleTarget?.valueDeclaration?.resolve(project);
      const importedSource = moduleDeclaration?.getSourceFile();
      if (importedSource) found = classifyReachableModule(project, importedSource);
      if (found) return;
    }
    const target = resolveAlias(project, symbol);
    const declaration = target.valueDeclaration?.resolve(project) ??
      target.declarations[0]?.resolve(project);
    const dependency = declaration?.getSourceFile();
    if (declaration && dependency?.fileName === sourceFile.fileName) {
      if (
        isInsideClosure(declaration) ||
        options.allowedDeclarations?.has(declaration) === true
      ) return;
      found = diagnosticFor(sourceFile, node, "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW");
      return;
    }
    if (
      !dependency ||
      dependency.fileName.includes(`${sep}node_modules${sep}`) ||
      /\/lib\.[^/]+\.d\.ts$/u.test(dependency.fileName.split(sep).join("/"))
    ) return;
    if (declaration && ast.isFunctionDeclaration(declaration)) {
      externalFunctions.add(declaration);
    }
    found = classifyReachableModule(project, dependency);
  });
  if (found) return found;
  return externalFunctions.size > (options.allowedExternalFunctions ?? 1)
    ? diagnosticFor(sourceFile, closure, "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW")
    : undefined;
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
  const captureEntries: Array<readonly [string, Node]> = [];
  const captureDeclarations = new Set<Node>();
  const referencedDeclarations = new Set<Node>();
  visit(closure, (node) => {
    if (!ast.isIdentifier(node)) return;
    const symbol = project.checker.getSymbolAtLocation(node);
    if (!symbol) return;
    const target = resolveAlias(project, symbol);
    for (const symbolDeclaration of target.declarations) {
      const resolved = symbolDeclaration.resolve(project);
      if (resolved) referencedDeclarations.add(resolved);
    }
    const valueDeclaration = target.valueDeclaration?.resolve(project);
    if (valueDeclaration) referencedDeclarations.add(valueDeclaration);
  });
  let captureDiagnostic: ExtractionDiagnostic | undefined;
  for (const statement of declaration.body.statements.filter(ast.isVariableStatement)) {
    for (const item of statement.declarationList.declarations) {
      const initializer = item.initializer;
      if (!initializer) continue;
      if (!referencedDeclarations.has(item)) continue;
      if (!ast.isIdentifier(item.name)) {
        captureDiagnostic = diagnosticFor(
          sourceFile,
          item.name,
          "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW",
        );
        continue;
      }
      captureEntries.push([item.name.text, initializer]);
      captureDeclarations.add(item);
    }
  }
  const captureEvaluation = evaluateCaptureEnvelope(captureEntries);
  const lastCapture = captureEntries.at(-1)?.[1] ?? declaration;
  if (!captureDiagnostic && !captureEvaluation.known) {
    captureDiagnostic = diagnosticFor(
      sourceFile,
      lastCapture,
      captureEvaluation.overLimit
        ? "FADENO_K0_EXTRACT_CAPTURE_SIZE"
        : "FADENO_K0_EXTRACT_AMBIGUOUS_FLOW",
    );
  }
  if (
    !captureDiagnostic && captureEvaluation.known &&
    captureBytes(captureEvaluation.value) > MAX_CAPTURE_BYTES
  ) {
    captureDiagnostic = diagnosticFor(
      sourceFile,
      lastCapture,
      "FADENO_K0_EXTRACT_CAPTURE_SIZE",
    );
  }
  const captureStatements = captureEvaluation.known
    ? Object.entries(
        captureEvaluation.value as { [key: string]: PlainCapture },
      ).map(
        ([name, value]) => `const ${name} = ${JSON.stringify(value)};`,
      )
    : [];
  return {
    sourceFile,
    rootExport,
    closure,
    captureStatements,
    captureDeclarations,
    captureDiagnostic,
  };
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
    const {
      sourceFile,
      rootExport,
      closure,
      captureStatements,
      captureDeclarations,
      captureDiagnostic,
    } = findRoot(
      this.#project,
      fixtureId,
    );
    const behavior = findBehavior(this.#project, closure);
    const closureDiagnostic = classifySelectedClosure(this.#project, sourceFile, closure, {
      allowedDeclarations: captureDeclarations,
      allowedExternalFunctions: 1,
    });
    const behaviorDiagnostic = classifySelectedClosure(
      this.#project,
      behavior.sourceFile,
      behavior.declaration,
      { allowedExternalFunctions: 0 },
    );
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
      diagnostic: closureDiagnostic ?? captureDiagnostic ?? behaviorDiagnostic ??
        classifyReachableModule(this.#project, behavior.sourceFile),
    };
  }

  [Symbol.dispose](): void {
    this.#api.close();
  }
}

export function assertContainedOutput(root: string, destination: string): void {
  const resolvedRoot = resolve(root);
  const resolvedDestination = resolve(destination);
  if (existsSync(resolvedRoot) && lstatSync(resolvedRoot).isSymbolicLink()) {
    throw new Error("FADENO_EXTRACTION_OUTPUT_SYMLINK");
  }
  let rootCursor = resolvedRoot;
  while (true) {
    if (existsSync(rootCursor)) {
      if (lstatSync(rootCursor).isSymbolicLink()) {
        throw new Error("FADENO_EXTRACTION_OUTPUT_SYMLINK");
      }
      break;
    }
    const parent = dirname(rootCursor);
    if (parent === rootCursor) break;
    rootCursor = parent;
  }
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
