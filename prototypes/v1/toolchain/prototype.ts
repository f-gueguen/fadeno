import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type PrototypeCommand = "dev" | "build" | "check";

export function defineConfig(config: Readonly<Record<string, never>>): Readonly<Record<string, never>> {
  return config;
}

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

export async function loadPrototypeConfig(root: string): Promise<Readonly<Record<string, never>>> {
  const configPath = resolve(root, "fadeno.config.ts");
  if (!existsSync(configPath)) throw new Error("FADENO_TOOLCHAIN_CONFIG_MISSING");
  const module = await import(`${pathToFileURL(configPath).href}?prototype=${randomUUID()}`) as Record<string, unknown>;
  if (Object.keys(module).some((key) => key !== "default")) throw new Error("FADENO_TOOLCHAIN_CONFIG_EXPORTS");
  const config = module.default;
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.getPrototypeOf(config) !== Object.prototype || Object.keys(config).length !== 0) {
    throw new Error("FADENO_TOOLCHAIN_CONFIG_SHAPE");
  }
  return config as Readonly<Record<string, never>>;
}

export async function executePrototype(
  root: string,
  command: PrototypeCommand,
  processValues: Readonly<Record<string, string | undefined>> = {},
): Promise<string> {
  await loadPrototypeConfig(root);
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
