import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectPackageBoundaries, scanModuleReferences, type ModuleReference } from "./lib/package-boundaries.ts";

function fixture(source: string, configure?: (root: string) => void): { root: string; temporaryRoot: string } {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-package-boundary-"));
  const root = join(temporaryRoot, "repository");
  for (const path of ["packages/first/src", "packages/second/src"]) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "packages/first/src/index.ts"), source);
  writeFileSync(join(root, "packages/first/src/internal.ts"), "export const internal = true;\n");
  writeFileSync(join(root, "packages/second/src/private.ts"), "export const privateValue = true;\n");
  configure?.(root);
  return { root, temporaryRoot };
}

function expectViolation(name: string, source: string, expectedKind: ModuleReference["kind"], configure?: (root: string) => void): void {
  const { root, temporaryRoot } = fixture(source, configure);
  try {
    const violations = inspectPackageBoundaries(root);
    if (violations.length !== 1 || violations[0]?.code !== "FADENO_PACKAGE_CROSS_RELATIVE" || violations[0]?.kind !== expectedKind) {
      throw new Error(`${name}: expected one ${expectedKind} boundary violation, received ${JSON.stringify(violations)}`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const valid = fixture([
  'import { internal } from "./internal.ts";',
  'const text = "import(\\\"../../second/src/private.ts\\\")";',
  "// export { privateValue } from '../../second/src/private.ts';",
  "export { internal, text };",
].join("\n"));
try {
  const violations = inspectPackageBoundaries(valid.root);
  if (violations.length !== 0) throw new Error(`valid intra-package import failed: ${JSON.stringify(violations)}`);
} finally {
  rmSync(valid.temporaryRoot, { recursive: true, force: true });
}

expectViolation("static import", 'import "../../second/src/private.ts";\n', "import");
expectViolation("export from", 'export { privateValue } from "../../second/src/private.ts";\n', "export-from");
expectViolation("dynamic import", 'void import("../../second/src/private.ts");\n', "dynamic-import");
expectViolation("repository traversal", 'import "../../../outside.ts";\n', "import", (root) => {
  writeFileSync(join(root, "outside.ts"), "export {};\n");
});
expectViolation("symlink escape", 'import "./linked.ts";\n', "import", (root) => {
  symlinkSync(join(root, "packages/second/src/private.ts"), join(root, "packages/first/src/linked.ts"));
});

const references = scanModuleReferences([
  'import "./side-effect.ts";',
  'import { value } from "./static.ts";',
  'export { value } from "./exported.ts";',
  'void import("./dynamic.ts");',
  "void import.meta.url;",
].join("\n"));
if (JSON.stringify(references) !== JSON.stringify([
  { kind: "import", specifier: "./side-effect.ts" },
  { kind: "import", specifier: "./static.ts" },
  { kind: "export-from", specifier: "./exported.ts" },
  { kind: "dynamic-import", specifier: "./dynamic.ts" },
])) throw new Error(`module reference scan differs: ${JSON.stringify(references)}`);

console.log("package boundary negative tests passed (import, export, dynamic, traversal, symlink)");
