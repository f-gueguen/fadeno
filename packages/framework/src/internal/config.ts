import { randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
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
    if (!isPlainRecord(value) || Object.keys(value).some((key) => key !== "routes")) fail("SHAPE");
    if (!("routes" in value)) return Object.freeze({});
    const routesDescriptor = Object.getOwnPropertyDescriptor(value, "routes");
    if (!routesDescriptor || !("value" in routesDescriptor)) fail("ROUTES");
    const routes = routesDescriptor.value;
    if (!isPlainRecord(routes) || Object.keys(routes).length !== 1) fail("ROUTES");
    const rootDescriptor = Object.getOwnPropertyDescriptor(routes, "root");
    if (!rootDescriptor || !("value" in rootDescriptor) || typeof rootDescriptor.value !== "string") fail("ROUTES");
    return Object.freeze({ routes: Object.freeze({ root: rootDescriptor.value }) });
  } catch (error) {
    if (error instanceof FadenoDiagnosticError) throw error;
    fail("SHAPE");
  }
}

export async function loadConfig(projectRoot: string): Promise<FadenoConfig> {
  if (!existsSync(projectRoot) || lstatSync(projectRoot).isSymbolicLink() || !lstatSync(projectRoot).isDirectory()) {
    fail("PROJECT_ROOT");
  }
  const configPath = resolve(projectRoot, "fadeno.config.ts");
  if (!existsSync(configPath)) fail("MISSING");
  if (lstatSync(configPath).isSymbolicLink() || !lstatSync(configPath).isFile()) fail("FILE");
  let module: Record<string, unknown>;
  try {
    module = await import(`${pathToFileURL(configPath).href}?fadeno=${randomUUID()}`) as Record<string, unknown>;
  } catch {
    fail("EXECUTION");
  }
  if (Object.keys(module).some((key) => key !== "default")) fail("EXPORTS");
  return normalizeConfig(module["default"]);
}
