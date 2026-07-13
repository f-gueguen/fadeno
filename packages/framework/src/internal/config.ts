import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

import type { FadenoConfig } from "../index.ts";
import { FadenoDiagnosticError } from "./diagnostic.ts";

function fail(code: string): never {
  throw new FadenoDiagnosticError(
    `FADENO_CONFIG_${code}`,
    `Configuration violation: ${code.toLowerCase().replaceAll("_", " ")}`,
    ["fadeno.config.ts"],
    `https://fadeno.dev/diagnostics/config/${code.toLowerCase().replaceAll("_", "-")}`,
    "Export one plain configuration object with only accepted fields.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function normalizeConfig(value: unknown): FadenoConfig {
  try {
    if (!isPlainRecord(value)) fail("SHAPE");
    const keys = Reflect.ownKeys(value);
    if (keys.length === 0) return Object.freeze({});
    if (keys.length !== 1 || keys[0] !== "routes") fail("SHAPE");
    const routesDescriptor = Object.getOwnPropertyDescriptor(value, "routes");
    if (!routesDescriptor?.enumerable || !("value" in routesDescriptor)) fail("ROUTES");
    const routes = routesDescriptor.value;
    const routeKeys = isPlainRecord(routes) ? Reflect.ownKeys(routes) : [];
    if (!isPlainRecord(routes) || routeKeys.length !== 1 || routeKeys[0] !== "root") fail("ROUTES");
    const rootDescriptor = Object.getOwnPropertyDescriptor(routes, "root");
    if (!rootDescriptor?.enumerable || !("value" in rootDescriptor) || typeof rootDescriptor.value !== "string") fail("ROUTES");
    return Object.freeze({ routes: Object.freeze({ root: rootDescriptor.value }) });
  } catch (error) {
    if (error instanceof FadenoDiagnosticError) throw error;
    fail("SHAPE");
  }
}

export type LoadedConfig = Readonly<{ config: FadenoConfig; source: string }>;

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function objectProperties(expression: ts.Expression): ReadonlyMap<string, ts.Expression> {
  const current = unwrap(expression);
  if (!ts.isObjectLiteralExpression(current)) fail("STATIC");
  const result = new Map<string, ts.Expression>();
  for (const property of current.properties) {
    if (!ts.isPropertyAssignment(property)) fail("STATIC");
    const name = propertyName(property.name);
    if (name === null || result.has(name)) fail("STATIC");
    result.set(name, property.initializer);
  }
  return result;
}

function configurationFromSourceFile(file: ts.SourceFile): FadenoConfig {
  let exported: ts.Expression | null = null;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (
        clause?.phaseModifier !== undefined || clause?.name || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "fadeno-framework-internal" || !bindings || !ts.isNamedImports(bindings) ||
        bindings.elements.length !== 1 || bindings.elements[0]!.propertyName !== undefined ||
        bindings.elements[0]!.isTypeOnly || bindings.elements[0]!.name.text !== "defineConfig"
      ) fail("STATIC");
      continue;
    }
    if (!ts.isExportAssignment(statement) || statement.isExportEquals || exported !== null) fail("STATIC");
    exported = statement.expression;
  }
  if (exported === null) fail("EXPORTS");
  let expression = unwrap(exported);
  if (ts.isCallExpression(expression)) {
    if (
      !ts.isIdentifier(expression.expression) || expression.expression.text !== "defineConfig" ||
      expression.arguments.length !== 1
    ) fail("STATIC");
    expression = expression.arguments[0]!;
  }
  const top = objectProperties(expression);
  if (top.size === 0) return normalizeConfig({});
  if (top.size !== 1 || !top.has("routes")) fail("SHAPE");
  const routes = objectProperties(top.get("routes")!);
  if (routes.size !== 1 || !routes.has("root")) fail("ROUTES");
  const root = unwrap(routes.get("root")!);
  if (!ts.isStringLiteral(root) && !ts.isNoSubstitutionTemplateLiteral(root)) fail("STATIC");
  return normalizeConfig({ routes: { root: root.text } });
}

function staticConfiguration(projectRoot: string, configPath: string, source: string): FadenoConfig {
  const api = new API({ cwd: projectRoot });
  const snapshot = api.updateSnapshot({ openFiles: [configPath] });
  try {
    const project = snapshot.getDefaultProjectForFile(configPath);
    const file = project?.program.getSourceFile(configPath);
    if (!project || !file || file.text !== source) fail("SOURCE_CHANGED");
    if (project.program.getSyntacticDiagnostics(configPath).length > 0) fail("SYNTAX");
    return configurationFromSourceFile(file);
  } finally {
    snapshot.dispose();
    api.close();
  }
}

export async function loadConfigWithSource(projectRoot: string): Promise<LoadedConfig> {
  if (!existsSync(projectRoot) || lstatSync(projectRoot).isSymbolicLink() || !lstatSync(projectRoot).isDirectory()) {
    fail("PROJECT_ROOT");
  }
  const configPath = resolve(projectRoot, "fadeno.config.ts");
  if (!existsSync(configPath)) fail("MISSING");
  if (lstatSync(configPath).isSymbolicLink() || !lstatSync(configPath).isFile()) fail("FILE");
  const source = readFileSync(configPath, "utf8");
  const config = staticConfiguration(projectRoot, configPath, source);
  if (readFileSync(configPath, "utf8") !== source) fail("SOURCE_CHANGED");
  return Object.freeze({ config, source });
}

export async function loadConfig(projectRoot: string): Promise<FadenoConfig> {
  return (await loadConfigWithSource(projectRoot)).config;
}
