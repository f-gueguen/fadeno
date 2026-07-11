import { stableTypeSpineContract } from "./contract.ts";

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableTypeSpineContract());
} else if (args.length === 1 && args[0] === "--verify-harness") {
  try {
    const { executeTypeSpineHarness } = await import("./harness.ts");
    const result = executeTypeSpineHarness();
    console.log(`type-spine harness passed (${result.files.length} artifact, 4 valid, 4 invalid)`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.error(`FADENO_TYPE_SPINE_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
