import type { ExtractionDiagnostic } from "./contract.ts";
import { scanImports } from "./import-scan.ts";

export function senseServerImport(
  sourceName: string,
  source: string,
): ExtractionDiagnostic | undefined {
  const violation = scanImports(source).find(
    (entry) => entry.specifier === "server-only:secrets",
  );
  if (!violation) return;
  return {
    id: "FADENO_K0_EXTRACT_SERVER_IMPORT",
    severity: "error",
    source: sourceName,
    range: violation.range,
    message: "A browser handler cannot reach a server-only import.",
    explanation: "docs/diagnostics/extraction.md#fadeno-k0-extract-server-import",
    correction: "Move secret access behind a resource or action.",
  };
}
