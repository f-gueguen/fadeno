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
assert.equal(risks.includes("ADR 0052 consumes the mutation result"), true);
assert.equal(risks.includes("redirect GET reuses mutation identity or publishes after supersession"), true);

const browser = read("packages/framework/src/internal/browser-navigation.ts");
for (const fragment of [
  'outcome: "enhanced-redirect"',
  "consumedResultIds.push(admission.resultId)",
  "if (active === operation) active = undefined",
  "a fresh cancellable GET operation acquired the redirect destination",
  "await navigate(",
  "recoverCancelledMutation",
]) assert.equal(browser.includes(fragment), true, `browser action ordering is missing ${fragment}`);

const navigationSpecification = read("docs/spec/navigation-patching-preservation.md");
for (const fragment of [
  "first consumes the mutation result",
  "fresh cancellable GET",
  "newer eligible navigation supersedes that GET",
  "cancelled native departure reloads committed current truth",
]) assert.equal(navigationSpecification.includes(fragment), true, `navigation specification is missing ${fragment}`);

const application = read("examples/v1-app/scenarios/form-submission/application.ts");
for (const fragment of ["createProject", "updateProject", "deleteProject", "projectPageRenders"]) {
  assert.equal(application.includes(fragment), true, `authenticated CRUD example is missing ${fragment}`);
}

const tests = read("experiments/v2-form-submission/tests/form-submission.spec.ts");
for (const fragment of [
  "authenticated create, read, update, and delete",
  "duplicate project identities before delete ownership becomes ambiguous",
  "delayed redirect result after newer enhanced navigation wins",
  "terminal redirect handoff",
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
]) assert.equal(documentationSource.includes(fragment), true, `documentation source is missing ${fragment}`);

console.log("V2-07 action ordering contract passed (redirect GET handoff, authenticated CRUD, stale suppression, and native recovery)");
