import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportedNames, renderV1ApiReference } from "./lib/v1-api-reference.ts";

const declaration = [
  "export interface Alpha {}",
  "declare const hidden: unique symbol;",
  "export declare function beta(): void;",
  "declare const source: string;",
  "export { source as gamma };",
].join("\n");
const names = exportedNames(declaration);
if (JSON.stringify(names) !== JSON.stringify(["Alpha", "beta", "gamma"])) {
  throw new Error(`unexpected export index: ${names.join(", ")}`);
}

const root = mkdtempSync(join(tmpdir(), "fadeno-api-reference-"));
try {
  const path = join(root, "index.d.ts");
  writeFileSync(path, declaration);
  const first = renderV1ApiReference([{ importPath: "example", declarationPath: path }]);
  writeFileSync(path, `${declaration}\nexport type Delta = string;\n`);
  const second = renderV1ApiReference([{ importPath: "example", declarationPath: path }]);
  if (first === second || !second.includes("`Delta`")) throw new Error("declaration change did not update the API reference");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 API reference mutation tests passed");
