import { stableExtractionInventory } from "./fixtures/catalog.ts";

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableExtractionInventory());
} else if (args.length === 0 || (args.length === 1 && args[0] === "--verify-harness")) {
  try {
    const { executeExtractionHarness } = await import("./harness-runner.ts");
    executeExtractionHarness();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.error(`FADENO_EXTRACTION_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
