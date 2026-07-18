export const A0_REGISTRY = "https://registry.npmjs.org/";

type JsonRecord = Record<string, unknown>;

export type RegistryBlocker =
  | "invalid-candidate"
  | "invalid-organization"
  | "registry-authentication-required"
  | "registry-candidate-occupied"
  | "registry-candidate-required"
  | "registry-organization-ownership-unverified"
  | "registry-package-not-found"
  | "registry-ownership-unverified"
  | "registry-response-invalid"
  | "registry-unavailable";

export type RegistryOperation = "whoami" | "org-ls" | "view" | "owner-ls";

export type RegistryCommand = Readonly<{
  operation: RegistryOperation;
  executable: "npm";
  arguments: readonly string[];
}>;

export type RegistryCommandResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}>;

export type RegistryCommandRunner = (command: RegistryCommand) => RegistryCommandResult;

export type RegistryOperationEvidence = Readonly<{
  operation: RegistryOperation;
  exitCode: number | null;
  outcome: "accepted" | RegistryBlocker;
}>;

export type RegistryPreflightEvidence = Readonly<{
  schemaVersion: 1;
  registry: typeof A0_REGISTRY;
  verificationMode: "read-only";
  authenticatedOwner: string | null;
  candidateIdentity: string | null;
  selectedIdentity: string | null;
  blocker: RegistryBlocker | null;
  publicationAttempted: false;
  publicationAuthorized: false;
  operations: readonly RegistryOperationEvidence[];
}>;

export type RegistryOrganizationPreflightEvidence = Readonly<{
  schemaVersion: 1;
  registry: typeof A0_REGISTRY;
  verificationMode: "read-only";
  authenticatedOwner: string | null;
  organization: string | null;
  organizationRole: "owner" | null;
  candidateIdentity: string | null;
  candidateState: "unpublished" | null;
  selectedIdentity: string | null;
  blocker: RegistryBlocker | null;
  publicationAttempted: false;
  publicationAuthorized: false;
  operations: readonly RegistryOperationEvidence[];
}>;

const usernamePattern = /^[a-z0-9][a-z0-9._-]*$/u;
const packagePartPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const organizationPattern = /^[a-z0-9][a-z0-9-]*$/u;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCandidate(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 214 || candidate !== candidate.toLowerCase()) return false;
  if (candidate.startsWith("@")) {
    const match = /^@([^/]+)\/([^/]+)$/u.exec(candidate);
    return Boolean(match && packagePartPattern.test(match[1] ?? "") && packagePartPattern.test(match[2] ?? ""));
  }
  return packagePartPattern.test(candidate);
}

function normalizeOrganization(organization: string): string | null {
  const normalized = organization.startsWith("@") ? organization.slice(1) : organization;
  return organizationPattern.test(normalized) ? normalized : null;
}

function failure(operation: RegistryOperation, stderr: string): RegistryBlocker {
  if (/ENEEDAUTH|E401|\b401\b|not logged in|need auth/iu.test(stderr)) return "registry-authentication-required";
  if (operation === "org-ls" && /E403|\b403\b|forbidden|not authorized|permission denied/iu.test(stderr)) {
    return "registry-organization-ownership-unverified";
  }
  if (operation === "owner-ls" && /E404|\b404\b|not found/iu.test(stderr)) return "registry-package-not-found";
  return "registry-unavailable";
}

function command(operation: RegistryOperation, arguments_: readonly string[]): RegistryCommand {
  return Object.freeze({ operation, executable: "npm", arguments: Object.freeze([...arguments_]) });
}

export function registryWhoamiCommand(): RegistryCommand {
  return command("whoami", ["whoami", `--registry=${A0_REGISTRY}`]);
}

export function registryOwnerCommand(candidate: string): RegistryCommand {
  if (!validCandidate(candidate)) throw new Error("FADENO_A0_REGISTRY_INVALID_CANDIDATE");
  return command("owner-ls", ["owner", "ls", candidate, `--registry=${A0_REGISTRY}`]);
}

export function registryOrganizationCommand(organization: string): RegistryCommand {
  const normalized = normalizeOrganization(organization);
  if (normalized === null) throw new Error("FADENO_A0_REGISTRY_INVALID_ORGANIZATION");
  return command("org-ls", ["org", "ls", normalized, "--json", `--registry=${A0_REGISTRY}`]);
}

export function registryViewCommand(candidate: string): RegistryCommand {
  if (!validCandidate(candidate)) throw new Error("FADENO_A0_REGISTRY_INVALID_CANDIDATE");
  return command("view", ["view", candidate, "name", "version", "--json", `--registry=${A0_REGISTRY}`]);
}

function evidence(
  candidateIdentity: string | null,
  authenticatedOwner: string | null,
  selectedIdentity: string | null,
  blocker: RegistryBlocker | null,
  operations: readonly RegistryOperationEvidence[],
): RegistryPreflightEvidence {
  return Object.freeze({
    schemaVersion: 1,
    registry: A0_REGISTRY,
    verificationMode: "read-only",
    authenticatedOwner,
    candidateIdentity,
    selectedIdentity,
    blocker,
    publicationAttempted: false,
    publicationAuthorized: false,
    operations: Object.freeze([...operations]),
  });
}

function operationEvidence(
  operation: RegistryOperation,
  result: RegistryCommandResult,
  outcome: RegistryOperationEvidence["outcome"],
): RegistryOperationEvidence {
  return Object.freeze({ operation, exitCode: result.exitCode, outcome });
}

function parseOwners(stdout: string): readonly string[] | null {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const owners: string[] = [];
  for (const line of lines) {
    const match = /^([^\s]+)\s+<[^<>\r\n]+>$/u.exec(line);
    const owner = match?.[1] ?? "";
    if (!usernamePattern.test(owner)) return null;
    owners.push(owner);
  }
  return Object.freeze(owners);
}

export function runRegistryPreflight(candidate: string | null, run: RegistryCommandRunner): RegistryPreflightEvidence {
  if (candidate !== null && !validCandidate(candidate)) {
    return evidence(candidate, null, null, "invalid-candidate", []);
  }

  const operations: RegistryOperationEvidence[] = [];
  const whoami = run(registryWhoamiCommand());
  if (whoami.exitCode !== 0) {
    const blocker = failure("whoami", whoami.stderr);
    operations.push(operationEvidence("whoami", whoami, blocker));
    return evidence(candidate, null, null, blocker, operations);
  }
  const owner = whoami.stdout.trim();
  if (!usernamePattern.test(owner)) {
    operations.push(operationEvidence("whoami", whoami, "registry-response-invalid"));
    return evidence(candidate, null, null, "registry-response-invalid", operations);
  }
  operations.push(operationEvidence("whoami", whoami, "accepted"));

  if (candidate === null) {
    return evidence(null, owner, null, "registry-candidate-required", operations);
  }

  const ownerResult = run(registryOwnerCommand(candidate));
  if (ownerResult.exitCode !== 0) {
    const blocker = failure("owner-ls", ownerResult.stderr);
    operations.push(operationEvidence("owner-ls", ownerResult, blocker));
    return evidence(candidate, owner, null, blocker, operations);
  }
  const owners = parseOwners(ownerResult.stdout);
  if (owners === null) {
    operations.push(operationEvidence("owner-ls", ownerResult, "registry-response-invalid"));
    return evidence(candidate, owner, null, "registry-response-invalid", operations);
  }
  if (!owners.includes(owner)) {
    operations.push(operationEvidence("owner-ls", ownerResult, "registry-ownership-unverified"));
    return evidence(candidate, owner, null, "registry-ownership-unverified", operations);
  }
  operations.push(operationEvidence("owner-ls", ownerResult, "accepted"));
  return evidence(candidate, owner, candidate, null, operations);
}

function organizationEvidence(
  organization: string | null,
  candidateIdentity: string | null,
  authenticatedOwner: string | null,
  organizationRole: "owner" | null,
  candidateState: "unpublished" | null,
  selectedIdentity: string | null,
  blocker: RegistryBlocker | null,
  operations: readonly RegistryOperationEvidence[],
): RegistryOrganizationPreflightEvidence {
  return Object.freeze({
    schemaVersion: 1,
    registry: A0_REGISTRY,
    verificationMode: "read-only",
    authenticatedOwner,
    organization,
    organizationRole,
    candidateIdentity,
    candidateState,
    selectedIdentity,
    blocker,
    publicationAttempted: false,
    publicationAuthorized: false,
    operations: Object.freeze([...operations]),
  });
}

export function runRegistryOrganizationPreflight(
  organization: string,
  candidate: string,
  run: RegistryCommandRunner,
): RegistryOrganizationPreflightEvidence {
  const normalizedOrganization = normalizeOrganization(organization);
  if (normalizedOrganization === null) {
    return organizationEvidence(organization, candidate, null, null, null, null, "invalid-organization", []);
  }
  if (!validCandidate(candidate) || !candidate.startsWith(`@${normalizedOrganization}/`)) {
    return organizationEvidence(normalizedOrganization, candidate, null, null, null, null, "invalid-candidate", []);
  }

  const operations: RegistryOperationEvidence[] = [];
  const whoami = run(registryWhoamiCommand());
  if (whoami.exitCode !== 0) {
    const blocker = failure("whoami", whoami.stderr);
    operations.push(operationEvidence("whoami", whoami, blocker));
    return organizationEvidence(normalizedOrganization, candidate, null, null, null, null, blocker, operations);
  }
  const owner = whoami.stdout.trim();
  if (!usernamePattern.test(owner)) {
    operations.push(operationEvidence("whoami", whoami, "registry-response-invalid"));
    return organizationEvidence(normalizedOrganization, candidate, null, null, null, null, "registry-response-invalid", operations);
  }
  operations.push(operationEvidence("whoami", whoami, "accepted"));

  const organizationResult = run(registryOrganizationCommand(normalizedOrganization));
  if (organizationResult.exitCode !== 0) {
    const blocker = failure("org-ls", organizationResult.stderr);
    operations.push(operationEvidence("org-ls", organizationResult, blocker));
    return organizationEvidence(normalizedOrganization, candidate, owner, null, null, null, blocker, operations);
  }
  let members: unknown;
  try {
    members = JSON.parse(organizationResult.stdout) as unknown;
  } catch {
    members = null;
  }
  if (!isRecord(members)) {
    operations.push(operationEvidence("org-ls", organizationResult, "registry-response-invalid"));
    return organizationEvidence(normalizedOrganization, candidate, owner, null, null, null, "registry-response-invalid", operations);
  }
  if (members[owner] !== "owner") {
    operations.push(operationEvidence("org-ls", organizationResult, "registry-organization-ownership-unverified"));
    return organizationEvidence(normalizedOrganization, candidate, owner, null, null, null, "registry-organization-ownership-unverified", operations);
  }
  operations.push(operationEvidence("org-ls", organizationResult, "accepted"));

  const candidateResult = run(registryViewCommand(candidate));
  if (candidateResult.exitCode === 0) {
    operations.push(operationEvidence("view", candidateResult, "registry-candidate-occupied"));
    return organizationEvidence(normalizedOrganization, candidate, owner, "owner", null, null, "registry-candidate-occupied", operations);
  }
  if (!/E404|\b404\b|not found/iu.test(candidateResult.stderr)) {
    const blocker = failure("view", candidateResult.stderr);
    operations.push(operationEvidence("view", candidateResult, blocker));
    return organizationEvidence(normalizedOrganization, candidate, owner, "owner", null, null, blocker, operations);
  }
  operations.push(operationEvidence("view", candidateResult, "accepted"));
  return organizationEvidence(normalizedOrganization, candidate, owner, "owner", "unpublished", candidate, null, operations);
}

export function validateRegistryDiscovery(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return Object.freeze(["A0 registry evidence must be an object"]);
  if (value["schemaVersion"] !== 3) errors.push("A0 registry schemaVersion must be 3");
  if (value["observedAt"] !== "2026-07-18") errors.push("A0 registry observation date mismatch");
  if (value["registry"] !== A0_REGISTRY) errors.push("A0 registry authority mismatch");
  if (value["verificationMode"] !== "read-only") errors.push("A0 registry verification must be read-only");
  if (value["unscopedIdentity"] !== "fadeno" || value["unscopedAvailability"] !== "occupied") errors.push("A0 unscoped registry evidence mismatch");
  if (value["authenticatedOwner"] !== "fgueguen"
    || value["organization"] !== "fadeno"
    || value["organizationRole"] !== "owner"
    || value["candidateIdentity"] !== "@fadeno/framework"
    || value["candidateState"] !== "unpublished"
    || value["selectedIdentity"] !== "@fadeno/framework") {
    errors.push("A0 registry identity mapping mismatch");
  }
  if (value["blocker"] !== null) errors.push("A0 registry ownership blocker must be resolved");
  if (value["publicationAttempted"] !== false || value["publicationAuthorized"] !== false) errors.push("A0 registry evidence must remain non-publishing");
  const allowedOperations = value["allowedOperations"];
  if (!Array.isArray(allowedOperations)
    || JSON.stringify(allowedOperations) !== JSON.stringify(["whoami", "org-ls", "view", "owner-ls"])) {
    errors.push("A0 registry allowed operations must remain read-only");
  }
  return Object.freeze(errors);
}

export function validateRegistryCaptureSource(source: string): readonly string[] {
  const errors: string[] = [];
  if (!source.includes("runRegistryOrganizationPreflight(options.organization, options.candidate, run)")
    || !source.includes("runRegistryPreflight(options.candidate, run)")) {
    errors.push("A0 registry capture must delegate to the bounded preflight");
  }
  if ((source.match(/spawnSync\(/gu) ?? []).length !== 1
    || !source.includes("spawnSync(command.executable, command.arguments")) {
    errors.push("A0 registry capture command boundary drifted");
  }
  if (/["'](?:publish|unpublish|add|rm|set|grant|revoke|token|dist-tag)["']/iu.test(source)
    || /\b(?:writeFile|appendFile|rename|unlink)Sync\b/u.test(source)) {
    errors.push("A0 registry capture admitted mutation");
  }
  return Object.freeze(errors);
}
