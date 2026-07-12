import { stableRevalidationContract } from "./contract.ts";

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableRevalidationContract());
} else if (args.length === 1 && args[0] === "--verify-harness") {
  try {
    const { executeRevalidationHarness } = await import("./harness.ts");
    const report = executeRevalidationHarness();
    console.log(`revalidation harness passed (${report.rows} rows, ${report.unsafeKeepsDetected}/${report.unsafeKeepsTotal} unsafe keeps)`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.error(`FADENO_REVALIDATION_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
