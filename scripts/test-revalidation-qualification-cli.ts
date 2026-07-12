import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function run(argument: string) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "experiments/revalidation/run.ts", "--", argument], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
const verify = run("--verify-qualification");
if (verify.status !== 0 || verify.stderr !== "" || !verify.stdout.endsWith("revalidation qualification capability passed (K0-10A frozen contract)\n")) {
  throw new Error(`FADENO_REVALIDATION_QUALIFICATION_CLI_VERIFY:${verify.status}:${verify.stderr}`);
}
const qualify = run("--qualify");
if (qualify.status !== 0 || qualify.stderr !== "" || !qualify.stdout.endsWith("revalidation qualification passed (H4 GO from exact merged K0-10A source)\n")) {
  throw new Error(`FADENO_REVALIDATION_QUALIFICATION_CLI_RESULT:${qualify.status}:${qualify.stdout}:${qualify.stderr}`);
}
console.log("revalidation qualification CLI passed (verify capability and immutable GO result)");
