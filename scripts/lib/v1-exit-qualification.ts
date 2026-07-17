import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

type JsonRecord = Record<string, unknown>;

export type V1ExitContext = Readonly<{
  v1Features: ReadonlySet<string>;
  scripts: Readonly<Record<string, string>>;
  rootCheck: string;
  trackedEvidence: ReadonlySet<string>;
  packagePrivate: boolean;
  packageVersion: string;
  packageHasPublishConfig: boolean;
  supportPolicy: string;
  deferrals: string;
}>;

const claimKeys = Object.freeze([
  "packagePublishable",
  "productionSupported",
  "publicAnalyzerSchema",
  "supportedEditorProduct",
  "incrementalPerformanceBound",
  "independentHumanUsabilityEvidence",
]);

const auditOutcomes = Object.freeze<Record<string, string>>({
  accessibility: "qualified-native-baseline",
  architecture: "qualified-private-boundaries",
  "big-o": "qualified-without-new-bound",
  documentation: "qualified-generated-authority",
  "independent-workflow": "qualified-synthetic-consumer",
  security: "qualified-v1-boundaries",
});

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, label: string, errors: string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    errors.push(`V1 exit ${label} must be a non-empty string array`);
    return [];
  }
  return value as readonly string[];
}

function compareExact(actual: ReadonlySet<string>, expected: ReadonlySet<string>, label: string, errors: string[]): void {
  for (const value of expected) if (!actual.has(value)) errors.push(`V1 exit ${label} missing: ${value}`);
  for (const value of actual) if (!expected.has(value)) errors.push(`V1 exit ${label} unexpected: ${value}`);
}

export function readV1ExitDocument(root: string): unknown {
  return JSON.parse(readFileSync(join(root, "evidence/v1-exit/qualification.json"), "utf8")) as unknown;
}

export function createV1ExitContext(root: string, tracked: ReadonlySet<string>): V1ExitContext {
  const scope = readFileSync(join(root, "docs/product/scope.md"), "utf8");
  const v1Features = new Set<string>();
  for (const line of scope.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (/^[A-Z]+-\d+$/u.test(cells[0] ?? "") && (cells[2] ?? "").split("/").includes("V1")) v1Features.add(cells[0] as string);
  }

  const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as JsonRecord;
  const scriptsValue = isRecord(workspace["scripts"]) ? workspace["scripts"] : {};
  const scripts = Object.fromEntries(Object.entries(scriptsValue).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const frameworkPackage = JSON.parse(readFileSync(join(root, "packages/framework/package.json"), "utf8")) as JsonRecord;
  const trackedEvidence = new Set<string>();
  const canonicalRoot = realpathSync(root);
  for (const path of tracked) {
    try {
      const absolute = join(root, path);
      const canonical = realpathSync(absolute);
      if (lstatSync(absolute).isFile() && (canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${sep}`))) trackedEvidence.add(path);
    } catch { /* missing or non-canonical tracked paths are unavailable evidence */ }
  }

  return Object.freeze({
    v1Features,
    scripts,
    rootCheck: scripts["check"] ?? "",
    trackedEvidence,
    packagePrivate: frameworkPackage["private"] === true,
    packageVersion: typeof frameworkPackage["version"] === "string" ? frameworkPackage["version"] : "",
    packageHasPublishConfig: Object.hasOwn(frameworkPackage, "publishConfig"),
    supportPolicy: readFileSync(join(root, "SUPPORT.md"), "utf8"),
    deferrals: readFileSync(join(root, "docs/ledgers/deferrals.md"), "utf8"),
  });
}

function safeEvidencePath(path: string): boolean {
  return !isAbsolute(path) && !path.includes("\\") && normalize(path) === path && relative(".", path) === path && path !== ".." && !path.startsWith(`..${sep}`);
}

function validateGates(value: unknown, label: string, context: V1ExitContext, errors: string[]): void {
  const gates = stringArray(value, `${label} gates`, errors);
  const seen = new Set<string>();
  for (const gate of gates) {
    if (seen.has(gate)) errors.push(`V1 exit ${label} duplicate gate: ${gate}`);
    seen.add(gate);
    if (!Object.hasOwn(context.scripts, gate)) errors.push(`V1 exit ${label} unknown gate: ${gate}`);
    if (!context.rootCheck.includes(`pnpm ${gate}`)) errors.push(`V1 exit ${label} gate is outside root check: ${gate}`);
  }
}

export function validateV1ExitDocument(document: unknown, context: V1ExitContext): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(document)) return ["V1 exit qualification must be an object"];
  if (document["schemaVersion"] !== 1) errors.push("V1 exit schemaVersion must be 1");
  if (document["milestone"] !== "V1") errors.push("V1 exit milestone must be V1");
  if (document["status"] !== "qualified-private") errors.push("V1 exit status must be qualified-private");
  if (document["canonicalApplication"] !== "examples/v1-app") errors.push("V1 exit canonical application must be examples/v1-app");

  const claims = document["claims"];
  if (!isRecord(claims)) errors.push("V1 exit claims must be an object");
  else {
    compareExact(new Set(Object.keys(claims)), new Set(claimKeys), "claim", errors);
    for (const key of claimKeys) if (claims[key] !== false) errors.push(`V1 exit unsupported claim must remain false: ${key}`);
  }

  const features = document["features"];
  const observedFeatures = new Set<string>();
  if (!Array.isArray(features)) errors.push("V1 exit features must be an array");
  else for (const [index, feature] of features.entries()) {
    if (!isRecord(feature) || typeof feature["id"] !== "string") {
      errors.push(`V1 exit feature ${index} must have an id`);
      continue;
    }
    const id = feature["id"];
    if (observedFeatures.has(id)) errors.push(`V1 exit duplicate feature: ${id}`);
    observedFeatures.add(id);
    validateGates(feature["gates"], `feature ${id}`, context, errors);
    const evidence = stringArray(feature["evidence"], `feature ${id} evidence`, errors);
    const seenEvidence = new Set<string>();
    for (const path of evidence) {
      if (seenEvidence.has(path)) errors.push(`V1 exit feature ${id} duplicate evidence: ${path}`);
      seenEvidence.add(path);
      if (!safeEvidencePath(path)) errors.push(`V1 exit feature ${id} unsafe evidence path: ${path}`);
      else if (!context.trackedEvidence.has(path)) errors.push(`V1 exit feature ${id} evidence is not tracked regular content: ${path}`);
    }
  }
  compareExact(observedFeatures, context.v1Features, "feature", errors);

  const audits = document["audits"];
  const observedAudits = new Set<string>();
  if (!Array.isArray(audits)) errors.push("V1 exit audits must be an array");
  else for (const [index, audit] of audits.entries()) {
    if (!isRecord(audit) || typeof audit["id"] !== "string") {
      errors.push(`V1 exit audit ${index} must have an id`);
      continue;
    }
    const id = audit["id"];
    if (observedAudits.has(id)) errors.push(`V1 exit duplicate audit: ${id}`);
    observedAudits.add(id);
    if (audit["outcome"] !== auditOutcomes[id]) errors.push(`V1 exit audit outcome mismatch: ${id}`);
    validateGates(audit["gates"], `audit ${id}`, context, errors);
    stringArray(audit["residual"], `audit ${id} residual`, errors);
  }
  compareExact(observedAudits, new Set(Object.keys(auditOutcomes)), "audit", errors);

  if (!context.packagePrivate || context.packageVersion !== "0.0.0-private" || context.packageHasPublishConfig) {
    errors.push("V1 exit requires the unpublished private package boundary");
  }
  if (!context.supportPolicy.includes("not yet published or supported for production use")) errors.push("V1 exit support policy lost the private boundary");
  if (!context.deferrals.includes("Supported editor product") || !context.deferrals.includes("Public analyzer schema")) {
    errors.push("V1 exit analyzer/editor deferrals are incomplete");
  }
  const access = Array.isArray(features) ? features.find((entry) => isRecord(entry) && entry["id"] === "ACCESS-01") : undefined;
  if (!isRecord(access) || !Array.isArray(access["evidence"]) || !access["evidence"].includes("examples/v1-app/expected/accessibility-baseline.json")) {
    errors.push("V1 exit accessibility baseline evidence is missing");
  }
  return errors;
}
