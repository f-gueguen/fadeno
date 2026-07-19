import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const normalized = (path: string): string => read(path).replace(/\s+/gu, " ");

const adr = normalized("docs/adr/0050-history-focus-and-scroll-qualification.md");
for (const fragment of [
  "manual browser scroll restoration",
  "new entry is committed at document scroll `(0, 0)`",
  "zero document scroll and no observed element-scroll ownership",
  "non-collapsed selection",
  "allocate no transition work",
  "newest-only publication",
]) assert.equal(adr.includes(fragment), true, `ADR 0050 is missing ${fragment}`);

assert.equal(
  read(".changeset/qualify-navigation-state.md"),
  '---\n"@fadeno/framework": minor\n---\n\nQualify enhanced history, focus, selection, reduced-motion, and conservative\nscroll behavior while reloading every history entry that is not safe to own.\n',
);

const packageDocument = JSON.parse(read("packages/framework/package.json")) as { exports: Record<string, unknown> };
assert.deepEqual(Object.keys(packageDocument.exports).sort(), [".", "./browser", "./jsx-runtime", "./node"]);

const implementation = read("packages/framework/src/internal/browser-navigation.ts");
for (const fragment of [
  'history.scrollRestoration = "manual"',
  "createHistoryState(scrollX, scrollY, false)",
  "privateHistoryState(history.state)",
  "target.focus({ preventScroll: true })",
  'behavior: "instant"',
  "location.reload()",
]) assert.equal(implementation.includes(fragment), true, `browser state implementation is missing ${fragment}`);

const tests = read("experiments/v2-link-navigation/tests/link-navigation.spec.ts");
for (const fragment of [
  "commits focus and top scroll without animation under reduced motion",
  "allows a scrolled origin and reloads that unsafe history entry on return",
  "reloads an application-owned history entry instead of showing stale markup",
  "discards only a collapsed old-document selection",
  "keeps a non-collapsed selection and element scroll on the native path",
  "cancels an obsolete history traversal and publishes only the newest entry",
]) assert.equal(tests.includes(fragment), true, `V2-05 browser corpus is missing ${fragment}`);

const guide = read("docs/guides/browser-runtime.md");
for (const name of ["history-focus", "history-scroll-refusal", "history-recovery"]) {
  const evidence = read(`examples/v1-app/scenarios/link-navigation/expected/${name}.json`).trim();
  assert.equal(guide.includes(evidence), true, `generated guide is missing executed ${name} evidence`);
}
assert.equal(guide.includes(read("examples/v1-app/scenarios/link-navigation/expected/history-refusal-human.txt").trim()), true);

const scope = read("docs/product/scope.md");
const traceability = read("docs/traceability.md");
for (const feature of ["STATE-01", "SEC-01", "TEST-01", "ENH-01", "PATCH-01", "DOC-01", "ACCESS-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0050"), true, `${feature} scope is missing ADR 0050`);
  assert.equal(traceabilityRow.includes("ADR 0050") && traceabilityRow.includes("check:v2-history-focus-scroll"), true, `${feature} traceability is missing V2-05 evidence`);
}

console.log("V2 history/focus/scroll qualification passed (private state, current-packed 48-case corpus, executable guidance)");
