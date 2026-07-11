export const EXTRACTION_PROJECTS = ["chromium", "firefox", "webkit"] as const;
export type ExtractionProject = (typeof EXTRACTION_PROJECTS)[number];

export type ExtractionObservation = Readonly<{
  schemaVersion: 1;
  engine: ExtractionProject;
  preTriggerRequests: readonly string[];
  firstTriggerRequests: readonly string[];
  secondTriggerRequests: readonly string[];
  responseSources: Readonly<Record<string, string>>;
  valueWhileHandlerBlocked: string;
  valueAfterFirstTrigger: string;
  valueAfterSecondTrigger: string;
  noJavaScriptValue: string;
  noJavaScriptRequests: readonly string[];
}>;

export type ExtractionDiagnostic = Readonly<{
  id: "FADENO_K0_EXTRACT_SERVER_IMPORT";
  severity: "error";
  source: string;
  range: Readonly<{ line: number; column: number; length: number }>;
  message: string;
}>;
