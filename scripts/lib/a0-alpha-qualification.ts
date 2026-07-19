import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { A0_FIRST_ALPHA_VERSION } from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export type A0AlphaQualificationContext = Readonly<{
  document: unknown;
  scripts: Readonly<Record<string, string>>;
  rootGates: ReadonlySet<string>;
  trackedEvidence: ReadonlySet<string>;
  workspace: unknown;
  packageManifest: unknown;
  packageReadme: string;
  rootReadme: string;
  support: string;
  securityRequirements: string;
  actionThreatModel: string;
  alphaThreatReview: string;
  migrationIndex: string;
  migrationGuide: string;
  buildSpecification: string;
  releasePolicy: string;
  scope: string;
  traceability: string;
  roadmap: string;
  ledger: string;
  changeset: string;
}>;

const claimContract = Object.freeze({
  alphaCandidateQualified: true,
  packagePublished: false,
  productionSupported: false,
  independentNewcomerUsability: false,
  assistiveTechnologyUsability: false,
  supportedEditorProduct: false,
  publicAnalyzerSchema: false,
  incrementalPerformanceBound: false,
  independentStableSecurityReview: false,
});

const auditContract = Object.freeze([
  Object.freeze({
    id: "security",
    outcome: "qualified-first-alpha-boundaries",
    gates: Object.freeze([
      "check:a0-decoder-fuzz",
      "check:v1-toolchain",
      "check:a0-create",
      "check:a0-deploy",
      "check:v1-routing",
      "check:v1-analyzer-workflow",
      "check:v1-adapter",
      "check:v1-action-session-decision",
      "check:v1-action-runtime",
      "check:v1-rendering-security",
      "check:v1-renderer",
      "check:v1-running-example",
      "check:v1-resource-decision",
      "check:v1-resources",
      "check:v1-independent-workflow",
      "check:a0-release",
    ]),
    evidence: Object.freeze([
      "docs/security/alpha-threat-review.md",
      "evidence/a0/security/decoder-fuzz.json",
      "examples/v1-app/scenarios/action-lifecycle/expected/diagnostic.json",
      "examples/v1-app/scenarios/deployment/expected/flow.json",
    ]),
    residual: Object.freeze([
      "single-process-action-and-session-owner",
      "independent-security-review-before-stable-release",
    ]),
  }),
  Object.freeze({
    id: "accessibility",
    outcome: "qualified-native-baseline",
    gates: Object.freeze(["check:v1-running-example", "check:a0-css"]),
    evidence: Object.freeze([
      "examples/v1-app/expected/accessibility-baseline.json",
      "examples/v1-app/src/styles.ts",
    ]),
    residual: Object.freeze(["independent-newcomer-and-assistive-technology-usability-unqualified"]),
  }),
  Object.freeze({
    id: "performance",
    outcome: "qualified-existing-evidence-only",
    gates: Object.freeze(["check:type-spine-qualification-evidence", "check:revalidation-qualification-evidence", "check:v1-analyzer-feedback"]),
    evidence: Object.freeze([
      "experiments/type-spine/results/20260712T022123Z-122ba57-a1/decision.json",
      "experiments/revalidation/results/qualification-result.json",
      "evidence/v1-analyzer-feedback/results/20260717T090059Z-4d57a69-a4/summary.json",
    ]),
    residual: Object.freeze([
      "incremental-generation-result-remains-narrow",
      "analyzer-feedback-result-has-no-accepted-budget",
      "server-and-browser-budgets-remain-later",
    ]),
  }),
  Object.freeze({
    id: "package",
    outcome: "qualified-current-packed-seed",
    gates: Object.freeze(["check:a0-publication", "check:a0-release", "check:v1-analyzer-package"]),
    evidence: Object.freeze([
      "packages/framework/package.json",
      "packages/framework/README.md",
      "packages/framework/sbom.spdx.json",
      "evidence/a0/release/first-alpha-plan.json",
    ]),
    residual: Object.freeze(["registry-publication-remains-a0-10"]),
  }),
  Object.freeze({
    id: "documentation",
    outcome: "qualified-executable-authority",
    gates: Object.freeze(["check:docs", "check:v1-documentation-source", "check:v1-documentation"]),
    evidence: Object.freeze([
      "README.md",
      "docs/migrations/first-alpha-candidate.md",
      "examples/v1-app/documentation-source.json",
      "examples/v1-app/expected/independent-workflow.txt",
    ]),
    residual: Object.freeze(["immutable-release-documentation-remains-a0-10"]),
  }),
  Object.freeze({
    id: "clean-machine",
    outcome: "qualified-automated-packed-workflows",
    gates: Object.freeze(["check:v1-independent-workflow", "check:a0-create", "check:a0-test", "check:a0-deploy"]),
    evidence: Object.freeze([
      "examples/v1-app/expected/independent-workflow.txt",
      "examples/v1-app/scenarios/application-test/expected/flow.json",
      "examples/v1-app/scenarios/deployment/expected/flow.json",
      "examples/v1-app/scenarios/deployment/expected/recovery.json",
    ]),
    residual: Object.freeze(["automated-consumers-do-not-establish-newcomer-usability"]),
  }),
  Object.freeze({
    id: "reproducibility",
    outcome: "qualified-identical-current-source",
    gates: Object.freeze(["check:v1-independent-workflow", "check:v1-development", "check:a0-release", "check:a0-deploy"]),
    evidence: Object.freeze([
      "examples/v1-app/expected/build-manifest-normalized.json",
      "examples/v1-app/scenarios/deployment/expected/artifact.json",
      "packages/framework/sbom.spdx.json",
    ]),
    residual: Object.freeze(["public-registry-bytes-and-tag-identity-remain-a0-10"]),
  }),
  Object.freeze({
    id: "rollback",
    outcome: "qualified-prepublication-and-deployment",
    gates: Object.freeze(["check:a0-release", "check:a0-deploy", "check:v1-development"]),
    evidence: Object.freeze([
      "evidence/a0/release/rollback-public-seed.json",
      "evidence/a0/release/recovery.json",
      "examples/v1-app/scenarios/deployment/expected/recovery.json",
      "examples/v1-app/scenarios/development-lifecycle/expected/recovery.json",
    ]),
    residual: Object.freeze(["published-versions-and-tags-are-never-replaced"]),
  }),
  Object.freeze({
    id: "usability-tooling",
    outcome: "deferred-unqualified",
    gates: Object.freeze(["check:a0-usability-contract", "check:a0-usability-replay-contract", "check:a0-usability-artifact", "check:a0-tooling-deferral"]),
    evidence: Object.freeze([
      "docs/adr/0043-defer-independent-usability-and-external-tooling.md",
      "evidence/a0/independent-usability/task-packet.json",
      "SUPPORT.md",
    ]),
    residual: Object.freeze([
      "independent-newcomer-usability-unqualified",
      "assistive-technology-usability-unqualified",
      "no-editor-product-or-public-analyzer-schema",
    ]),
  }),
] as const);

const requiredPaths = Object.freeze([
  ".changeset/quiet-boundaries-refuse.md",
  "docs/migrations/first-alpha-candidate.md",
  "docs/security/alpha-threat-review.md",
  "evidence/a0/qualification/alpha-candidate.json",
  "evidence/a0/security/decoder-fuzz.json",
  "scripts/check-a0-alpha-qualification.ts",
  "scripts/check-a0-decoder-fuzz.ts",
  "scripts/lib/a0-alpha-qualification.ts",
  "scripts/lib/a0-decoder-fuzz.ts",
  "scripts/run-a0-decoder-fuzz.ts",
  "scripts/test-a0-alpha-qualification.ts",
  "scripts/test-a0-decoder-fuzz.ts",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function includesProse(content: string, fragment: string): boolean {
  return content.replace(/\s+/gu, " ").includes(fragment);
}

function row(content: string, prefix: string): string {
  return content.split("\n").find((line) => line.startsWith(prefix)) ?? "";
}

function safeEvidencePath(path: string): boolean {
  return !isAbsolute(path)
    && !path.includes("\\")
    && normalize(path) === path
    && relative(".", path) === path
    && path !== ".."
    && !path.startsWith(`..${sep}`);
}

export function trackedA0QualificationFiles(root: string): ReadonlySet<string> {
  const output = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  return new Set(output.split("\0").filter(Boolean));
}

export function loadA0AlphaQualificationContext(
  root: string,
  tracked: ReadonlySet<string>,
): A0AlphaQualificationContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  const workspace = JSON.parse(read("package.json")) as unknown;
  const scriptsValue = isRecord(workspace) && isRecord(workspace["scripts"]) ? workspace["scripts"] : {};
  const scripts = Object.fromEntries(Object.entries(scriptsValue).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const rootGates = new Set((scripts["check"] ?? "").split("&&").flatMap((command) => {
    const match = /^pnpm ([^ ]+)$/u.exec(command.trim());
    return match?.[1] ? [match[1]] : [];
  }));
  const trackedEvidence = new Set<string>();
  const canonicalRoot = realpathSync(root);
  for (const path of tracked) {
    try {
      const absolute = join(root, path);
      const canonical = realpathSync(absolute);
      if (lstatSync(absolute).isFile() && (canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${sep}`))) {
        trackedEvidence.add(path);
      }
    } catch { /* missing or non-canonical paths cannot qualify evidence */ }
  }
  return Object.freeze({
    document: JSON.parse(read("evidence/a0/qualification/alpha-candidate.json")) as unknown,
    scripts: Object.freeze(scripts),
    rootGates,
    trackedEvidence,
    workspace,
    packageManifest: JSON.parse(read("packages/framework/package.json")) as unknown,
    packageReadme: read("packages/framework/README.md"),
    rootReadme: read("README.md"),
    support: read("SUPPORT.md"),
    securityRequirements: read("docs/security/requirements.md"),
    actionThreatModel: read("docs/security/action-session-threat-model.md"),
    alphaThreatReview: read("docs/security/alpha-threat-review.md"),
    migrationIndex: read("docs/migrations/README.md"),
    migrationGuide: read("docs/migrations/first-alpha-candidate.md"),
    buildSpecification: read("docs/spec/build-adapters-testing.md"),
    releasePolicy: read("docs/release-policy.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    roadmap: read("docs/roadmap/a0.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    changeset: read(".changeset/quiet-boundaries-refuse.md"),
  });
}

export function validateA0AlphaQualification(context: A0AlphaQualificationContext): readonly string[] {
  const errors: string[] = [];
  for (const path of requiredPaths) {
    if (!context.trackedEvidence.has(path)) errors.push(`A0 alpha qualification evidence is not tracked: ${path}`);
  }

  const document = context.document;
  if (!isRecord(document)) return Object.freeze(["A0 alpha qualification must be an object"]);
  if (!exactKeys(document, [
    "schemaVersion", "milestone", "status", "package", "sourceVersion", "expectedReleaseVersion",
    "canonicalApplication", "publicationAttempted", "claims", "audits", "releaseImpact",
  ])) errors.push("A0 alpha qualification keys drifted");
  if (document["schemaVersion"] !== 1) errors.push("A0 alpha qualification schemaVersion must be 1");
  if (document["milestone"] !== "A0-09" || document["status"] !== "qualified-alpha-candidate") {
    errors.push("A0 alpha candidate status drifted");
  }
  if (
    document["package"] !== "@fadeno/framework"
    || document["sourceVersion"] !== "0.0.0"
    || document["expectedReleaseVersion"] !== "0.1.0-alpha.0"
    || document["canonicalApplication"] !== "examples/v1-app"
    || document["publicationAttempted"] !== false
  ) errors.push("A0 alpha package identity or publication boundary drifted");

  const claims = document["claims"];
  if (!isRecord(claims) || !exactKeys(claims, Object.keys(claimContract))) {
    errors.push("A0 alpha claims drifted");
  } else for (const [key, expected] of Object.entries(claimContract)) {
    if (claims[key] !== expected) errors.push(`A0 alpha unsupported claim drifted: ${key}`);
  }

  const audits = document["audits"];
  if (!Array.isArray(audits) || audits.length !== auditContract.length) {
    errors.push("A0 alpha audit set drifted");
  }
  for (const [index, expected] of auditContract.entries()) {
    const audit = Array.isArray(audits) ? audits[index] : undefined;
    if (!isRecord(audit)) {
      errors.push(`A0 alpha audit missing: ${expected.id}`);
      continue;
    }
    if (!exactKeys(audit, ["id", "outcome", "gates", "evidence", "residual"])) {
      errors.push(`A0 alpha audit keys drifted: ${expected.id}`);
    }
    if (audit["id"] !== expected.id || audit["outcome"] !== expected.outcome) {
      errors.push(`A0 alpha audit outcome drifted: ${expected.id}`);
    }
    if (JSON.stringify(audit["gates"]) !== JSON.stringify(expected.gates)) {
      errors.push(`A0 alpha audit gates drifted: ${expected.id}`);
    }
    if (JSON.stringify(audit["evidence"]) !== JSON.stringify(expected.evidence)) {
      errors.push(`A0 alpha audit evidence drifted: ${expected.id}`);
    }
    if (JSON.stringify(audit["residual"]) !== JSON.stringify(expected.residual)) {
      errors.push(`A0 alpha audit residual drifted: ${expected.id}`);
    }
    for (const gate of expected.gates) {
      if (!Object.hasOwn(context.scripts, gate)) errors.push(`A0 alpha audit gate is unknown: ${gate}`);
      if (!context.rootGates.has(gate)) errors.push(`A0 alpha audit gate is outside root check: ${gate}`);
    }
    const evidence = audit["evidence"];
    if (!Array.isArray(evidence) || evidence.length === 0) {
      errors.push(`A0 alpha audit evidence missing: ${expected.id}`);
    } else {
      const seen = new Set<string>();
      for (const path of evidence) {
        if (typeof path !== "string" || path.length === 0 || seen.has(path)) {
          errors.push(`A0 alpha audit evidence invalid: ${expected.id}`);
          continue;
        }
        seen.add(path);
        if (!safeEvidencePath(path)) errors.push(`A0 alpha audit evidence path is unsafe: ${path}`);
        else if (!context.trackedEvidence.has(path)) errors.push(`A0 alpha audit evidence is not tracked: ${path}`);
      }
    }
    const residual = audit["residual"];
    if (!Array.isArray(residual) || residual.length === 0 || residual.some((value) => typeof value !== "string" || value.length === 0)) {
      errors.push(`A0 alpha audit residual missing: ${expected.id}`);
    }
  }

  const releaseImpact = document["releaseImpact"];
  if (
    !isRecord(releaseImpact)
    || !exactKeys(releaseImpact, ["changeset", "intent", "outcome", "publicSurfaceAdded"])
    || releaseImpact["changeset"] !== ".changeset/quiet-boundaries-refuse.md"
    || releaseImpact["intent"] !== "patch"
    || releaseImpact["outcome"] !== "classify-malformed-configuration-environment-and-action-body-input"
    || releaseImpact["publicSurfaceAdded"] !== false
  ) errors.push("A0 alpha release impact drifted");
  if (!context.changeset.startsWith("---\n\"@fadeno/framework\": patch\n---\n")
    || !context.changeset.includes("FADENO_ACTION_BODY")) errors.push("A0 alpha Changeset drifted");

  const packageManifest = context.packageManifest;
  const exports = isRecord(packageManifest) ? packageManifest["exports"] : null;
  if (!isRecord(packageManifest) || packageManifest["version"] !== A0_FIRST_ALPHA_VERSION) {
    errors.push("A0 alpha qualification is not bound to the first-alpha release version");
  }
  if (!isRecord(exports) || Object.keys(exports).some((key) => /analy|editor|language|protocol/iu.test(key))) {
    errors.push("A0 alpha qualification introduced a public tooling surface");
  }

  for (const [name, content, fragments] of [
    ["alpha threat review", context.alphaThreatReview, ["2,360 cases", "fourteen", "FADENO_CONFIG_SYNTAX", "FADENO_ACTION_BODY", "No known critical or high-severity issue", "not the independent security review"]],
    ["security requirements", context.securityRequirements, ["pnpm check:a0-decoder-fuzz", "first-alpha threat review"]],
    ["action threat model", context.actionThreatModel, ["pnpm check:a0-decoder-fuzz", "FADENO_ACTION_BODY"]],
    ["migration index", context.migrationIndex, ["First-alpha candidate adoption guide", "not a released compatibility migration"]],
    ["migration guide", context.migrationGuide, ["No released Fadeno version", "pnpm check:a0-alpha-qualification", "Independent newcomer", "no supported editor product or public analyzer schema"]],
    ["build specification", context.buildSpecification, ["A0-09 alpha qualification", "pnpm check:a0-alpha-qualification", "qualified-alpha-candidate"]],
    ["release policy", context.releasePolicy, ["A0-09", "qualified-alpha-candidate", "does not publish"]],
    ["root README", context.rootReadme, ["qualified first-alpha candidate", "A0-10"]],
    ["package README", context.packageReadme, ["qualified first-alpha candidate", "Independent newcomer usability", "no editor product or public analyzer schema"]],
    ["support policy", context.support, ["mechanically qualified", "Independent newcomer usability", "not a supported protocol or public schema"]],
  ] as const) {
    for (const fragment of fragments) {
      if (!includesProse(content, fragment)) errors.push(`${name} is missing ${fragment}`);
    }
  }

  const roadmapRow = row(context.roadmap, "| A0-09 |");
  if (!roadmapRow.includes("check:a0-decoder-fuzz") || !roadmapRow.includes("check:a0-alpha-qualification")) {
    errors.push("A0-09 roadmap validation drifted");
  }
  for (const fragment of [
    "A0-09 — qualify the complete public-alpha candidate",
    "qualified-alpha-candidate",
    "A0-10 remains the only publication slice",
    "Independent newcomer usability remains deferred",
  ]) if (!includesProse(context.ledger, fragment)) errors.push(`A0-09 ledger is missing ${fragment}`);

  for (const feature of ["SEC-01", "ACCESS-01", "PERF-01", "TEST-01", "DOC-01", "REL-01"]) {
    if (!row(context.scope, `| ${feature} |`).includes("check:a0-alpha-qualification")) {
      errors.push(`${feature} scope is missing A0 alpha qualification`);
    }
    if (!row(context.traceability, `| ${feature} |`).includes("check:a0-alpha-qualification")) {
      errors.push(`${feature} traceability is missing A0 alpha qualification`);
    }
  }

  if (
    context.scripts["check:a0-alpha-qualification"]
      !== "node --no-warnings --experimental-strip-types scripts/check-a0-alpha-qualification.ts && node --no-warnings --experimental-strip-types scripts/test-a0-alpha-qualification.ts"
    || context.scripts["check:a0-decoder-fuzz"]
      !== "pnpm --filter @fadeno/framework build && node --no-warnings --experimental-strip-types scripts/check-a0-decoder-fuzz.ts && node --no-warnings --experimental-strip-types scripts/test-a0-decoder-fuzz.ts"
    || !context.rootGates.has("check:a0-alpha-qualification")
    || !context.rootGates.has("check:a0-decoder-fuzz")
  ) errors.push("workspace check does not enforce A0 alpha qualification");

  return Object.freeze(errors);
}
