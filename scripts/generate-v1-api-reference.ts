import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderV1ApiReference } from "./lib/v1-api-reference.ts";

const root = process.cwd();
const output = join(root, "docs/reference/v1-api.md");
const entryPoints = [
  { importPath: "fadeno-framework-internal", declarationPath: join(root, "packages/framework/dist/index.d.ts") },
  { importPath: "fadeno-framework-internal/node", declarationPath: join(root, "packages/framework/dist/node.d.ts") },
  { importPath: "fadeno-framework-internal/jsx-runtime", declarationPath: join(root, "packages/framework/dist/jsx-runtime.d.ts") },
] as const;

for (const entryPoint of entryPoints) {
  if (!existsSync(entryPoint.declarationPath)) {
    throw new Error(`missing built declaration: ${entryPoint.declarationPath}`);
  }
}

const generated = renderV1ApiReference(entryPoints);
if (process.argv.includes("--check")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== generated) {
    console.error("V1 API reference is stale; run pnpm generate:v1-documentation");
    process.exit(1);
  }
  console.log("V1 generated API reference passed");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generated);
  console.log("generated docs/reference/v1-api.md");
}
