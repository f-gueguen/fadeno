import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const tracked = new Set(execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).trim().split("\n"));

for (const path of [
  "docs/adr/0052-enhanced-action-outcome-ordering.md",
  ".changeset/enhanced-action-ordering.md",
  "scripts/check-v2-action-ordering.ts",
  "examples/v1-app/scenarios/form-submission/expected/crud.json",
  "examples/v1-app/scenarios/form-submission/expected/native-crud.json",
  "examples/v1-app/scenarios/form-submission/expected/ordering.json",
  "examples/v1-app/scenarios/form-submission/expected/ordering-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/terminal-flow.json",
  "examples/v1-app/scenarios/form-submission/expected/duplicate.json",
  "examples/v1-app/scenarios/form-submission/expected/duplicate-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/concurrency.json",
  "examples/v1-app/scenarios/form-submission/expected/concurrency-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/close-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/staged-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/supersession-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/supersession-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption.json",
  "examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption-human.txt",
]) assert.equal(tracked.has(path), true, `V2-07 artifact is not tracked: ${path}`);

const adr = read("docs/adr/0052-enhanced-action-outcome-ordering.md").replace(/\s+/gu, " ");
for (const fragment of [
  "Status: Accepted",
  "existing page/resource owners",
  "consumes the mutation result ID",
  "fresh opaque ID and monotonically newer sequence",
  "never submits POST again",
  "Duplicate, stale, delayed, permuted, cancelled, superseded",
  "public protocol",
  "V2-08",
  "`pnpm check:v2-action-ordering`",
]) assert.equal(adr.includes(fragment), true, `ADR 0052 is missing ${fragment}`);

assert.equal(
  read(".changeset/enhanced-action-ordering.md"),
  '---\n"@fadeno/framework": minor\n---\n\nComplete enhanced action redirects through a fresh cancellable GET while\npreserving server revalidation, stale-result suppression, and non-repeating\nmutation recovery.\n',
);

const scope = read("docs/product/scope.md");
const traceability = read("docs/traceability.md");
for (const feature of ["DATA-01", "DATA-02", "DATA-03", "ENH-01", "PATCH-01", "STATE-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0052"), true, `${feature} scope is missing ADR 0052`);
  assert.equal(traceabilityRow.includes("ADR 0052") && traceabilityRow.includes("check:v2-action-ordering"), true, `${feature} traceability is missing V2-07 evidence`);
}

const risks = read("docs/ledgers/risks.md");
assert.equal(risks.includes("ADR 0052 consumes mutation and redirect-GET results independently"), true);
assert.equal(risks.includes("redirect GET reuses mutation identity or an admitted result"), true);
assert.equal(risks.includes("fails to recover when native activation is prevented"), true);

const browser = read("packages/framework/src/internal/browser-navigation.ts");
for (const fragment of [
  '"enhanced-redirect"',
  "consumeResultId(admission.resultId)",
  "if (active === operation) active = undefined",
  "a fresh cancellable GET operation acquired the redirect destination",
  "await navigate(",
  "recoverCancelledMutation",
  "native post-selection mutation recovery was cancelled",
  "&& !recoverCancelledMutation",
  "privateFormHandoffPreservationCheck",
  "inheritedMutationRecovery",
  "fallbackSameResourceFragmentRedirect",
  "samePrivateFormHandoffFiles",
  "observeCancelledDeparture",
  "privateReloadFragmentDestination",
]) assert.equal(browser.includes(fragment), true, `browser action ordering is missing ${fragment}`);
assert.equal(
  browser.includes('repairDisplayedTruth(\n                  recovery.truthUrl')
    && browser.indexOf('repairDisplayedTruth(\n                  recovery.truthUrl') < browser.indexOf("recovery.recoverCancelledMutation();"),
  true,
  "staged mutation recovery must repair displayed truth before requesting current truth",
);

const navigationSpecification = read("docs/spec/navigation-patching-preservation.md").replace(/\s+/gu, " ");
for (const fragment of [
  "first consumes the mutation result",
  "fresh cancellable GET",
  "newer eligible navigation supersedes that GET",
  "cancelled native departure reloads committed current truth",
  "activation stays in the document",
  "history staging fails",
]) assert.equal(navigationSpecification.includes(fragment), true, `navigation specification is missing ${fragment}`);

const application = read("examples/v1-app/scenarios/form-submission/application.ts");
for (const fragment of ["createProject", "updateProject", "deleteProject", "projectPageRenders", 'id: "update-form"', 'id: "delete-form"']) {
  assert.equal(application.includes(fragment), true, `authenticated CRUD example is missing ${fragment}`);
}
assert.equal(application.includes("update-form-${"), false, "update action identity must not depend on a mutable list ordinal");
assert.equal(application.match(/duplicateProjectTitle\(\)/gu)?.length, 3, "create must recheck title identity at the mutation point");

const tests = read("experiments/v2-form-submission/tests/form-submission.spec.ts");
for (const fragment of [
  "authenticated create, read, update, and delete",
  "duplicate project identities before delete ownership becomes ambiguous",
  "serializes concurrent duplicate project creation at the mutation point",
  "delayed redirect result after newer enhanced navigation wins",
  "terminal redirect handoff",
  "close is cancelled during the redirect GET",
  "staged redirect URL before cancelled replacement recovery",
  "form edits made after redirect handoff",
  "newer GET supersedes the redirect",
  "native activation supersedes the redirect",
  "native activation has no document departure",
  "same-metadata file replacement",
  "same-resource fragment redirects",
  "redirect GET result before following its redirect chain",
  "authenticated CRUD through native documents without JavaScript",
]) assert.equal(tests.includes(fragment), true, `V2-07 browser evidence is missing ${fragment}`);

const ordering = read("examples/v1-app/scenarios/form-submission/expected/ordering.json");
for (const fragment of ['"supersedingGets": 1', '"supersedingNativeGets": 0']) {
  assert.equal(ordering.includes(fragment), true, `enhanced supersession evidence is missing ${fragment}`);
}
const terminalFlow = read("examples/v1-app/scenarios/form-submission/expected/terminal-flow.json");
for (const fragment of ['"failedRedirectRecoveryRequests": 2', '"failedRedirectRecoveryRecorded": true']) {
  assert.equal(terminalFlow.includes(fragment), true, `redirect recovery evidence is missing ${fragment}`);
}
for (const [path, fragment] of [
  ["examples/v1-app/scenarios/form-submission/expected/concurrency.json", '"oneLogicalOwnerCreated": true'],
  ["examples/v1-app/scenarios/form-submission/expected/close-recovery.json", '"currentTruthVisible": true'],
  ["examples/v1-app/scenarios/form-submission/expected/staged-recovery.json", '"recoveryRecorded": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery.json", '"submittedDocumentNotPublishedOverNewerEdit": true'],
  ["examples/v1-app/scenarios/form-submission/expected/supersession-recovery.json", '"currentTruthVisible": true'],
  ["examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery.json", '"nativeSupersedingGets": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"redirectAndRecoveryGets": 2'],
  ["examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery.json", '"newerFileSelectionNotPrivatelyOverwritten": true'],
  ["examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json", '"privateRedirectGets": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption.json", '"duplicateResultRefused": true'],
] as const) assert.equal(read(path).includes(fragment), true, `${path} is missing ${fragment}`);
assert.equal(
  read("examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json").includes('"historyFailureHandoff"'),
  true,
  "fragment redirect evidence must retain the selected destination when history staging fails",
);

const packageDocument = JSON.parse(read("package.json")) as Readonly<{ scripts?: Readonly<Record<string, string>> }>;
assert.equal(packageDocument.scripts?.["check:v2-action-ordering"]?.includes("pnpm check:v2-form-submission"), true);
assert.equal(packageDocument.scripts?.["check:v2-action-ordering"]?.includes("--grep"), false);
assert.equal(packageDocument.scripts?.["check"]?.includes("pnpm check:v2-action-ordering"), true);

const documentationSource = read("examples/v1-app/documentation-source.json");
for (const fragment of [
  '"check:v2-action-ordering"',
  '"scenarios/form-submission/expected/crud.json"',
  '"scenarios/form-submission/expected/native-crud.json"',
  '"scenarios/form-submission/expected/ordering.json"',
  '"scenarios/form-submission/expected/ordering-human.txt"',
  '"scenarios/form-submission/expected/duplicate.json"',
  '"scenarios/form-submission/expected/duplicate-human.txt"',
  '"scenarios/form-submission/expected/concurrency.json"',
  '"scenarios/form-submission/expected/concurrency-human.txt"',
  '"scenarios/form-submission/expected/close-recovery.json"',
  '"scenarios/form-submission/expected/staged-recovery.json"',
  '"scenarios/form-submission/expected/handoff-edit-recovery.json"',
  '"scenarios/form-submission/expected/handoff-edit-recovery-human.txt"',
  '"scenarios/form-submission/expected/supersession-recovery.json"',
  '"scenarios/form-submission/expected/supersession-recovery-human.txt"',
  '"scenarios/form-submission/expected/native-supersession-recovery.json"',
  '"scenarios/form-submission/expected/native-supersession-recovery-human.txt"',
  '"scenarios/form-submission/expected/native-no-departure-recovery.json"',
  '"scenarios/form-submission/expected/native-no-departure-recovery-human.txt"',
  '"scenarios/form-submission/expected/file-handoff-recovery.json"',
  '"scenarios/form-submission/expected/file-handoff-recovery-human.txt"',
  '"scenarios/form-submission/expected/fragment-redirect.json"',
  '"scenarios/form-submission/expected/fragment-redirect-human.txt"',
  '"scenarios/form-submission/expected/redirect-get-consumption.json"',
  '"scenarios/form-submission/expected/redirect-get-consumption-human.txt"',
]) assert.equal(documentationSource.includes(fragment), true, `documentation source is missing ${fragment}`);

console.log("V2-07 action ordering contract passed (redirect GET handoff, authenticated CRUD, stale suppression, and native recovery)");
