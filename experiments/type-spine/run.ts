import { stableTypeSpineContract } from "./contract.ts";

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableTypeSpineContract());
} else if (args.length === 1 && args[0] === "--verify-harness") {
  try {
    const { executeTypeSpineHarness } = await import("./harness.ts");
    const result = executeTypeSpineHarness();
    console.log(`type-spine harness passed (${result.files.length} artifact, 5 valid, 5 invalid)`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === "--verify-qualification") {
  try {
    await import("../../scripts/check-type-spine-qualification-corpus.ts");
    await import("../../scripts/check-type-spine-qualification-contract.ts");
    await import("../../scripts/check-type-spine-qualification-controls.ts");
    console.log("type-spine qualification capability passed (no result or decision)");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.error(`FADENO_TYPE_SPINE_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
