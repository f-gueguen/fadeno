import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyQualificationSchedule, type QualificationScheduleGolden } from "../experiments/revalidation/qualification-schedule-proof.ts";
import type { QualificationSchedule } from "../experiments/revalidation/qualification-schedule.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const scheduleText = readFileSync(join(experiment, "qualification-schedule.json"), "utf8");
const schedule = JSON.parse(scheduleText) as QualificationSchedule;
const golden = JSON.parse(readFileSync(join(experiment, "qualification-schedule.golden.json"), "utf8")) as QualificationScheduleGolden;
const mutations: readonly ((value: QualificationSchedule) => void)[] = [
  (value) => { (value.cycles as QualificationSchedule["cycles"][number][]).pop(); },
  (value) => { (value.cycles as QualificationSchedule["cycles"][number][])[1] = value.cycles[0]!; },
  (value) => { (value.cycles[0] as { id: string }).id = "c00001"; },
  (value) => { (value.cycles[0] as { path: string }).path = "e"; },
  (value) => { (value.cycles[0] as { readOrder: string }).readOrder = "012345678"; },
  (value) => { (value.cycles[0] as { readOrder: string }).readOrder = "001234567"; },
  (value) => { (value.cycles[0] as { expectedDigest: string }).expectedDigest = "b"; },
  (value) => { (value.outputDigests as { success: string }).success = "0".repeat(64); },
];
for (const mutate of mutations) {
  const candidate = structuredClone(schedule);
  mutate(candidate);
  const candidateText = `${JSON.stringify(candidate)}\n`;
  const candidateGolden = {
    ...golden,
    scheduleSha256: createHash("sha256").update(candidateText).digest("hex"),
  };
  let rejected = false;
  try {
    verifyQualificationSchedule(candidate, candidateText, candidateGolden);
  } catch (error: unknown) {
    rejected = error instanceof Error && error.message.startsWith("FADENO_REVALIDATION_SCHEDULE_");
  }
  if (!rejected) throw new Error("FADENO_REVALIDATION_SCHEDULE_MUTATION_ACCEPTED");
}
console.log(`revalidation qualification schedule negative tests passed (${mutations.length} mutations)`);
