import { createHash } from "node:crypto";

import {
  BEFORE_OUTPUT_DIGEST,
  QUALIFICATION_CYCLE_COUNT,
  QUALIFICATION_SCHEDULE_SEED_UINT32,
  SUCCESS_OUTPUT_DIGEST,
  type QualificationCycle,
  type QualificationSchedule,
} from "./qualification-schedule.ts";

export type QualificationScheduleGolden = Readonly<{
  scheduleSha256: string;
  orderSha256: string;
  cycles: number;
  successCycles: number;
  expectedErrorCycles: number;
  first: QualificationCycle;
  last: QualificationCycle;
}>;

function next(state: number): number {
  let value = state >>> 0;
  value = (value ^ (value << 13)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ (value << 5)) >>> 0;
  return value;
}

function fail(code: string): never {
  throw new Error(`FADENO_REVALIDATION_SCHEDULE_${code}`);
}

export function verifyQualificationSchedule(
  schedule: QualificationSchedule,
  scheduleText: string,
  golden: QualificationScheduleGolden,
): void {
  if (Buffer.byteLength(scheduleText) > 1024 * 1024) fail("SIZE");
  if (schedule.cycles.length !== QUALIFICATION_CYCLE_COUNT || golden.cycles !== QUALIFICATION_CYCLE_COUNT) fail("COUNT");
  if (schedule.outputDigests.before !== BEFORE_OUTPUT_DIGEST || schedule.outputDigests.success !== SUCCESS_OUTPUT_DIGEST) fail("OUTPUT_DIGESTS");
  if (createHash("sha256").update(scheduleText).digest("hex") !== golden.scheduleSha256) fail("HASH");

  let state = QUALIFICATION_SCHEDULE_SEED_UINT32;
  let successCycles = 0;
  const orders: string[] = [];
  for (let index = 0; index < schedule.cycles.length; index += 1) {
    const cycle = schedule.cycles[index]!;
    state = next(state);
    const path = state % 5 === 0 ? "e" : "s";
    const order = Array.from({ length: 9 }, (_, readIndex) => readIndex);
    for (let cursor = order.length - 1; cursor > 0; cursor -= 1) {
      state = next(state);
      const swap = state % (cursor + 1);
      [order[cursor], order[swap]] = [order[swap]!, order[cursor]!];
    }
    const expectedOrder = order.join("");
    if (cycle.id !== `c${String(index).padStart(5, "0")}`) fail("ID");
    if (cycle.path !== path || cycle.readOrder !== expectedOrder) fail("ALGORITHM");
    if ([...cycle.readOrder].sort().join("") !== "012345678") fail("PERMUTATION");
    if (cycle.expectedDigest !== (path === "s" ? "s" : "b")) fail("EXPECTED_DIGEST");
    if (path === "s") successCycles += 1;
    orders.push(cycle.readOrder);
  }
  const orderHash = createHash("sha256").update(orders.join("\n")).digest("hex");
  if (orderHash !== golden.orderSha256) fail("ORDER_HASH");
  if (successCycles !== golden.successCycles || schedule.cycles.length - successCycles !== golden.expectedErrorCycles) fail("PATH_COUNTS");
  if (JSON.stringify(schedule.cycles[0]) !== JSON.stringify(golden.first) || JSON.stringify(schedule.cycles.at(-1)) !== JSON.stringify(golden.last)) fail("ENDPOINTS");
}
