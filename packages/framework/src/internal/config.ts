import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export async function loadConfigWithSource(projectRoot: string): Promise<LoadedConfig> {
  if (!existsSync(projectRoot) || lstatSync(projectRoot).isSymbolicLink() || !lstatSync(projectRoot).isDirectory()) {
    fail("PROJECT_ROOT");
  }
  const configPath = resolve(projectRoot, "fadeno.config.ts");
  if (!existsSync(configPath)) fail("MISSING");
  if (lstatSync(configPath).isSymbolicLink() || !lstatSync(configPath).isFile()) fail("FILE");
  const source = readFileSync(configPath, "utf8");
  let module: Record<string, unknown>;
  try {
    module = await import(`${pathToFileURL(configPath).href}?fadeno=${randomUUID()}`) as Record<string, unknown>;
  } catch {
    fail("EXECUTION");
  }
  if (readFileSync(configPath, "utf8") !== source) fail("SOURCE_CHANGED");
  if (Object.keys(module).some((key) => key !== "default")) fail("EXPORTS");
  return Object.freeze({ config: normalizeConfig(module["default"]), source });
}

export async function loadConfig(projectRoot: string): Promise<FadenoConfig> {
  return (await loadConfigWithSource(projectRoot)).config;
}
