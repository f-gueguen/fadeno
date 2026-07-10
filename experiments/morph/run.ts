import { stableMorphInventory } from "./fixtures/catalog.ts";

let args = process.argv.slice(2);
if (args[0] === "--") args = args.slice(1);

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableMorphInventory());
} else if (args.length === 0 || (args.length === 1 && args[0] === "--verify-harness")) {
  try {
    const { executeMorphHarness } = await import("./harness-runner.ts");
    await executeMorphHarness(args[0] === "--verify-harness" ? "verify" : "default");
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : "FADENO_MORPH_INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${code}: ${message}`);
    process.exitCode = 1;
  }
} else {
  console.error(`FADENO_MORPH_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
