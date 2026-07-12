import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stableRevalidationContract } from "./contract.ts";

const repository = join(dirname(fileURLToPath(import.meta.url)), "../..");

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableRevalidationContract());
} else if (args.length === 1 && args[0] === "--verify-harness") {
  try {
    const { assertRevalidationHarnessReport, executeRevalidationHarness } = await import("./harness.ts");
    const report = executeRevalidationHarness();
    assertRevalidationHarnessReport(report);
    console.log(`revalidation harness passed (${report.rows} rows, ${report.unsafeKeepsDetected}/${report.unsafeKeepsTotal} unsafe keeps)`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === "--verify-qualification") {
  try {
    const scripts: readonly (readonly [string, ...string[]])[] = [
      ["scripts/check-revalidation-reference.ts"],
      ["scripts/check-revalidation-qualification-contract.ts"],
      ["scripts/test-revalidation-qualification-contract.ts"],
      ["scripts/build-revalidation-qualification-schedule.ts", "--check"],
      ["scripts/check-revalidation-qualification-schedule.ts"],
      ["scripts/test-revalidation-qualification-schedule.ts"],
      ["scripts/check-revalidation-qualification-runner.ts"],
      ["scripts/test-revalidation-qualification-runner.ts"],
      ["scripts/check-revalidation-qualification-proof.ts"],
      ["scripts/test-revalidation-qualification-proof.ts"],
      ["scripts/test-revalidation-qualification-launcher.ts"],
    ];
    for (const [script, ...scriptArgs] of scripts) {
      const output = execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...scriptArgs], {
        cwd: repository,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stdout.write(output);
    }
    console.log("revalidation qualification capability passed (K0-10A, no result or decision)");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === "--qualify") {
  console.error("FADENO_REVALIDATION_QUALIFICATION_SOURCE_REQUIRED: K0-10B must bind the exact merged K0-10A source");
  process.exitCode = 2;
} else {
  console.error(`FADENO_REVALIDATION_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
