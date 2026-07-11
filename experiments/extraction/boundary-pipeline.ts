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
