import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, type FadenoConfig } from "../../../packages/framework/src/index.ts";
import { PrivateProjectAnalyzer } from "../../../packages/framework/src/internal/analyzer-project.ts";
import { loadConfig } from "../../../packages/framework/src/internal/config.ts";

export { defineConfig };

export type PrototypeCommand = "dev" | "build" | "check";

export function parseEnvironmentFile(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match || Object.hasOwn(values, match[1]!)) throw new Error(`FADENO_TOOLCHAIN_ENV:${index + 1}`);
    let value = match[2]!.trim();
    const quote = value[0];
    if (quote === "\"" || quote === "'") {
      if (value.length < 2 || value.at(-1) !== quote) throw new Error(`FADENO_TOOLCHAIN_ENV:${index + 1}`);
      value = value.slice(1, -1);
    } else if (value.includes("\"") || value.includes("'")) {
      throw new Error(`FADENO_TOOLCHAIN_ENV:${index + 1}`);
    }
    if (/\$\{|\r|\n/u.test(value)) throw new Error(`FADENO_TOOLCHAIN_ENV:${index + 1}`);
    values[match[1]!] = value;
  }
  return values;
}

export function loadEnvironment(root: string, processValues: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const loaded: Record<string, string> = {};
  for (const name of [".env", ".env.local"] as const) {
    const path = join(root, name);
    if (existsSync(path)) Object.assign(loaded, parseEnvironmentFile(readFileSync(path, "utf8")));
  }
  for (const [key, value] of Object.entries(processValues)) if (value !== undefined) loaded[key] = value;
  return loaded;
}

export function loadPrototypeConfig(root: string): Promise<FadenoConfig> {
  return loadConfig(root);
}

export async function executePrototype(
  root: string,
  command: PrototypeCommand,
  processValues: Readonly<Record<string, string | undefined>> = {},
): Promise<string> {
  const config = await loadPrototypeConfig(root);
  if (config.routes) (await new PrivateProjectAnalyzer(root).analyze()).apply();
  const environment = loadEnvironment(root, processValues);
  const manifest = `${JSON.stringify({ schemaVersion: 1, command, environment: Object.keys(environment).sort() })}\n`;
  if (command === "check") return manifest;
  if (command === "dev") {
    const output = join(root, ".fadeno");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "workflow.json"), manifest);
    return manifest;
  }
  const output = join(root, "dist");
  const pending = join(root, `.fadeno-build-${randomUUID()}`);
  mkdirSync(pending);
  writeFileSync(join(pending, "manifest.json"), manifest);
  const previous = join(root, `.fadeno-previous-${randomUUID()}`);
  if (existsSync(output)) renameSync(output, previous);
  try {
    renameSync(pending, output);
  } catch (error: unknown) {
    if (existsSync(previous)) renameSync(previous, output);
    rmSync(pending, { recursive: true, force: true });
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  return manifest;
}
