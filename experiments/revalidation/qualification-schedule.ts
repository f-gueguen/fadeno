export const QUALIFICATION_SCHEDULE_SEED = "fadeno-k0-h4-cycles-v1";
export const QUALIFICATION_SCHEDULE_SEED_UINT32 = 0x1688b47d;
export const QUALIFICATION_CYCLE_COUNT = 10_000;
export const BEFORE_OUTPUT_DIGEST = "739f2c0134ad398a5de59c886b0586c05abfb22999ae88a486a67eeab37bb75c";
export const SUCCESS_OUTPUT_DIGEST = "578277e2d736653c4a9201588b47b19f00b9f77c74cadbb4b9b31d185e6ec2b8";

export type QualificationCycle = Readonly<{
  id: string;
  path: "s" | "e";
  readOrder: string;
  expectedDigest: "s" | "b";
}>;

export type QualificationSchedule = Readonly<{
  $schema: "https://fadeno.dev/schemas/experiment/revalidation-qualification-schedule-v1.json";
  schemaVersion: 1;
  randomSeed: typeof QUALIFICATION_SCHEDULE_SEED;
  algorithm: "xorshift32-fisher-yates-v1";
  outputDigests: Readonly<{ before: typeof BEFORE_OUTPUT_DIGEST; success: typeof SUCCESS_OUTPUT_DIGEST }>;
  cycles: readonly QualificationCycle[];
}>;

function nextXorshift32(state: number): number {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

export function buildQualificationSchedule(): QualificationSchedule {
  let state = QUALIFICATION_SCHEDULE_SEED_UINT32;
  const cycles: QualificationCycle[] = [];
  for (let index = 0; index < QUALIFICATION_CYCLE_COUNT; index += 1) {
    state = nextXorshift32(state);
    const path = state % 5 === 0 ? "e" : "s";
    const readOrder = Array.from({ length: 9 }, (_, readIndex) => readIndex);
    for (let cursor = readOrder.length - 1; cursor > 0; cursor -= 1) {
      state = nextXorshift32(state);
      const swap = state % (cursor + 1);
      [readOrder[cursor], readOrder[swap]] = [readOrder[swap]!, readOrder[cursor]!];
    }
    cycles.push({
      id: `c${String(index).padStart(5, "0")}`,
      path,
      readOrder: readOrder.join(""),
      expectedDigest: path === "s" ? "s" : "b",
    });
  }
  return {
    $schema: "https://fadeno.dev/schemas/experiment/revalidation-qualification-schedule-v1.json",
    schemaVersion: 1,
    randomSeed: QUALIFICATION_SCHEDULE_SEED,
    algorithm: "xorshift32-fisher-yates-v1",
    outputDigests: { before: BEFORE_OUTPUT_DIGEST, success: SUCCESS_OUTPUT_DIGEST },
    cycles,
  };
}
