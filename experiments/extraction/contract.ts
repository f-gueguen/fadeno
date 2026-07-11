export const EXTRACTION_PROJECTS = ["chromium", "firefox", "webkit"] as const;
export type ExtractionProject = (typeof EXTRACTION_PROJECTS)[number];

export type ExtractionObservation = Readonly<{
  schemaVersion: 2;
  projectName: ExtractionProject;
  observedBrowser: ExtractionProject;
  preTriggerRequests: readonly string[];
  firstTriggerRequests: readonly string[];
  secondTriggerRequests: readonly string[];
  responses: Readonly<Record<string, Readonly<{
    body: string;
    contentType: string;
    sha256: string;
  }>>>;
  valueWhileHandlerBlocked: string;
  valueAfterFirstTrigger: string;
  valueAfterSecondTrigger: string;
  noJavaScriptValue: string;
  noJavaScriptRequests: readonly string[];
}>;

export type ExtractionRunReport = Readonly<{
  schemaVersion: 1;
  status: "passed" | "failed" | "timedout" | "interrupted";
  tests: readonly Readonly<{
    projectName: string;
    title: string;
    status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    expectedStatus: string;
    retry: number;
    attachment: Readonly<{
      name: string;
      contentType: string;
      path: string;
      sha256: string;
    }>;
  }>[];
}>;

export type ExtractionDiagnostic = Readonly<{
  id: string;
  severity: "error";
  source: string;
  range: Readonly<{ line: number; column: number; length: number }>;
  message: string;
  explanation: string;
  correction: string;
}>;
