import { randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { FadenoConfig } from "../index.ts";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeConfig(value: unknown): FadenoConfig {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => key !== "routes")) {
    throw new Error("FADENO_CONFIG_SHAPE");
  }
  if (!("routes" in value)) return Object.freeze({});
  const routes = value["routes"];
  if (!isPlainRecord(routes) || Object.keys(routes).length !== 1 || typeof routes["root"] !== "string") {
    throw new Error("FADENO_CONFIG_ROUTES");
  }
  return Object.freeze({ routes: Object.freeze({ root: routes["root"] }) });
}

export async function loadConfig(projectRoot: string): Promise<FadenoConfig> {
  if (!existsSync(projectRoot) || lstatSync(projectRoot).isSymbolicLink() || !lstatSync(projectRoot).isDirectory()) {
    throw new Error("FADENO_CONFIG_PROJECT_ROOT");
  }
  const configPath = resolve(projectRoot, "fadeno.config.ts");
  if (!existsSync(configPath)) throw new Error("FADENO_CONFIG_MISSING");
  if (lstatSync(configPath).isSymbolicLink() || !lstatSync(configPath).isFile()) throw new Error("FADENO_CONFIG_FILE");
  const module = await import(`${pathToFileURL(configPath).href}?fadeno=${randomUUID()}`) as Record<string, unknown>;
  if (Object.keys(module).some((key) => key !== "default")) throw new Error("FADENO_CONFIG_EXPORTS");
  return normalizeConfig(module["default"]);
}
