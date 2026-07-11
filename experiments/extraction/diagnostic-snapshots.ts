import { EXTRACTION_REJECTION_CLASSES } from "./fixtures/catalog.ts";
import { ExtractionCandidate } from "./candidate.ts";

export function stableExtractionDiagnosticSnapshots(): string {
  using candidate = new ExtractionCandidate();
  return `${JSON.stringify({
    schemaVersion: 1,
    diagnostics: EXTRACTION_REJECTION_CLASSES.map((fixtureId) => {
      const diagnostic = candidate.analyze(fixtureId).diagnostic;
      if (!diagnostic) throw new Error(`FADENO_EXTRACTION_DIAGNOSTIC_MISSING: ${fixtureId}`);
      return { fixtureId, ...diagnostic };
    }),
  })}\n`;
}
