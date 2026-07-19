import { spawnSync } from "node:child_process";

const registry = "https://registry.npmjs.org/";
const token = process.env["NODE_AUTH_TOKEN"];
if (process.env["GITHUB_ACTIONS"] !== "true"
  || process.env["FADENO_RELEASE_MODE"] !== "bootstrap"
  || !token) throw new TypeError("FADENO_A0_BOOTSTRAP_REVOCATION_ENVIRONMENT");

const environment = { ...process.env, NODE_AUTH_TOKEN: token, npm_config_registry: registry };
const revoked = spawnSync("npm", ["token", "revoke", token, "--registry", registry], {
  encoding: "utf8",
  env: environment,
});
if (revoked.error) throw revoked.error;
if (revoked.status !== 0 || revoked.signal !== null) {
  throw new Error(`FADENO_A0_BOOTSTRAP_REVOCATION_COMMAND:${revoked.status ?? revoked.signal ?? "unknown"}`);
}

for (let attempt = 0; attempt < 10; attempt += 1) {
  const probe = spawnSync("npm", ["whoami", "--registry", registry], {
    encoding: "utf8",
    env: environment,
  });
  if (!probe.error && probe.status !== 0) {
    console.log("A0 bootstrap publication token revoked and rejected by the registry");
    process.exit(0);
  }
  await new Promise<void>((accept) => setTimeout(accept, 1_000));
}
throw new Error("FADENO_A0_BOOTSTRAP_TOKEN_STILL_ACTIVE");
