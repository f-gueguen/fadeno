import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

const V2_PLAN_OUTCOMES = Object.freeze({
  "V2-00": "Decompose browser enhancement from the verified public native baseline",
  "V2-01": "Resolve the experimental update protocol and scroll boundary before implementation",
  "V2-01A": "Decide the optional browser-entrypoint package boundary before implementation",
  "V2-02": "Establish one optional browser-runtime and server-update package boundary",
  "V2-03": "Generate server-owned update outcomes through existing route/render authorities",
  "V2-04": "Enhance link navigation under the accepted request and URL ownership contract",
  "V2-05": "Qualify history, focus, selection, and explicit scroll-boundary behavior",
  "V2-06": "Enhance form submission without changing successful controls or action authority",
  "V2-07": "Complete enhanced action redirects, revalidation, ordering, and recovery",
  "V2-08": "Implement bounded structural reconciliation for the accepted preservation classes",
  "V2-09": "Qualify the canonical application in native and enhanced modes",
  "V2-10": "Freeze the shipped-browser cost measurement contract",
  "V2-10A": "Harden the shipped browser path after qualification",
  "V2-10B": "Qualify enhanced accessibility against the current specification",
  "V2-10C": "Retain the final hardened browser cost result",
  "V2-11": "Complete V2 documentation, upgrade, rollback, and exit qualification",
  "V2-11A": "Decide later-alpha distribution-tag ownership before publication",
  "V2-11B": "Prepare version-aware release gates while preserving first-alpha evidence",
  "V2-12": "Mechanically release and verify the qualified V2 alpha",
} as const);

type V2PlanOutcomeId = keyof typeof V2_PLAN_OUTCOMES;

const V2_PLAN_ROWS_WITHOUT_OUTCOMES = Object.freeze([
  { id: "V2-00", features: ["GOV-01", "ENH-01", "PATCH-01", "TEST-01", "DOC-01"], dependencies: "A0-10, ADR 0014", artifacts: "Detailed V2 plan; current ledger; explicit DG-V2-01 ownership; aligned scope, traceability, risks, and project model", validation: "Documentation/model/ledger gates; `pnpm check:v2-plan`; `pnpm check`; `pnpm ci:local`" },
  { id: "V2-01", features: ["GOV-01", "ENH-01", "PATCH-01", "STATE-01", "SEC-01", "TEST-01"], dependencies: "DG-V2-01; V2-00; ADR 0014; V1 action round trip", artifacts: "Accepted patch-protocol ADR; versioned accepted/refused fixtures; identity, ordering, redirect, error, recovery, cache, limits, and compatibility decisions; resolved decision gate; explicit no-release-impact declaration", validation: "Decision/specification/model gates; fixture decoder mutations; three-engine scroll-boundary controls; `pnpm ci:local`" },
  { id: "V2-01A", features: ["GOV-01", "BUILD-01", "ENH-01", "SEC-01", "TEST-01"], dependencies: "V2-00; ADR 0024; demonstrated disposable packed consumer", artifacts: "Accepted browser-entrypoint package-boundary ADR; disposable packed consumer evidence; exact public subpath, dependency direction, loading, compatibility, and rollback decisions; explicit no-release-impact declaration", validation: "Decision/specification/model gates; packed consumer and public-export proof; private deep-import refusal; `pnpm ci:local`" },
  { id: "V2-02", features: ["WEB-02", "BUILD-01", "ENH-01", "PATCH-01", "SEC-01", "TEST-01"], dependencies: "V2-01, V2-01A", artifacts: "Explicit browser entrypoint; real-renderer nonce-owned CSP loading without policy weakening; update encoder/decoder; version, byte, depth, record-count, and duration limits; native fallback; clean packed consumer; patch-protocol threat-model update; malformed-input, negative authorization, cross-user isolation, safe-logging, failure, and rollback evidence; one pending Changeset with semantic version intent", validation: "Package/public-surface and Changeset checks; current-packed rendered-page execution under the real nonce policy; script-disabled and wrong/missing-nonce browser refusals; unchanged CSP ownership; malformed/cross-origin/version/byte/depth/count/time refusals; negative authorization and cross-user isolation; redacted logging; no executable strings; rollback; clean install; `pnpm check:v1-rendering-security`; `pnpm check:v1-renderer`; `pnpm ci:local`" },
  { id: "V2-03", features: ["WEB-01", "WEB-02", "DATA-01", "DATA-02", "ENH-01", "PATCH-01", "SEC-01"], dependencies: "V2-02", artifacts: "Navigation/action outcome projection; provenance; redirects and expected failures; no selector-command or second render policy; projection threat-model update; negative authorization and cross-user outcome/provenance isolation; safe redacted logging; rollback; one pending Changeset with semantic version intent", validation: "Native/update outcome equivalence; route/resource/action causal fixtures; integrated negative authorization and cross-user isolation; serialization round trips; redacted logging; rollback and stale-output recovery; Changeset checks; `pnpm ci:local`" },
  { id: "V2-04", features: ["ENH-01", "PATCH-01", "STATE-01", "TEST-01", "DOC-01"], dependencies: "V2-03", artifacts: "Link interception boundary; cancellable requests; protocol-selected ordering and duplicate handling; URL/title/history/focus application; explicit eligibility matrix retaining native activation for external, target, download, modifier-click, and same-document-fragment links; pre-reconciliation refusal for dirty controls, disclosure/top-layer state, media, selection/caret, mounted client-owned identity, and any boundary whose scroll or state cannot yet be preserved; one pending Changeset with semantic version intent", validation: "Packed link success/refusal/cancellation/permuted-order/recovery; pre-interception eligibility and preservation refusal before `preventDefault()`; native destination, browsing-context, download, modifier, and fragment fallback; back/forward smoke; public example; Changeset checks; `pnpm ci:local`" },
  { id: "V2-05", features: ["ENH-01", "PATCH-01", "STATE-01", "ACCESS-01", "TEST-01"], dependencies: "V2-04; ADR 0014", artifacts: "History traversal matrix; focus/selection rules; reduced-motion handling; document/element scroll management or refusal fixtures; one pending Changeset with semantic version intent", validation: "Chromium/Firefox/WebKit navigation corpus; keyboard/focus review; accepted scroll signature; native equivalence; Changeset checks; `pnpm ci:local`" },
  { id: "V2-06", features: ["DATA-02", "ENH-01", "PATCH-01", "STATE-01", "SEC-01", "TEST-01"], dependencies: "V2-03, V2-04", artifacts: "Form interception boundary; exact successful controls; GET forms retained as navigation without mutation authority; pending ownership; expected validation; uncertain-mutation refusal; pre-submit preservation eligibility and refusal before mutation authority; form-interception threat-model update; origin/CSRF, negative authorization, cross-user isolation, resource limits, safe logging, rollback, and teardown evidence; one pending Changeset with semantic version intent", validation: "Native/enhanced GET-form encoding, URL, history, and no-mutation-authority equivalence; native/enhanced mutation payload and outcome equivalence; integrated origin/CSRF, negative authorization, cross-user isolation, resource-limit, redacted-logging, and rollback checks; preservation refusal before interception; duplicate/replay/cancel/network failure; safe fallback and recovery; Changeset checks; `pnpm ci:local`" },
  { id: "V2-07", features: ["DATA-01", "DATA-02", "DATA-03", "ENH-01", "PATCH-01", "STATE-01"], dependencies: "V2-05, V2-06", artifacts: "Redirect and error outcomes; current-server-truth recovery; resource refresh; protocol-selected late-response handling; complete CRUD enhancement only for pre-reconciliation-safe boundaries; unsafe-boundary refusal before action interception; one pending Changeset with semantic version intent", validation: "Packed authenticated CRUD success/failure/correction/flow/recovery; permuted delayed duplicate responses; unsafe-boundary pre-interception refusal; no repeated mutation; Changeset checks; `pnpm ci:local`" },
  { id: "V2-08", features: ["PATCH-01", "STATE-01", "ACCESS-01", "TEST-01"], dependencies: "V2-05, V2-07; K0-04", artifacts: "Stable identity; declared replacement; dirty-control, disclosure/top-layer, media, focus, selection, caret, and future island preservation; scroll boundary enforcement; one pending Changeset with semantic version intent", validation: "Complete K0 corpus for navigation and action updates in three engines; ownership/refusal/recovery fixtures; Changeset checks; `pnpm ci:local`" },
  { id: "V2-09", features: ["ENH-01", "PATCH-01", "DATA-01", "DATA-02", "STATE-01", "SEC-01", "ACCESS-01", "TEST-01"], dependencies: "V2-07, V2-08", artifacts: "Three-engine canonical workflows; no-JavaScript baseline replay; interruption and recovery scenarios; normalized flow evidence; explicit no-release-impact declaration for qualification-only work", validation: "Public packed install; native/enhanced CRUD equivalence; history/focus/scroll/order/cancel/recovery; no-JavaScript regression; release-impact check; `pnpm ci:local`" },
  { id: "V2-10", features: ["PERF-01", "TEST-01", "DOC-01"], dependencies: "V2-09", artifacts: "Versioned cost-record schema and harness requiring exact candidate and frozen relative-baseline source, package, browser-artifact, dataset/corpus, hardware/environment, runtime/tool, and command identities; warmups, repetitions and paired schedule; candidate and baseline raw per-sample results; derived comparisons, conclusion, and limitations; no retained result; explicit no-release-impact declaration for contract-only work", validation: "Cost-record schema, paired schedule, candidate/baseline identity, raw-sample completeness, derived-comparison, and mutation checks; deterministic dry run without retained timing result; release-impact check; `pnpm ci:local`" },
  { id: "V2-10A", features: ["SEC-01", "TEST-01", "REL-01"], dependencies: "V2-09, V2-10", artifacts: "Additive decoder/threat hardening; leak/cleanup evidence; rollback; one pending Changeset with semantic version intent", validation: "Additive fuzz/security gates; repeated navigation/action cleanup; rollback; Changeset checks; `pnpm ci:local`" },
  { id: "V2-10B", features: ["ACCESS-01", "TEST-01", "DOC-01"], dependencies: "V2-09, V2-10A", artifacts: "Keyboard, focus, reduced-motion, and preservation evidence; enhanced-form pending-state announcement and field/form validation-error association evidence; retained V2 screen-reader review; manual accessibility boundaries; explicit unsupported claims; explicit no-release-impact declaration for qualification-only work", validation: "Chromium/Firefox/WebKit accessibility checks; screen-reader review record and refusal boundaries; pending feedback and validation-error association regressions; keyboard/focus/preference regression; release-impact check; `pnpm ci:local`" },
  { id: "V2-10C", features: ["PERF-01", "TEST-01", "DOC-01"], dependencies: "V2-10, V2-10A", artifacts: "Immutable result over the post-hardening browser path and frozen relative baseline; exact candidate and baseline source, package, browser-artifact, environment, command, and paired-schedule identities; complete candidate and baseline raw samples; derived comparisons, conclusion, and limitations; explicit no-release-impact declaration for result-only work", validation: "Independent candidate/baseline source, package, browser-artifact, and environment identity verification; exact paired-command replay over every retained raw sample; derived-comparison, conclusion, and limitation checks; no-retry completeness and mutation checks; release-impact check; `pnpm ci:local`" },
  { id: "V2-11", features: ["BUILD-01", "CLI-01", "DOC-01", "REL-01", "TEST-01"], dependencies: "V2-09, V2-10, V2-10A, V2-10B, V2-10C", artifacts: "Generated guides/API reference; executable success/failure/correction/flow/recovery examples; migration and rollback fixtures; exit manifest; unchanged measured browser-artifact digest; explicit no-release-impact declaration; any package-behavior change returns to V2-10A and V2-10C", validation: "Clean public install/build/test/dev/start/deploy; documentation/source checks; package/reproducibility/rollback; exact measured-browser-artifact identity; release-impact check; `pnpm check`; `pnpm ci:local`" },
  { id: "V2-11A", features: ["GOV-01", "REL-01", "SEC-01", "TEST-01"], dependencies: "V2-11; ADR 0038; ADR 0044", artifacts: "Accepted later-alpha alias-policy ADR; exact alpha and latest ownership, advancement, refusal, rollback, and verification decisions; explicit no-release-impact declaration", validation: "Decision/release-policy/model gates; alias advancement and independent-movement mutation fixtures; rollback and refusal checks; `pnpm ci:local`" },
  { id: "V2-11B", features: ["GOV-01", "BUILD-01", "REL-01", "TEST-01"], dependencies: "V2-11; ADR 0038; immutable A0 evidence", artifacts: "Version-aware current-release gates separated from immutable first-alpha constants and evidence; historical alpha.1 checks remain byte- and identity-exact; later-version fixtures, migration, refusal, rollback, and mutation coverage; explicit no-release-impact declaration", validation: "Current-versus-historical identity mutations; unchanged `pnpm check:a0-alpha-qualification` and `pnpm check:a0-public-release`; simulated later-version canonical check and release-source qualification; rollback; `pnpm ci:local`" },
  { id: "V2-12", features: ["BUILD-01", "CLI-01", "DOC-01", "REL-01", "TEST-01"], dependencies: "V2-11A, V2-11B", artifacts: "Consumed reviewed Changesets; advanced alpha prerelease version through version-aware current gates; generated changelog, SBOM, documentation archive, and receipt; unchanged immutable first-alpha evidence; unchanged measured browser-artifact digest; immutable source tag and release; trusted publication; exact accepted distribution aliases; exact registry/provenance/package/documentation identity; retained refusal, correction, rollback, and stale-diagnostic recovery", validation: "Clean version-aware release-source qualification while immutable alpha.1 gates remain exact; deterministic package/documentation rebuild; exact released-browser-artifact match to V2-10C; accepted alias-policy validation; release-event verification; trusted publication; exact tag/release/registry/provenance replay; public create/test/check/build/dev/start/deploy/rollback; `pnpm check`; `pnpm ci:local`" },
] as const);

export const V2_PLAN_ROWS = Object.freeze(V2_PLAN_ROWS_WITHOUT_OUTCOMES.map((row) => Object.freeze({
  ...row,
  outcome: V2_PLAN_OUTCOMES[row.id as V2PlanOutcomeId],
})));

export type V2PlanContext = Readonly<{
  roadmap: string;
  outcomeRoadmap: string;
  readme: string;
  decisionGates: string;
  scope: string;
  traceability: string;
  risks: string;
  ledger: string;
  packageDocument: unknown;
  tracked: ReadonlySet<string>;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadV2PlanContext(root: string, tracked: ReadonlySet<string>): V2PlanContext {
  const read = (path: string): string => readFileSync(join(root, path), "utf8");
  return Object.freeze({
    roadmap: read("docs/roadmap/v2.md"),
    outcomeRoadmap: read("docs/roadmap.md"),
    readme: read("README.md"),
    decisionGates: read("docs/ledgers/decision-gates.md"),
    scope: read("docs/product/scope.md"),
    traceability: read("docs/traceability.md"),
    risks: read("docs/ledgers/risks.md"),
    ledger: read("ROADMAP_LEDGER.md"),
    packageDocument: JSON.parse(read("packages/framework/package.json")) as unknown,
    tracked,
  });
}

export function validateV2Plan(context: V2PlanContext): readonly string[] {
  const errors: string[] = [];
  for (const path of [
    "docs/roadmap/v2.md",
    "scripts/check-v2-plan.ts",
    "scripts/lib/v2-plan.ts",
    "scripts/test-v2-plan.ts",
  ]) if (!context.tracked.has(path)) errors.push(`V2 plan artifact is not tracked: ${path}`);

  const rows = context.roadmap
    .split("\n")
    .filter((line) => /^\| V2-\d{2}[A-Z]? \|/u.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const ids = rows.map((row) => row[0]);
  const expectedIds = V2_PLAN_ROWS.map((row) => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) errors.push("V2 roadmap slices must be exactly V2-00, V2-01, V2-01A, V2-02 through V2-10, V2-10A, V2-10B, V2-10C, V2-11, V2-11A, V2-11B, then V2-12 in order");

  for (const [index, row] of rows.entries()) {
    const id = row[0] ?? expectedIds[index] ?? "V2-unknown";
    const expected = V2_PLAN_ROWS[index];
    if (row.length !== 6) {
      errors.push(`V2 roadmap ${id} must have exactly 6 columns`);
      continue;
    }
    if (!expected) continue;
    if (row[1] !== expected.outcome) errors.push(`V2 roadmap ${id} outcome contract mismatch`);
    if (row[2] !== expected.features.join(", ")) errors.push(`V2 roadmap ${id} feature contract mismatch`);
    if (row[3] !== expected.dependencies) errors.push(`V2 roadmap ${id} dependency contract mismatch`);
    if (row[4] !== expected.artifacts) errors.push(`V2 roadmap ${id} artifact contract mismatch`);
    if (row[5] !== expected.validation) errors.push(`V2 roadmap ${id} validation contract mismatch`);
    const gates = [...`${row[1]} ${row[3]} ${row[4]}`.matchAll(/\bDG-V2-\d{2}\b/gu)].map((match) => match[0]);
    const expectedGates = id === "V2-00" || id === "V2-01" ? ["DG-V2-01"] : [];
    if (JSON.stringify(gates) !== JSON.stringify(expectedGates)) {
      errors.push(`V2 roadmap ${id} decision ownership mismatch`);
    }
  }

  const roadmap = context.roadmap.replace(/\s+/gu, " ");
  for (const fragment of [
    "optional browser delivery path",
    "same server-owned application outcome",
    "DG-V2-01 remains open",
    "Native links and forms remain the correctness baseline",
    "Islands remain V3",
    "Every user-observable slice extends the canonical application",
    "success, deliberate failure or refusal",
    "ownership/causal flow inspection",
  ]) if (!roadmap.includes(fragment)) errors.push(`V2 roadmap is missing ${fragment}`);

  const gateRow = context.decisionGates.split("\n").find((line) => line.startsWith("| DG-V2-01 |")) ?? "";
  for (const fragment of ["ENH-01 implementation", "scroll boundary", "ordering", "recovery", "version negotiation", "Open"]) {
    if (!gateRow.includes(fragment)) errors.push(`DG-V2-01 is missing ${fragment}`);
  }
  for (const fragment of ["completed [detailed A0 plan](roadmap/a0.md)", "current [detailed V2 plan](roadmap/v2.md)", "Status: complete through A0-10"]) {
    if (!context.outcomeRoadmap.includes(fragment)) errors.push(`outcome roadmap handoff is missing ${fragment}`);
  }
  for (const fragment of ["completed its qualified private V1 and public A0", "current V2 plan", "[current V2 plan](docs/roadmap/v2.md)"]) {
    if (!context.readme.includes(fragment)) errors.push(`README handoff is missing ${fragment}`);
  }
  if (!context.ledger.includes("V2-00 — decompose browser enhancement")
    || !context.ledger.includes("A0-10 — Merge commit `60d55c7`")
    || !context.ledger.includes("No V2 implementation may begin before DG-V2-01")) {
    errors.push("V2 roadmap ledger state drifted");
  }

  for (const feature of ["ENH-01", "PATCH-01"]) {
    const scope = context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    const trace = context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
    if (!scope.includes("V2 plan") || !scope.includes("DG-V2-01")) errors.push(`${feature} scope is missing V2-00 ownership`);
    if (!trace.includes("V2 plan") || !trace.includes("DG-V2-01")) errors.push(`${feature} traceability is missing V2-00 ownership`);
  }
  const v2Features = [...new Set(V2_PLAN_ROWS.flatMap((row) => row.features))];
  for (const feature of v2Features) {
    const scope = (context.scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "")
      .slice(1, -1).split("|").map((cell) => cell.trim());
    const trace = (context.traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "")
      .slice(1, -1).split("|").map((cell) => cell.trim());
    if (!(scope[2] ?? "").split("/").includes("V2")) errors.push(`${feature} scope is missing V2 ownership`);
    if (!(trace[4] ?? "").split("/").includes("V2") || !(trace[2] ?? "").includes("[V2 plan]")) {
      errors.push(`${feature} traceability is missing V2 ownership`);
    }
  }
  const risk = context.risks.split("\n").find((line) => line.startsWith("| Browser updates destroy user state")) ?? "";
  if (!risk.includes("V2-00") || !risk.includes("DG-V2-01")) errors.push("V2 browser-state risk is missing plan ownership");

  const packageDocument = context.packageDocument;
  if (!isRecord(packageDocument)
    || packageDocument["name"] !== "@fadeno/framework"
    || packageDocument["version"] !== "0.1.0-alpha.1"
    || Object.hasOwn(packageDocument, "private")) errors.push("V2 entry package identity drifted");
  return Object.freeze(errors);
}
