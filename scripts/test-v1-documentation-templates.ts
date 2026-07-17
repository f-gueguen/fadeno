import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderV1DocumentationTemplate } from "./lib/v1-documentation-templates.ts";

const root = mkdtempSync(join(tmpdir(), "fadeno-documentation-template-"));
try {
  mkdirSync(join(root, "example"));
  writeFileSync(join(root, "example/source.ts"), "export const value = 1;\n");
  const template = '# Generated\n\n<!-- fadeno:include {"path":"example/source.ts","language":"ts"} -->\n';
  const rendered = renderV1DocumentationTemplate(template, root, new Set(["example/source.ts"]));
  if (!rendered.includes("```ts\nexport const value = 1;\n```")) throw new Error("authorized include was not rendered");

  let refused = false;
  try {
    renderV1DocumentationTemplate(template, root, new Set());
  } catch (error) {
    refused = error instanceof Error && error.message === "documentation include is not authorized: example/source.ts";
  }
  if (!refused) throw new Error("unauthorized include was not refused");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 documentation template mutation tests passed");
