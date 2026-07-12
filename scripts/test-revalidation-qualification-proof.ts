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
  { mutate: (capture) => { capture.correctness!.cycles[0]!.defaultActionStatus = "expected-error"; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles[0]!.selectiveActionStatus = "expected-error"; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles[0]!.defaultExecutions = "111112"; }, outcome: "pivot" },
  { mutate: (capture) => { (capture.correctness!.cycles[0]! as { stateIsolated: boolean }).stateIsolated = false; }, outcome: "pivot" },
  { mutate: (capture) => { capture.correctness!.cycles.pop(); }, outcome: "inconclusive" },
  { mutate: (capture) => { [capture.correctness!.cycles[0], capture.correctness!.cycles[1]] = [capture.correctness!.cycles[1]!, capture.correctness!.cycles[0]!]; }, outcome: "inconclusive" },
  { mutate: (capture) => { capture.latency!.defaultNs.pop(); }, outcome: "inconclusive" },
  { mutate: (capture) => { capture.latency!.rounds[0]!.firstPath = "selective"; }, outcome: "inconclusive" },
  { mutate: (capture) => { capture.latency!.defaultNs.fill(301_000_000); capture.latency!.rounds.forEach((round) => { round.defaultNs = 301_000_000; }); }, outcome: "pivot" },
  { mutate: (capture) => { capture.memory!.afterRss = 1200; }, outcome: "pivot" },
  { mutate: (capture) => { capture.controls!.unsafeKeepsDetected = 3; }, outcome: "pivot" },
  { mutate: (capture) => { capture.controls!.comparisonPass = false; }, outcome: "pivot" },
  { mutate: (capture) => { capture.latency!.outputsMatch = false; }, outcome: "pivot" },
  { mutate: (capture) => { capture.controls!.sensitiveValuesDisclosed = true; }, outcome: "pivot" },
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
const boundary = structuredClone(validQualificationCapture(schedule)) as MutableCapture;
boundary.latency!.defaultNs.fill(300_000_000);
boundary.latency!.selectiveNs.fill(150_000_000);
for (const round of boundary.latency!.rounds) {
  round.defaultNs = 300_000_000;
  round.selectiveNs = 150_000_000;
}
boundary.memory!.afterRss = 1100;
const boundaryResult = deriveQualificationResult(boundary, schedule, zeroHash, true, true);
if (boundaryResult.decision.outcome !== "go") throw new Error("FADENO_REVALIDATION_QUALIFICATION_BOUNDARY");
console.log(`revalidation qualification proof negative tests passed (${cases.length} mutations)`);
