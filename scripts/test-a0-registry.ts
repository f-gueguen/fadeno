import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  A0_REGISTRY,
  registryOwnerCommand,
  registryWhoamiCommand,
  runRegistryPreflight,
  validateRegistryCaptureSource,
  validateRegistryDiscovery,
  type RegistryCommand,
  type RegistryCommandResult,
} from "./lib/a0-registry.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../evidence/a0/registry-preflight/${name}.json`, import.meta.url), "utf8")) as unknown;

const ok = (stdout: string): RegistryCommandResult => Object.freeze({ exitCode: 0, stdout, stderr: "" });
const refused = (stderr: string, exitCode = 1): RegistryCommandResult => Object.freeze({ exitCode, stdout: "", stderr });

function runner(results: readonly RegistryCommandResult[], observed: RegistryCommand[]): (command: RegistryCommand) => RegistryCommandResult {
  let index = 0;
  return (command) => {
    observed.push(command);
    const result = results[index];
    index += 1;
    if (!result) throw new Error(`unexpected registry command: ${command.operation}`);
    return result;
  };
}

function expectBlocker(candidate: string | null, results: readonly RegistryCommandResult[], expected: string): void {
  const observed: RegistryCommand[] = [];
  const evidence = runRegistryPreflight(candidate, runner(results, observed));
  if (evidence.blocker !== expected || evidence.selectedIdentity !== null || evidence.publicationAttempted || evidence.publicationAuthorized) {
    throw new Error(`registry refusal mismatch: ${expected}\n${JSON.stringify(evidence)}`);
  }
}

const whoami = registryWhoamiCommand();
if (JSON.stringify(whoami) !== JSON.stringify({
  operation: "whoami",
  executable: "npm",
  arguments: ["whoami", `--registry=${A0_REGISTRY}`],
})) throw new Error("whoami command drifted");

const owner = registryOwnerCommand("@maintainer/fadeno");
if (JSON.stringify(owner) !== JSON.stringify({
  operation: "owner-ls",
  executable: "npm",
  arguments: ["owner", "ls", "@maintainer/fadeno", `--registry=${A0_REGISTRY}`],
})) throw new Error("owner command drifted");
for (const token of [...whoami.arguments, ...owner.arguments]) {
  if (["publish", "unpublish", "add", "rm", "set", "grant", "revoke", "token", "dist-tag"].includes(token)) {
    throw new Error(`mutating registry token admitted: ${token}`);
  }
}

const successCommands: RegistryCommand[] = [];
const success = runRegistryPreflight(
  "@maintainer/fadeno",
  runner([ok("maintainer\n"), ok("maintainer <private@example.invalid>\nbackup <private@example.invalid>\n")], successCommands),
);
if (success.blocker !== null
  || success.authenticatedOwner !== "maintainer"
  || success.selectedIdentity !== "@maintainer/fadeno"
  || success.publicationAttempted
  || success.publicationAuthorized
  || JSON.stringify(success.operations.map((operation) => operation.operation)) !== JSON.stringify(["whoami", "owner-ls"])) {
  throw new Error(`valid owned package refused:\n${JSON.stringify(success)}`);
}
if (JSON.stringify(success).includes("private@example.invalid")) throw new Error("owner email escaped normalized evidence");
if (JSON.stringify(success) !== JSON.stringify(fixture("owned-package"))) throw new Error("owned-package fixture drifted");

const authenticationCommands: RegistryCommand[] = [];
const authenticationRequired = runRegistryPreflight(
  null,
  runner([refused("ENEEDAUTH this command requires you to be logged in")], authenticationCommands),
);
if (JSON.stringify(authenticationRequired) !== JSON.stringify(fixture("authentication-required"))) {
  throw new Error("authentication-required fixture drifted");
}
expectBlocker(null, [refused("404 endpoint not found")], "registry-unavailable");
expectBlocker(null, [ok("maintainer\n")], "registry-candidate-required");
expectBlocker("@maintainer/missing", [ok("maintainer\n"), refused("E404 package not found")], "registry-package-not-found");
expectBlocker("@maintainer/fadeno", [ok("maintainer\n"), ok("someone-else <private@example.invalid>\n")], "registry-ownership-unverified");
expectBlocker("@maintainer/fadeno", [ok("maintainer\n"), ok("not an owner record\n")], "registry-response-invalid");
expectBlocker("@maintainer/fadeno", [ok("maintainer\n"), refused("network unavailable")], "registry-unavailable");
expectBlocker("INVALID NAME", [], "invalid-candidate");
expectBlocker("@maintainer/fadeno;publish", [], "invalid-candidate");
expectBlocker("@maintainer/fadeno", [ok("unexpected owner value\nwith spaces\n")], "registry-response-invalid");

const trackedEvidence = {
  schemaVersion: 2,
  observedAt: "2026-07-18",
  registry: A0_REGISTRY,
  verificationMode: "read-only",
  unscopedIdentity: "fadeno",
  unscopedAvailability: "occupied",
  authenticatedOwner: null,
  candidateIdentity: null,
  selectedIdentity: null,
  blocker: "registry-authentication-required",
  publicationAttempted: false,
  publicationAuthorized: false,
  allowedOperations: ["whoami", "owner-ls"],
};
if (validateRegistryDiscovery(trackedEvidence).length !== 0) throw new Error("valid tracked registry evidence refused");
const mutatingEvidence = { ...trackedEvidence, allowedOperations: ["whoami", "publish"] };
if (!validateRegistryDiscovery(mutatingEvidence).includes("A0 registry allowed operations must remain read-only")) {
  throw new Error("mutating tracked operation was not refused");
}
const publishingEvidence = { ...trackedEvidence, publicationAttempted: true };
if (!validateRegistryDiscovery(publishingEvidence).includes("A0 registry evidence must remain non-publishing")) {
  throw new Error("publication attempt was not refused");
}

const captureSource = readFileSync(`${root}scripts/capture-a0-registry.ts`, "utf8");
if (validateRegistryCaptureSource(captureSource).length !== 0) throw new Error("valid capture source refused");
if (!validateRegistryCaptureSource(captureSource.replace(
  "const result = runRegistryPreflight",
  'spawnSync("npm", ["publish"]);\nconst result = runRegistryPreflight',
)).includes("A0 registry capture admitted mutation")) throw new Error("direct publication mutation was not refused");
if (!validateRegistryCaptureSource(captureSource.replace(
  "runRegistryPreflight(candidateArgument(process.argv.slice(2)), run)",
  "runRegistryPreflight(null, run)",
)).includes("A0 registry capture must delegate to the bounded preflight")) throw new Error("capture delegation mutation was not refused");

console.log("A0 registry preflight tests passed (success, auth, ownership, malformed data, injection, no publication)");
