import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { renderV1ApiReference } from "./lib/v1-api-reference.ts";

const root = process.cwd();
const output = join(root, "docs/reference/v1-api.md");
const packageRoot = join(root, "packages/framework");
const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  readonly name?: unknown;
  readonly exports?: unknown;
};
if (typeof packageManifest.name !== "string" || typeof packageManifest.exports !== "object" || packageManifest.exports === null) {
  throw new Error("framework package must declare a name and typed export map");
}
const entryPoints = Object.entries(packageManifest.exports as Record<string, unknown>)
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  .map(([subpath, target]) => {
    if (typeof target !== "object" || target === null || typeof (target as Record<string, unknown>).types !== "string") {
      throw new Error(`framework export has no declaration target: ${subpath}`);
    }
    const declarationPath = resolve(packageRoot, (target as { readonly types: string }).types);
    if (!declarationPath.startsWith(`${packageRoot}${sep}`)) throw new Error(`framework declaration target escapes package: ${subpath}`);
    return {
      importPath: subpath === "." ? packageManifest.name as string : `${packageManifest.name}${subpath.slice(1)}`,
      declarationPath,
    };
  });

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
