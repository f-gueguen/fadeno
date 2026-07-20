type JsonRecord = Record<string, unknown>;

export const A0_DECODER_FUZZ_SEED = 0x5a17_2026;

export const A0_DECODER_FUZZ_SURFACES = Object.freeze([
  Object.freeze({ id: "adapter-request-target", cases: 260, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "route-pathname", cases: 260, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "configuration-source", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "configuration-file-bytes", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "environment-file", cases: 260, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "build-dev-command-arguments", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "check-command-arguments", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "create-command-arguments", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "deploy-command-arguments", cases: 68, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "route-artifact-manifest", cases: 260, maximumInputBytes: 8 * 1_024 }),
  Object.freeze({ id: "session-cookie", cases: 260, maximumInputBytes: 16 * 1_024 + 1 }),
  Object.freeze({ id: "action-endpoint", cases: 260, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "action-proof", cases: 260, maximumInputBytes: 4_096 }),
  Object.freeze({ id: "action-body", cases: 132, maximumInputBytes: 4_096 }),
] as const);

export type A0DecoderFuzzSurface = Readonly<{
  id: string;
  cases: number;
  accepted: number;
  refused: number;
  unexpected: number;
  largestInputBytes: number;
  classificationSha256: string;
}>;

export type A0DecoderFuzzSummary = Readonly<{
  schemaVersion: 1;
  milestone: "A0-09";
  seed: number;
  outcome: "qualified-bounded-fuzz";
  deterministicReplay: true;
  secretLeakageObserved: false;
  totalCases: number;
  surfaces: readonly A0DecoderFuzzSurface[];
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function validateA0DecoderFuzzSummary(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return Object.freeze(["A0 decoder fuzz summary must be an object"]);
  if (!exactKeys(value, [
    "schemaVersion",
    "milestone",
    "seed",
    "outcome",
    "deterministicReplay",
    "secretLeakageObserved",
    "totalCases",
    "surfaces",
  ])) errors.push("A0 decoder fuzz summary keys drifted");
  if (value["schemaVersion"] !== 1) errors.push("A0 decoder fuzz schemaVersion must be 1");
  if (value["milestone"] !== "A0-09") errors.push("A0 decoder fuzz milestone must be A0-09");
  if (value["seed"] !== A0_DECODER_FUZZ_SEED) errors.push("A0 decoder fuzz seed drifted");
  if (value["outcome"] !== "qualified-bounded-fuzz") errors.push("A0 decoder fuzz outcome is not qualified");
  if (value["deterministicReplay"] !== true) errors.push("A0 decoder fuzz deterministic replay is not proven");
  if (value["secretLeakageObserved"] !== false) errors.push("A0 decoder fuzz observed secret leakage");

  const surfaces = value["surfaces"];
  if (!Array.isArray(surfaces)) {
    errors.push("A0 decoder fuzz surfaces must be an array");
    return Object.freeze(errors);
  }
  if (surfaces.length !== A0_DECODER_FUZZ_SURFACES.length) {
    errors.push("A0 decoder fuzz surface count drifted");
  }
  let totalCases = 0;
  for (const [index, expected] of A0_DECODER_FUZZ_SURFACES.entries()) {
    const surface = surfaces[index];
    if (!isRecord(surface)) {
      errors.push(`A0 decoder fuzz surface ${expected.id} must be an object`);
      continue;
    }
    if (!exactKeys(surface, [
      "id",
      "cases",
      "accepted",
      "refused",
      "unexpected",
      "largestInputBytes",
      "classificationSha256",
    ])) errors.push(`A0 decoder fuzz surface ${expected.id} keys drifted`);
    if (surface["id"] !== expected.id) errors.push(`A0 decoder fuzz surface order drifted: ${expected.id}`);
    if (surface["cases"] !== expected.cases) errors.push(`A0 decoder fuzz case count drifted: ${expected.id}`);
    const accepted = surface["accepted"];
    const refused = surface["refused"];
    const unexpected = surface["unexpected"];
    if (!Number.isSafeInteger(accepted) || (accepted as number) < 1) {
      errors.push(`A0 decoder fuzz accepted control missing: ${expected.id}`);
    }
    if (!Number.isSafeInteger(refused) || (refused as number) < 1) {
      errors.push(`A0 decoder fuzz refusal control missing: ${expected.id}`);
    }
    if (unexpected !== 0) errors.push(`A0 decoder fuzz unexpected outcome: ${expected.id}`);
    if (
      Number.isSafeInteger(accepted)
      && Number.isSafeInteger(refused)
      && Number.isSafeInteger(unexpected)
      && (accepted as number) + (refused as number) + (unexpected as number) !== expected.cases
    ) errors.push(`A0 decoder fuzz classifications do not cover every case: ${expected.id}`);
    const largestInputBytes = surface["largestInputBytes"];
    if (
      !Number.isSafeInteger(largestInputBytes)
      || (largestInputBytes as number) < 1
      || (largestInputBytes as number) > expected.maximumInputBytes
    ) errors.push(`A0 decoder fuzz input bound drifted: ${expected.id}`);
    if (typeof surface["classificationSha256"] !== "string" || !/^[a-f0-9]{64}$/u.test(surface["classificationSha256"])) {
      errors.push(`A0 decoder fuzz classification digest invalid: ${expected.id}`);
    }
    totalCases += expected.cases;
  }
  if (value["totalCases"] !== totalCases) errors.push("A0 decoder fuzz total case count drifted");
  return Object.freeze(errors);
}
