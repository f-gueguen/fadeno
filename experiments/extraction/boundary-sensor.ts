import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";

import type { ExtractionDiagnostic } from "./contract.ts";

export function senseSeededServerImport(path: string): ExtractionDiagnostic {
  const source = readFileSync(path, "utf8");
  const scanner = createScanner(true, undefined, source);
  let sawImport = false;
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (token === SyntaxKind.ImportKeyword) {
      sawImport = true;
      continue;
    }
    if (sawImport && token === SyntaxKind.StringLiteral) {
      sawImport = false;
      if (scanner.getTokenValue() !== "server-only:secrets") continue;
      const start = scanner.getTokenStart();
      const before = source.slice(0, start);
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = before.split("\n").length;
      return {
        id: "FADENO_K0_EXTRACT_SERVER_IMPORT",
        severity: "error",
        source: basename(path),
        range: {
          line,
          column: start - lineStart + 1,
          length: scanner.getTokenEnd() - start,
        },
        message: "A browser handler cannot import a server-only module.",
      };
    }
  }
  throw new Error("FADENO_EXTRACTION_SEEDED_REJECTION_MISSING");
}
