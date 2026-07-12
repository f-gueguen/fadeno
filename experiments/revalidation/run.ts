import { stableRevalidationContract } from "./contract.ts";

const raw = process.argv.slice(2);
const args = raw[0] === "--" ? raw.slice(1) : raw;

if (args.length === 1 && args[0] === "--list") {
  process.stdout.write(stableRevalidationContract());
} else {
  console.error(`FADENO_REVALIDATION_USAGE: unsupported arguments: ${args.join(" ")}`);
  process.exitCode = 64;
}
