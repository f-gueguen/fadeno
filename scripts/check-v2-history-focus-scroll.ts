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
  "destination history entry is created before its viewport resets to document scroll `(0, 0)`",
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
  "history.scrollRestoration = previousScrollRestoration",
  "existingHistoryState !== null && !existingPrivateState",
  "unsafeHistoryEntries",
  "createPrivateUnsafeHistoryEntryTracker",
  "displayedHistoryEntry",
  "unsafeTraversalPersistence",
  "ownedHistoryEntries",
  "repeatedSelection",
  "pendingTraversalRecoveryDelayMs",
  "requestsUnloadConfirmation",
  "FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED",
  "Native activation superseded pending work",
  "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
  '"application-owned"',
  "consumeApplicationRecovery",
  "applicationRecoveryDocuments",
  "historyPushSequence",
  "maximumRecoveryUrlBytes",
  "selectedPushRecovery",
  "element === documentScroller",
  "historyWriteFailed = true",
  "initiator && !flushCurrentScroll(true)",
  "traversal === traversalSequence",
  "createHistoryState(scrollX, scrollY, elementScroll, historySession)",
  "privateHistoryState(history.state)",
  "target.focus({ preventScroll: true })",
  'behavior: "instant"',
  "location.reload()",
]) assert.equal(implementation.includes(fragment), true, `browser state implementation is missing ${fragment}`);

const tests = read("experiments/v2-link-navigation/tests/link-navigation.spec.ts");
for (const fragment of [
  "commits focus and top scroll without animation under ${motion} motion",
  "declines history ownership when secure identity generation is unavailable",
  "restores automatic scroll ownership when the runtime closes",
  "restores automatic scroll ownership when initial history acquisition fails",
  "refuses startup cleanly when History wrappers cannot be installed",
  "history-scroll-restoration-readback-refusal",
  "rekeys exact-shape startup state before claiming ownership",
  "rekeys private-looking state installed after close before restart",
  "restores automatic scroll ownership before native same-context departure",
  "allows a scrolled origin and reloads that unsafe history entry on return",
  "keeps an entry unsafe after returning to the top and restarting",
  "clears only the recovered unsafe entry after a zero-scroll current-truth reload",
  "runtimeRestarted",
  "coalesces history writes and keeps mutation-limit failure native",
  "reloads application-owned, foreign-session, and malformed history instead of showing stale markup",
  "discards only a collapsed old-document selection",
  "keeps a non-collapsed selection on the native path",
  "reloads an owned element-scrolled entry during traversal",
  "keeps a link native after recorded element scroll returns to zero",
  "retains element ownership when document scroll was already recorded",
  "refuses element-scroll ownership acquired while a request is pending",
  "marks an outgoing scroll before a same-task traversal",
  "records document scroll while traversal work is pending",
  "keeps delayed traversal recovery supersedable by a native click",
  "recovers the selected entry when closing a pending traversal",
  "repairs displayed truth when close recovery is cancelled",
  "aborts an ordinary pending navigation before close completes",
  "flushes late outgoing document scroll before commit",
  "cancels an obsolete history traversal and publishes only the newest entry",
  "keeps unsafe history tracking fail closed after its bound",
  "revalidates selected history ownership before traversal commit",
  "revalidates ordinary link source history before commit",
  "reloads cloned private-looking entries instead of granting ownership",
  "keeps same-URL copied history native before and after reload",
  "history-exact-application-recovery",
  "rekeys copied state before accepting a later repeated reload",
  "keeps bounded long-URL recovery persistence decodable",
  "recovers a selected destination without duplicating it when document commit fails",
  "preserves replacement recovery after focus mutates selected state",
  "rolls back every selected push before native recovery",
  "rolls back pushes made during traversal replacement before native recovery",
  "returns a focus-time runtime close to native destination recovery",
  "uses the source state written by a forced pre-interception scroll flush",
  "captures rollback focus from the precommit document snapshot",
  "repairs displayed truth when post-selection native recovery is cancelled",
  "reacquires history ownership when preselection fallback is cancelled",
  "preserves replacement recovery when destination scroll and rollback both fail",
  "refuses a commit when destination scroll does not reach the recorded top",
  "repairs displayed document truth when a traversal reload is cancelled",
  "repairs a returnValue-only cancelled traversal reload",
  "cancels a pending traversal before a newer click remains native",
  "cancels a pending traversal before a refused fragment remains native",
  "cancels an ordinary pending navigation before a native fragment activation",
  "cancels a pending traversal before a native form submission",
  "cancels an older traversal before a newer native recovery",
]) assert.equal(tests.includes(fragment), true, `V2-05 browser corpus is missing ${fragment}`);

const guide = read("docs/guides/browser-runtime.md");
for (const name of [
  "history-focus",
  "history-focus-normal",
  "history-environment-refusal",
  "history-teardown",
  "history-startup-recovery",
  "history-wrapper-installation-refusal",
  "history-scroll-restoration-readback-refusal",
  "history-startup-state-rekey",
  "history-post-close-restart-rekey",
  "history-native-departure",
  "history-scroll-refusal",
  "history-monotonic-scroll-recovery",
  "history-entry-recovery-resumption",
  "history-write-recovery",
  "history-overflow-recovery",
  "history-element-recovery",
  "history-element-link-refusal",
  "history-combined-scroll-refusal",
  "history-pending-element-scroll-refusal",
  "history-pending-scroll-recovery",
  "history-traversal-scroll-recovery",
  "history-close-traversal-recovery",
  "history-close-cancelled-traversal-recovery",
  "history-close-pending-navigation",
  "history-late-scroll-recovery",
  "history-selected-state-recovery",
  "history-source-state-recovery",
  "history-cloned-entry-recovery",
  "history-same-url-copy-refusal",
  "history-exact-application-recovery",
  "history-repeated-reload-rekey",
  "history-long-url-recovery",
  "history-commit-failure-recovery",
  "history-focus-state-recovery",
  "history-multiple-push-recovery",
  "history-traversal-push-recovery",
  "history-close-during-commit-recovery",
  "history-scroll-flush-source-refresh",
  "history-precommit-focus-recovery",
  "history-native-supersession-recovery",
  "history-scroll-rollback-recovery",
  "history-scroll-postcondition-recovery",
  "history-cancelled-reload-recovery",
  "history-cancelled-fallback-recovery",
  "history-cancelled-preselection-recovery",
  "history-return-value-reload-recovery",
  "history-click-supersession-recovery",
  "history-delayed-recovery-supersession",
  "history-fragment-supersession-recovery",
  "history-ordinary-native-supersession",
  "history-form-supersession-recovery",
  "history-recovery",
]) {
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

console.log("V2 history/focus/scroll qualification passed (private state, current-packed 186-case corpus, executable guidance)");
