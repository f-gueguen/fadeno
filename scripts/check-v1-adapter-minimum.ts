import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const image = "node@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0";
const result = spawnSync("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--mount",
  `type=bind,source=${repositoryRoot},target=/workspace,readonly`,
  "--workdir",
  "/workspace",
  image,
  "node",
  "--no-warnings",
  "--experimental-strip-types",
  "scripts/check-v1-adapter-contract.ts",
  "--require-minimum",
], { encoding: "utf8" });

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`FADENO_ADAPTER_MINIMUM_RUN:${result.status ?? result.signal}`);

console.log(`V1 Node adapter minimum passed (${image}; network disabled; repository read-only)`);
