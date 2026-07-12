import { deriveQualificationResult } from "../experiments/revalidation/qualification-proof.ts";
import { loadQualificationSchedule } from "../experiments/revalidation/qualification-runner.ts";
import { validQualificationCapture } from "./lib/revalidation-qualification-fixture.ts";

const schedule = loadQualificationSchedule();
const zeroHash = "0".repeat(64);
type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> } : T;
type MutableCapture = DeepMutable<ReturnType<typeof validQualificationCapture>>;

const cases: readonly Readonly<{
  mutate: (capture: MutableCapture) => void;
  environmentValid?: boolean;
  integrityValid?: boolean;
  outcome: "pivot" | "inconclusive";
}>[] = [
  { mutate: (capture) => { capture.correctness!.cycles[0]!.stale = true; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles[0]!.defaultDigest = zeroHash; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles[0]!.defaultExecutions = "111112"; }, outcome: "pivot" },
  { mutate: (capture) => { (capture.correctness!.cycles[0]! as { stateIsolated: boolean }).stateIsolated = false; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles.pop(); }, outcome: "inconclusive" },
  { mutate: (capture) => { [capture.correctness!.cycles[0], capture.correctness!.cycles[1]] = [capture.correctness!.cycles[1]!, capture.correctness!.cycles[0]!]; }, outcome: "inconclusive" },
  { mutate: (capture) => { capture.latency!.defaultNs.pop(); }, outcome: "inconclusive" },
  { mutate: (capture) => { capture.latency!.defaultNs.fill(301_000_000); }, outcome: "pivot" },
  { mutate: (capture) => { capture.memory!.afterRss = 1200; }, outcome: "pivot" },
  { mutate: (capture) => { capture.controls!.unsafeKeepsDetected = 3; }, outcome: "pivot" },
  { mutate: (capture) => { capture.controls!.comparisonPass = false; }, outcome: "pivot" },
  { mutate: (capture) => {}, environmentValid: false, outcome: "inconclusive" },
  { mutate: (capture) => {}, integrityValid: false, outcome: "inconclusive" },
];
for (const testCase of cases) {
  const capture = structuredClone(validQualificationCapture(schedule)) as MutableCapture;
  testCase.mutate(capture);
  const result = deriveQualificationResult(
    capture,
    schedule,
    zeroHash,
    testCase.environmentValid ?? true,
    testCase.integrityValid ?? true,
  );
  if (result.decision.outcome !== testCase.outcome) {
    throw new Error(`FADENO_REVALIDATION_QUALIFICATION_PROOF_MUTATION:${testCase.outcome}:${result.decision.outcome}`);
  }
}
console.log(`revalidation qualification proof negative tests passed (${cases.length} mutations)`);
