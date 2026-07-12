import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildQualificationSchedule } from "../experiments/revalidation/qualification-schedule.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const schedulePath = join(experiment, "qualification-schedule.json");
const goldenPath = join(experiment, "qualification-schedule.golden.json");
const schedule = buildQualificationSchedule();
const scheduleText = `${JSON.stringify(schedule)}\n`;
const ordersText = schedule.cycles.map(({ readOrder }) => readOrder).join("\n");
const successCycles = schedule.cycles.filter(({ path }) => path === "s").length;
const golden = {
  $schema: "https://fadeno.dev/schemas/experiment/revalidation-qualification-schedule-golden-v1.json",
  schemaVersion: 1,
  scheduleSha256: createHash("sha256").update(scheduleText).digest("hex"),
  orderSha256: createHash("sha256").update(ordersText).digest("hex"),
  cycles: schedule.cycles.length,
  successCycles,
  expectedErrorCycles: schedule.cycles.length - successCycles,
  first: schedule.cycles[0],
  last: schedule.cycles.at(-1),
};
const goldenText = `${JSON.stringify(golden, null, 2)}\n`;

if (process.argv.slice(2).includes("--check")) {
  if (readFileSync(schedulePath, "utf8") !== scheduleText || readFileSync(goldenPath, "utf8") !== goldenText) {
    throw new Error("FADENO_REVALIDATION_SCHEDULE_DRIFT");
  }
} else {
  writeFileSync(schedulePath, scheduleText);
  writeFileSync(goldenPath, goldenText);
}
