export class FadenoDiagnosticError extends Error {
  readonly id: string;
  readonly severity = "error" as const;
  readonly summary: string;
  readonly locations: readonly string[];
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
    this.explanation = explanation;
    this.correction = correction;
  }
}
