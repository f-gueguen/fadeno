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
    if (!violations.some((violation) => violation.code === "FADENO_PACKAGE_CROSS_RELATIVE" && violation.kind === expectedKind)) {
      throw new Error(`${name}: expected a ${expectedKind} boundary violation, received ${JSON.stringify(violations)}`);
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
expectViolation("contextual from import", 'import { from as value } from "../../second/src/private.ts";\n', "import");
expectViolation("export from", 'export { privateValue } from "../../second/src/private.ts";\n', "export-from");
expectViolation("contextual from export", 'export { from as value } from "../../second/src/private.ts";\n', "export-from");
expectViolation("dynamic import", 'void import("../../second/src/private.ts");\n', "dynamic-import");
expectViolation("template dynamic import", 'void import(`../../second/src/private.ts`);\n', "dynamic-import");
expectViolation("import equals", 'import privateValue = require("../../second/src/private.ts");\n', "require");
expectViolation("CommonJS require", 'void require("../../second/src/private.ts");\n', "require");
expectViolation("repository traversal", 'import "../../../outside.ts";\n', "import", (root) => {
  writeFileSync(join(root, "outside.ts"), "export {};\n");
});
expectViolation("symlink escape", 'import "./linked.ts";\n', "import", (root) => {
  symlinkSync(join(root, "packages/second/src/private.ts"), join(root, "packages/first/src/linked.ts"));
});

const references = scanModuleReferences([
  "const heading = `# ${name}`;",
  "const nested = `${{ value: `${name}` }.value}`;",
  'import "./side-effect.ts";',
  'import { value } from "./static.ts";',
  'import { from as contextual } from "./contextual.ts";',
  'export { value } from "./exported.ts";',
  'export { from as contextualExport } from "./contextual-export.ts";',
  'void import("./dynamic.ts");',
  'void import(`./template.ts`);',
  'import equal = require("./equal.cts");',
  'void require("./common.cjs");',
  "void import.meta.url;",
].join("\n"));
if (JSON.stringify(references) !== JSON.stringify([
  { kind: "import", specifier: "./side-effect.ts" },
  { kind: "import", specifier: "./static.ts" },
  { kind: "import", specifier: "./contextual.ts" },
  { kind: "export-from", specifier: "./exported.ts" },
  { kind: "export-from", specifier: "./contextual-export.ts" },
  { kind: "dynamic-import", specifier: "./dynamic.ts" },
  { kind: "dynamic-import", specifier: "./template.ts" },
  { kind: "require", specifier: "./equal.cts" },
  { kind: "require", specifier: "./common.cjs" },
])) throw new Error(`module reference scan differs: ${JSON.stringify(references)}`);

const manifest = fixture("export {};\n");
try {
  writeFileSync(join(manifest.root, "packages/first/package.json"), JSON.stringify({ exports: {
    ".": "./dist/index.js",
    "./node": "./dist/node.js",
    "./*": "./dist/*",
    "./internal/canary": "./dist/internal/canary.js",
  } }));
  const violations = inspectPackageBoundaries(manifest.root);
  for (const forbidden of ["./*", "./internal/canary"]) {
    if (!violations.some((violation) => violation.code === "FADENO_PACKAGE_EXPORTS" && violation.specifier === forbidden)) {
      throw new Error(`manifest export ${forbidden} was not rejected: ${JSON.stringify(violations)}`);
    }
  }
} finally {
  rmSync(manifest.temporaryRoot, { recursive: true, force: true });
}

const acceptedManifest = fixture("export {};\n");
try {
  writeFileSync(join(acceptedManifest.root, "packages/first/package.json"), JSON.stringify({ exports: {
    ".": "./dist/index.js",
    "./node": "./dist/node.js",
    "./jsx-runtime": "./dist/jsx-runtime.js",
  } }));
  const violations = inspectPackageBoundaries(acceptedManifest.root);
  if (violations.length !== 0) throw new Error(`accepted manifest failed: ${JSON.stringify(violations)}`);
} finally {
  rmSync(acceptedManifest.temporaryRoot, { recursive: true, force: true });
}

const sourceSymlink = fixture("export {};\n", (root) => {
  symlinkSync(join(root, "packages/second/src/private.ts"), join(root, "packages/first/src/unimported-link.ts"));
});
try {
  if (!inspectPackageBoundaries(sourceSymlink.root).some((violation) => violation.code === "FADENO_PACKAGE_SYMLINK_ESCAPE")) {
    throw new Error("unimported source symlink escape was not rejected");
  }
} finally {
  rmSync(sourceSymlink.temporaryRoot, { recursive: true, force: true });
}

const directorySymlink = fixture("export {};\n", (root) => {
  symlinkSync(join(root, "packages/second/src"), join(root, "packages/first/src/linked-directory"), "dir");
});
try {
  if (!inspectPackageBoundaries(directorySymlink.root).some((violation) => violation.code === "FADENO_PACKAGE_SYMLINK_ESCAPE")) {
    throw new Error("source directory symlink escape was not rejected");
  }
} finally {
  rmSync(directorySymlink.temporaryRoot, { recursive: true, force: true });
}

const packageSymlink = mkdtempSync(join(tmpdir(), "fadeno-package-root-symlink-"));
try {
  mkdirSync(join(packageSymlink, "repository/packages"), { recursive: true });
  mkdirSync(join(packageSymlink, "external/src"), { recursive: true });
  writeFileSync(join(packageSymlink, "external/src/index.ts"), "export {};\n");
  symlinkSync(join(packageSymlink, "external"), join(packageSymlink, "repository/packages/linked"), "dir");
  if (!inspectPackageBoundaries(join(packageSymlink, "repository")).some((violation) => violation.code === "FADENO_PACKAGE_SYMLINK_ESCAPE")) {
    throw new Error("package root symlink escape was not rejected");
  }
} finally {
  rmSync(packageSymlink, { recursive: true, force: true });
}

console.log("package boundary negative tests passed (module forms, exports, traversal, symlinks)");
