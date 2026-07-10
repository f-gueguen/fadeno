import { stableMorphInventory } from "./fixtures/catalog.ts";

const rawArgs = process.argv.slice(2);
let args = rawArgs;
if (args[0] === "--") args = args.slice(1);
const hasBareSeparator = rawArgs.length === 1 && rawArgs[0] === "--";

const isIntentionalReplacement =
  args.length === 2 && args[0] === "--fixture" && args[1] === "intentional-replacement";

if (!hasBareSeparator && args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableMorphInventory());
} else if (
  !hasBareSeparator &&
  (args.length === 0 ||
    (args.length === 1 && args[0] === "--verify-harness") ||
    isIntentionalReplacement)
) {
  try {
    const { executeMorphHarness } = await import("./harness-runner.ts");
    await executeMorphHarness(
      isIntentionalReplacement
        ? "intentional-replacement"
        : args[0] === "--verify-harness"
          ? "verify"
          : "default",
    );
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
  const displayArguments = hasBareSeparator ? rawArgs : args;
  console.error(`FADENO_MORPH_USAGE: unsupported arguments: ${displayArguments.join(" ")}`);
  process.exitCode = 64;
}
