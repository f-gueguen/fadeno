export class FadenoDiagnosticError extends Error {
  readonly id: string;
  readonly severity = "error" as const;
  readonly summary: string;
  readonly locations: readonly string[];
  readonly sourceRanges: readonly Readonly<{ path: string; range: null }>[];
  readonly explanation: string;
  readonly correction: string;

  constructor(
    id: string,
    summary: string,
    locations: readonly string[],
    explanation: string,
    correction: string,
  ) {
    const ordered = [...locations].sort();
    super(`${id}${ordered.length === 0 ? "" : `:${ordered.join(":")}`}`);
    this.name = "FadenoDiagnosticError";
    this.id = id;
    this.summary = summary;
    this.locations = Object.freeze(ordered);
    this.sourceRanges = Object.freeze(ordered.map((path) => Object.freeze({ path, range: null })));
    this.explanation = explanation;
    this.correction = correction;
  }
}

export function formatDiagnostic(error: FadenoDiagnosticError): string {
  return `${JSON.stringify({
    id: error.id,
    severity: error.severity,
    summary: error.summary,
    locations: error.locations,
    sourceRanges: error.sourceRanges,
    explanation: error.explanation,
    correction: error.correction,
  })}\n`;
}
