import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeRetainedText, qualificationAttemptId } from "./run-revalidation-reference-qualification.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (qualificationAttemptId("2026-07-12T00:00:00Z", "a".repeat(40), 1) !== "20260712T000000Z-aaaaaaa-a1") {
  throw new Error("FADENO_REVALIDATION_LAUNCHER_ATTEMPT_ID");
}
for (const invalid of [
  () => qualificationAttemptId("2026-07-12T00:00:00.000Z", "a".repeat(40), 1),
  () => qualificationAttemptId("2026-07-12T00:00:00Z", "bad", 1),
  () => qualificationAttemptId("2026-07-12T00:00:00Z", "a".repeat(40), 0),
]) {
  let rejected = false;
  try { invalid(); } catch (error: unknown) { rejected = error instanceof Error && error.message === "FADENO_REVALIDATION_ATTEMPT_ID"; }
  if (!rejected) throw new Error("FADENO_REVALIDATION_LAUNCHER_ATTEMPT_MUTATION");
}
const sensitive = ["canary-value", "principal-value", "tenant-value"];
for (const text of [...sensitive, "Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "password=hunter2", "-----BEGIN PRIVATE KEY-----"]) {
  let rejected = false;
  try { assertSafeRetainedText(`prefix:${text}:suffix`, sensitive); } catch (error: unknown) {
    rejected = error instanceof Error && error.message === "FADENO_REVALIDATION_RETAINED_SECRET" && !sensitive.some((value) => error.message.includes(value));
  }
  if (!rejected) throw new Error("FADENO_REVALIDATION_LAUNCHER_SECRET_MUTATION");
}
assertSafeRetainedText("allowlisted metrics and digests only", sensitive);

const launcher = readFileSync(join(root, "scripts/run-revalidation-reference-qualification.ts"), "utf8");
for (const required of [
  '"--cpus", "2"', '"--memory", "8192m"', '"--memory-swap", "8192m"', '"--pids-limit", "256"',
  '"network", "disconnect"', '"--expose-gc"', "verifySourceInputs", "verifyContainerInputs", "statusPaths.some", "assertSafeRetainedText",
]) {
  if (!launcher.includes(required)) throw new Error(`FADENO_REVALIDATION_LAUNCHER_POLICY:${required}`);
}
if (launcher.includes(".mjs")) throw new Error("FADENO_REVALIDATION_LAUNCHER_MJS");
console.log("revalidation qualification launcher controls passed (source, limits, network, GC, retention, redaction)");
