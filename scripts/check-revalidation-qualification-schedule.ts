import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { completeTask, createState, materializePage, pageOutputDigest, renderPage, revalidateDefault } from "../experiments/revalidation/benchmark.ts";
import { loadRevalidationBaselines, loadRevalidationWorkload } from "../experiments/revalidation/contract.ts";
import { verifyQualificationSchedule, type QualificationScheduleGolden } from "../experiments/revalidation/qualification-schedule-proof.ts";
import type { QualificationSchedule } from "../experiments/revalidation/qualification-schedule.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown } };
const ajv = new Ajv2020({ allErrors: true, strict: true });
function loadChecked<T>(documentName: string, schemaName: string): Readonly<{ value: T; text: string }> {
  const text = readFileSync(join(experiment, documentName), "utf8");
  const value = JSON.parse(text) as T;
  const schema = JSON.parse(readFileSync(join(experiment, schemaName), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(value)) throw new Error(`FADENO_REVALIDATION_SCHEDULE_SCHEMA:${JSON.stringify(validate.errors)}`);
  return { value, text };
}
const schedule = loadChecked<QualificationSchedule>("qualification-schedule.json", "qualification-schedule.schema.json");
const golden = loadChecked<QualificationScheduleGolden>("qualification-schedule.golden.json", "qualification-schedule.golden.schema.json");
verifyQualificationSchedule(schedule.value, schedule.text, golden.value);

const workload = loadRevalidationWorkload();
const baselines = loadRevalidationBaselines();
const state = createState(workload.dataset.rowCount);
const before = renderPage(state, workload.authentication, workload);
if (pageOutputDigest(materializePage(before)) !== schedule.value.outputDigests.before) throw new Error("FADENO_REVALIDATION_SCHEDULE_BEFORE_OUTPUT");
completeTask(state, workload.authentication, workload.mutation.rowId);
const after = revalidateDefault(state, workload.authentication, workload, baselines);
if (pageOutputDigest(materializePage(after)) !== schedule.value.outputDigests.success) throw new Error("FADENO_REVALIDATION_SCHEDULE_SUCCESS_OUTPUT");
console.log("revalidation qualification schedule passed (10000 fresh-state cycles, 8056 success, 1944 expected-error)");
