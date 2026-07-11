import { senseServerImport } from "./boundary-sensor.ts";
import type { ExtractionDiagnostic } from "./contract.ts";

type SeededBoundaryPipeline = Readonly<{
  handler: Readonly<{ sourceName: string; source: string }>;
  serverCapability: Readonly<{ secret: string }>;
  emitBrowserArtifact: (source: string) => void;
  startServer: () => void;
  startBrowser: () => void;
}>;

export function runSeededBoundaryPipeline(
  input: SeededBoundaryPipeline,
): ExtractionDiagnostic | undefined {
  const diagnostic = senseServerImport(input.handler.sourceName, input.handler.source);
  if (diagnostic) return diagnostic;

  input.emitBrowserArtifact(`export const leaked = ${JSON.stringify(input.serverCapability.secret)};`);
  input.startServer();
  input.startBrowser();
}

export function verifySeededBoundaryRejection(
  diagnostic: ExtractionDiagnostic | undefined,
  canary: string,
  execution: Readonly<{ writerStarted: boolean; serverStarted: boolean; browserStarted: boolean }>,
): asserts diagnostic is ExtractionDiagnostic {
  if (
    !diagnostic ||
    diagnostic.id !== "FADENO_K0_EXTRACT_SERVER_IMPORT" ||
    diagnostic.severity !== "error" ||
    diagnostic.source !== "rejected/server-secret.ts" ||
    diagnostic.range.line !== 1 ||
    diagnostic.range.column !== 24 ||
    diagnostic.range.length !== 21 ||
    diagnostic.message !== "A browser handler cannot import a server-only module." ||
    JSON.stringify(diagnostic).includes(canary) ||
    execution.writerStarted ||
    execution.serverStarted ||
    execution.browserStarted
  ) {
    throw new Error("FADENO_EXTRACTION_REJECTED_CONTROL");
  }
}
