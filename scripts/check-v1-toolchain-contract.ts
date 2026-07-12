import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executePrototype, loadEnvironment, parseEnvironmentFile } from "../prototypes/v1/toolchain/prototype.ts";

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-toolchain-"));
try {
  writeFileSync(join(root, "fadeno.config.ts"), "export default {};\n");
  writeFileSync(join(root, ".env"), "BASE=base\nSHARED=base\n");
  writeFileSync(join(root, ".env.local"), "LOCAL=local\nSHARED=local\n");
  const environment = loadEnvironment(root, { SHARED: "process", PROCESS: "process" });
  if (JSON.stringify(environment) !== JSON.stringify({ BASE: "base", SHARED: "process", LOCAL: "local", PROCESS: "process" })) {
    throw new Error("FADENO_TOOLCHAIN_PRECEDENCE");
  }
  await executePrototype(root, "check", environment);
  await executePrototype(root, "dev", environment);
  const first = await executePrototype(root, "build", environment);
  const second = await executePrototype(root, "build", environment);
  if (first !== second || readFileSync(join(root, "dist/manifest.json"), "utf8") !== first || !readFileSync(join(root, ".fadeno/workflow.json"), "utf8").includes('"command":"dev"')) {
    throw new Error("FADENO_TOOLCHAIN_REPRODUCIBILITY");
  }

  for (const source of ["A=1\nA=2\n", "export A=1\n", "A=${B}\n", "A='broken\n", "1A=value\n"]) {
    let rejected = false;
    try { parseEnvironmentFile(source); } catch { rejected = true; }
    if (!rejected) throw new Error("FADENO_TOOLCHAIN_ENV_MUTATION");
  }
  const invalid = join(root, "invalid");
  mkdirSync(invalid);
  writeFileSync(join(invalid, "fadeno.config.ts"), "export const named = true; export default {};\n");
  let invalidRejected = false;
  try { await executePrototype(invalid, "check"); } catch (error: unknown) { invalidRejected = error instanceof Error && error.message.startsWith("FADENO_CONFIG_EXPORTS"); }
  if (!invalidRejected) throw new Error("FADENO_TOOLCHAIN_CONFIG_MUTATION");
  const unknown = join(root, "unknown");
  mkdirSync(unknown);
  writeFileSync(join(unknown, "fadeno.config.ts"), "export default { routes: './app' };\n");
  let unknownRejected = false;
  try { await executePrototype(unknown, "check"); } catch (error: unknown) { unknownRejected = error instanceof Error && error.message.startsWith("FADENO_CONFIG_ROUTES"); }
  if (!unknownRejected) throw new Error("FADENO_TOOLCHAIN_UNKNOWN_FIELD");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("V1 toolchain contract passed (config, dev/check/build, precedence, deterministic output, refusals)");
