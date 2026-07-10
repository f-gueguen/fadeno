export type MorphMachineAttachment = Readonly<{
  name: string;
  contentType: string;
  path?: string;
  bytes: number;
}>;

export type MorphMachineResult = Readonly<{
  project: string;
  title: string;
  status: string;
  expectedStatus: string;
  errors: readonly string[];
  attachments: readonly MorphMachineAttachment[];
}>;

export type MorphMachineReport = Readonly<{
  schemaVersion: number;
  status: string;
  results: readonly MorphMachineResult[];
}>;
