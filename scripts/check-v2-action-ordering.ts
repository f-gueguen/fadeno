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
  "examples/v1-app/scenarios/form-submission/expected/handoff-limit-refusal.json",
  "examples/v1-app/scenarios/form-submission/expected/handoff-limit-refusal-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/formdata-routing-refusal.json",
  "examples/v1-app/scenarios/form-submission/expected/formdata-routing-refusal-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/redirect-recovery-outcome.json",
  "examples/v1-app/scenarios/form-submission/expected/redirect-recovery-outcome-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/handoff-caret-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/handoff-caret-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/pending-handoff.json",
  "examples/v1-app/scenarios/form-submission/expected/pending-handoff-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/supersession-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/supersession-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery-webkit.json",
  "examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/native-form-fragment-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/native-form-fragment-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/late-target-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/late-target-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/recovery-supersession-continuity.json",
  "examples/v1-app/scenarios/form-submission/expected/recovery-supersession-continuity-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/recovery-handoff-preservation.json",
  "examples/v1-app/scenarios/form-submission/expected/recovery-handoff-preservation-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/cancelled-fragment-push-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/cancelled-fragment-push-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/failed-fragment-push-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/failed-fragment-push-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect-chain.json",
  "examples/v1-app/scenarios/form-submission/expected/fragment-redirect-chain-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption.json",
  "examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption-human.txt",
  "examples/v1-app/scenarios/form-submission/expected/traversal-recovery.json",
  "examples/v1-app/scenarios/form-submission/expected/traversal-recovery-human.txt",
]) assert.equal(tracked.has(path), true, `V2-07 artifact is not tracked: ${path}`);

const adr = read("docs/adr/0052-enhanced-action-outcome-ordering.md").replace(/\s+/gu, " ");
for (const fragment of [
  "Status: Accepted",
  "existing page/resource owners",
  "consumes the mutation result ID",
  "fresh opaque ID and monotonically newer sequence",
  "never submits POST again",
  "preinstalled window finalizer",
  "before the browser can serialize them again",
  "effective disabled state",
  "preceding page rather than a duplicate same-URL entry",
  "optgroup parent identities and hierarchy",
  "exact bounded parent ancestry",
  "trusted click already cancelled",
  "external-context form",
  "aggregate records",
  "No native-departure timeout is evidence of completion",
  "`dialog` method",
  "repair itself fails",
  "same frozen handoff predicate",
  "failed push created no entry",
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
for (const feature of ["DATA-01", "DATA-02", "DATA-03", "ENH-01", "PATCH-01", "STATE-01", "SEC-01", "TEST-01"]) {
  const scopeRow = scope.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  const traceabilityRow = traceability.split("\n").find((line) => line.startsWith(`| ${feature} |`)) ?? "";
  assert.equal(scopeRow.includes("ADR 0052"), true, `${feature} scope is missing ADR 0052`);
  assert.equal(traceabilityRow.includes("ADR 0052") && traceabilityRow.includes("check:v2-action-ordering"), true, `${feature} traceability is missing V2-07 evidence`);
}

const risks = read("docs/ledgers/risks.md");
assert.equal(risks.includes("ADR 0052 consumes mutation and redirect-GET results independently"), true);
assert.equal(risks.includes("redirect GET reuses mutation identity or an admitted result"), true);
assert.equal(risks.includes("refuses observable unenhanceable same-context departures"), true);
assert.equal(risks.includes("elapsed time races a live native GET or POST"), true);
assert.equal(risks.includes("effective disabled inheritance"), true);
assert.equal(risks.includes("bounds control/record/byte handoff capture before serialization"), true);
assert.equal(risks.includes("exact option/optgroup hierarchy"), true);
assert.equal(risks.includes("accepts image submitters only with browser-owned entries"), true);
assert.equal(risks.includes("modified-primary/middle-button destinations"), true);
assert.equal(risks.includes("failed repair retains a staged URL"), true);

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
  "privateNativeGetFormDestination",
  'stageDestination: "replace" | "push" | "none"',
  "nativeDepartureRecovery",
  "privateFormHandoffSelectionState",
  "let ownsPending = true",
  "selectedHistoryState !== undefined",
  "effectivelyDisabled",
  "recoverAfterRollback",
  "cancelled pushed-fragment reload rolled back before current-truth recovery",
  "privateSelectHandoffStructure",
  "privateFragmentReloadRecoveryMode",
  "preservationSafe: () => boolean",
  "observation.policyProtected?.()",
  "canDepartCurrentDocument",
  "candidate.protocol === \"http:\" || candidate.protocol === \"https:\"",
  "const recoverAgain: PrivateMutationRecovery",
  "reloadExactDestination",
  "recoverCurrentTruthNatively",
  "preferNativeCurrentTruthRecovery",
  "destination.href.includes(\"#\")",
  "browser-owned external-context form submission superseded pending navigation",
  "event.defaultPrevented && !active?.recoverCancelledMutation",
  "maximumPrivateFormHandoffAncestry",
  "samePrivateFormHandoffAncestry",
  "final browser-owned click state superseded pending work",
  "propagation-stopped browser-owned click superseded pending work",
  "observeNativeFormData",
  "const repaired = repairDisplayedTruth(",
  "nativeMutationRecoveryCarrier",
  "nativeMutationRecoveryFallback",
  "nativeMutationRecoveryCarrier !== operation",
  "stopCancelledDepartureObservation?.()",
  'recovery.recoverCancelledMutation("replace")',
  "maximumPrivateFormHandoffBytes",
  "maximumPrivateFormHandoffRecords",
  "maximumPrivateFormHandoffControls",
  "privateFormHandoffWithinLimit",
  "refuseUnobservableSameContextDeparture",
  "auxclick",
]) assert.equal(browser.includes(fragment), true, `browser action ordering is missing ${fragment}`);
assert.equal(browser.includes("recoverWithoutDeparture"), false, "native completion must not be inferred by timeout");
const browserForm = read("packages/framework/src/internal/browser-form.ts");
for (const fragment of ["allowNativeImage", 'value.type === "image"', "selectedDestination"]) {
  assert.equal(browserForm.includes(fragment), true, `native form observation is missing ${fragment}`);
}
assert.equal(
  browser.includes('repairDisplayedTruth(\n                  recovery.truthUrl')
    && browser.indexOf('repairDisplayedTruth(\n                  recovery.truthUrl') < browser.indexOf('recovery.recoverCancelledMutation("replace");'),
  true,
  "staged mutation recovery must repair displayed truth before requesting current truth",
);

const actionDecision = read("packages/framework/src/internal/action-decision.ts");
assert.equal(
  actionDecision.includes('url.hash === "" && url.href.includes("#") ? "#" : ""'),
  true,
  "action redirect normalization must preserve an explicit empty fragment delimiter",
);

const navigationSpecification = read("docs/spec/navigation-patching-preservation.md").replace(/\s+/gu, " ");
for (const fragment of [
  "first consumes the mutation result",
  "fresh cancellable GET",
  "newer eligible navigation supersedes that GET",
  "cancelled native departure reloads committed current truth",
  "observable ineligible same-context",
  "history staging fails",
  "caret/selection range and direction",
  "newer submission's busy state",
  "unsafe-entry native recovery",
  "does not trigger a second `formdata` event",
  "Explicit referrer-policy and `noreferrer`",
  "selected-push rollback",
  "stops observation before a later microtask serialization",
  "before any `FormData` construction",
  "exact option identity",
  "option disabled state inherited from an `optgroup`",
  "next Back reaches the preceding page",
  "submission cancelled by a later document listener",
  "exact optgroup parent identity",
  "failed push",
  "effective form and submitter target after document listeners",
  "re-reads link destination, target, download, and privacy state",
  "empty fragment delimiter",
  "recovery GET retains the committed-mutation recovery owner",
  "exact bounded parent ancestry",
  "trusted click already cancelled before the runtime document listener",
  "external-context forms",
  "listener change from `dialog` to GET",
  "accepts an image submitter",
  "native replacement immediately returns to current truth",
]) assert.equal(navigationSpecification.includes(fragment), true, `navigation specification is missing ${fragment}`);

const formSpecification = read("docs/spec/forms-actions-sessions.md").replace(/\s+/gu, " ");
for (const fragment of [
  "state-changing expected response commits",
  "unchanged expected validation response does not run revalidation",
  "cannot publish stale assumptions about changed resources",
  "platform successful controls once",
  "push-style history",
  "finalized after document submit listeners",
  "rollback completes before recovery",
  "without constructing `FormData`",
  "exact optgroup hierarchy",
  "Final target ownership is resolved after document submit listeners",
  "already cancelled before the runtime document listener",
  "separate browsing context",
  "accepts an image submitter",
  "No timeout treats elapsed time as native completion",
  "retained `dialog` submission",
  "exact bounded control ancestry",
]) assert.equal(formSpecification.includes(fragment), true, `form specification is missing ${fragment}`);

const threatModel = read("docs/security/browser-update-threat-model.md").replace(/\s+/gu, " ");
for (const fragment of [
  "V2-07's mutation-to-redirect-GET ownership selected by ADR 0052",
  "Mutation-to-redirect-GET handoff loses identity, preservation, or recovery ownership",
  "post-handoff edit/file/caret/ancestry/attribute/option/disabled and resource-limit refusal",
  "selected/unsafe traversal cancellation",
  "final-`formdata`/image/microtask evidence",
  "cancelled-close recovery",
  "zero-forced-request protected fragments",
  "stopped-propagation refusal or safe fragment observation",
  "modified-primary/middle-button and privacy ownership",
  "no-timeout slow-departure refusal",
  "dialog final-method handling",
  "failed-repair native replacement",
  "recovery-GET supersession continuity",
  "empty-fragment delimiter",
  "recovery-time handoff refusal",
  "same/same-hash/empty-fragment reload",
  "V2-08 and V2-09 must qualify structural reconciliation",
]) assert.equal(threatModel.includes(fragment), true, `browser update threat model is missing ${fragment}`);
assert.equal(threatModel.includes("V2-07 through V2-09 must qualify complete action ordering"), false);

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
  "bounds redirect handoff snapshots before serializing application-owned controls",
  "newer GET supersedes the redirect",
  "native activation supersedes the redirect",
  "native activation has no document departure",
  'button: "middle"',
  "same-document native GET form that supersedes the redirect",
  "serialized successful controls once",
  "control-attribute",
  "option-identity",
  "propagation-stopped",
  "late submit listeners",
  "unsafe destinations",
  "submit propagation stops or a late listener cancels before window finalization",
  "captured-before-listeners",
  'setAttribute("target", "_blank")',
  "cancelled pushed fragment reload before recovering current truth",
  "final same-context target selected by late submit listeners",
  "newer cancelled activation supersedes recovery GET",
  "frozen handoff snapshot through interrupted-departure recovery",
  "fragment push that failed before staging an entry",
  "control ancestry",
  "stoppedPropagationRefusal",
  "native-image-submitter",
  "lateDialogMethod",
  "repairFailureRecovery",
  "optgroup-hierarchy",
  "same-metadata file replacement",
  "same-resource fragment redirects",
  "fragments returned by the redirect GET",
  "redirect GET result before following its redirect chain",
  "submitted-control caret change made after redirect handoff",
  "newer submission pending owner after redirect handoff",
  "selected traversal URLs and retains recovery through unsafe traversal",
  "intentional traversal repair write failure",
  "intentional inherited GET form commit failure",
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
  ["examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery.json", '"ancestryRecovered": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery.json", '"customControlRecovered": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-edit-recovery.json", '"indeterminateRecovered": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-limit-refusal.json", '"flowCode": "FADENO_UPDATE_LIMIT"'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-limit-refusal.json", '"encodedSnapshotBytesExceedLimit": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-limit-refusal.json", '"singleValueWasStringified": false'],
  ["examples/v1-app/scenarios/form-submission/expected/formdata-routing-refusal.json", '"formDataEvents": 1'],
  ["examples/v1-app/scenarios/form-submission/expected/formdata-routing-refusal.json", '"mutationRequests": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/redirect-recovery-outcome.json", '"flowCode": "FADENO_UPDATE_RECOVERY"'],
  ["examples/v1-app/scenarios/form-submission/expected/redirect-recovery-outcome.json", '"mutationRetrySkipped": true'],
  ["examples/v1-app/scenarios/form-submission/expected/handoff-caret-recovery.json", '"newerCaretNotOverwritten": true'],
  ["examples/v1-app/scenarios/form-submission/expected/pending-handoff.json", '"newerPendingRetained": true'],
  ["examples/v1-app/scenarios/form-submission/expected/supersession-recovery.json", '"currentTruthVisible": true'],
  ["examples/v1-app/scenarios/form-submission/expected/native-supersession-recovery.json", '"nativeSupersedingGets": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"forcedNativeGets": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"separateContextRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"initialExternalContextRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"preCancelledLinkRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"modifiedPrimaryContextRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"middleButtonContextRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"lateCancelledEligibleLink"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery.json", '"removedPolicyCancellation"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery-webkit.json", '"driverSupport": "unavailable"'],
  ["examples/v1-app/scenarios/form-submission/expected/native-no-departure-recovery-webkit.json", '"browserOwnedActivationAllowed": null'],
  ["examples/v1-app/scenarios/form-submission/expected/native-form-fragment-recovery.json", '"unsafeDestinationFormDataEvents": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/native-form-fragment-recovery.json", '"nativeCurrentTruthGetsAtLeastFive": true'],
  ["examples/v1-app/scenarios/form-submission/expected/native-form-fragment-recovery.json", '"imageSubmitterFormDataEvents": 2'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"formDataEvents": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"lateWindowCancellation"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"captureCancellation"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"stoppedPropagationRefusal"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"dialogRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"lateDialogMethod"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"finalFormStateRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"formDataEvents": 2'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"nativeDestinationGets": 0'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"waitedPastUnsafeHeuristicMs": 1200'],
  ["examples/v1-app/scenarios/form-submission/expected/submit-propagation-recovery.json", '"nativeNoDocumentLinkRefusal"'],
  ["examples/v1-app/scenarios/form-submission/expected/late-target-recovery.json", '"finalHash": "#details"'],
  ["examples/v1-app/scenarios/form-submission/expected/late-target-recovery.json", '"externalContextRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/late-target-recovery.json", '"externalNoreferrerOwnership"'],
  ["examples/v1-app/scenarios/form-submission/expected/recovery-supersession-continuity.json", '"privateCurrentTruthGets": 2'],
  ["examples/v1-app/scenarios/form-submission/expected/recovery-handoff-preservation.json", '"nativeCurrentTruthGets": 1'],
  ["examples/v1-app/scenarios/form-submission/expected/cancelled-fragment-push-recovery.json", '"backReachedPrecedingPage": true'],
  ["examples/v1-app/scenarios/form-submission/expected/cancelled-fragment-push-recovery.json", '"repairFailureRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/cancelled-fragment-push-recovery.json", '"postCommitThrowRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/failed-fragment-push-recovery.json", '"failedPush": "repair-current-entry"'],
  ["examples/v1-app/scenarios/form-submission/expected/file-handoff-recovery.json", '"newerFileSelectionNotPrivatelyOverwritten": true'],
  ["examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json", '"cancelledCloseRecovery"'],
  ["examples/v1-app/scenarios/form-submission/expected/fragment-redirect.json", '"finalUrlEndsWithDelimiter": true'],
  ["examples/v1-app/scenarios/form-submission/expected/fragment-redirect-chain.json", '"nativeDestinationGets": 1'],
  ["examples/v1-app/scenarios/form-submission/expected/redirect-get-consumption.json", '"duplicateResultRefused": true'],
  ["examples/v1-app/scenarios/form-submission/expected/traversal-recovery.json", '"getFormPushFailure"'],
  ["examples/v1-app/scenarios/form-submission/expected/traversal-recovery.json", '"repairWriteFailure"'],
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
  '"scenarios/form-submission/expected/handoff-limit-refusal.json"',
  '"scenarios/form-submission/expected/handoff-limit-refusal-human.txt"',
  '"scenarios/form-submission/expected/formdata-routing-refusal.json"',
  '"scenarios/form-submission/expected/formdata-routing-refusal-human.txt"',
  '"scenarios/form-submission/expected/redirect-recovery-outcome.json"',
  '"scenarios/form-submission/expected/redirect-recovery-outcome-human.txt"',
  '"scenarios/form-submission/expected/handoff-caret-recovery.json"',
  '"scenarios/form-submission/expected/handoff-caret-recovery-human.txt"',
  '"scenarios/form-submission/expected/pending-handoff.json"',
  '"scenarios/form-submission/expected/pending-handoff-human.txt"',
  '"scenarios/form-submission/expected/supersession-recovery.json"',
  '"scenarios/form-submission/expected/supersession-recovery-human.txt"',
  '"scenarios/form-submission/expected/native-supersession-recovery.json"',
  '"scenarios/form-submission/expected/native-supersession-recovery-human.txt"',
  '"scenarios/form-submission/expected/native-no-departure-recovery.json"',
  '"scenarios/form-submission/expected/native-no-departure-recovery-webkit.json"',
  '"scenarios/form-submission/expected/native-no-departure-recovery-human.txt"',
  '"scenarios/form-submission/expected/native-form-fragment-recovery.json"',
  '"scenarios/form-submission/expected/native-form-fragment-recovery-human.txt"',
  '"scenarios/form-submission/expected/submit-propagation-recovery.json"',
  '"scenarios/form-submission/expected/submit-propagation-recovery-human.txt"',
  '"scenarios/form-submission/expected/late-target-recovery.json"',
  '"scenarios/form-submission/expected/late-target-recovery-human.txt"',
  '"scenarios/form-submission/expected/recovery-supersession-continuity.json"',
  '"scenarios/form-submission/expected/recovery-supersession-continuity-human.txt"',
  '"scenarios/form-submission/expected/recovery-handoff-preservation.json"',
  '"scenarios/form-submission/expected/recovery-handoff-preservation-human.txt"',
  '"scenarios/form-submission/expected/cancelled-fragment-push-recovery.json"',
  '"scenarios/form-submission/expected/cancelled-fragment-push-recovery-human.txt"',
  '"scenarios/form-submission/expected/failed-fragment-push-recovery.json"',
  '"scenarios/form-submission/expected/failed-fragment-push-recovery-human.txt"',
  '"scenarios/form-submission/expected/file-handoff-recovery.json"',
  '"scenarios/form-submission/expected/file-handoff-recovery-human.txt"',
  '"scenarios/form-submission/expected/fragment-redirect.json"',
  '"scenarios/form-submission/expected/fragment-redirect-human.txt"',
  '"scenarios/form-submission/expected/fragment-redirect-chain.json"',
  '"scenarios/form-submission/expected/fragment-redirect-chain-human.txt"',
  '"scenarios/form-submission/expected/redirect-get-consumption.json"',
  '"scenarios/form-submission/expected/redirect-get-consumption-human.txt"',
  '"scenarios/form-submission/expected/traversal-recovery.json"',
  '"scenarios/form-submission/expected/traversal-recovery-human.txt"',
]) assert.equal(documentationSource.includes(fragment), true, `documentation source is missing ${fragment}`);
const documentationSourceDocument = JSON.parse(documentationSource) as Readonly<{
  evidence?: Readonly<{ staleRemoval?: readonly string[] }>;
}>;
assert.equal(
  documentationSourceDocument.evidence?.staleRemoval?.includes(
    "scenarios/form-submission/expected/native-no-departure-recovery.json",
  ),
  true,
  "native no-departure recovery must participate in stale artifact cleanup",
);
assert.equal(
  documentationSourceDocument.evidence?.staleRemoval?.includes(
    "scenarios/form-submission/expected/native-no-departure-recovery-webkit.json",
  ),
  true,
  "unavailable auxiliary-driver evidence must participate in stale artifact cleanup",
);
assert.equal(
  documentationSourceDocument.evidence?.staleRemoval?.includes(
    "scenarios/form-submission/expected/cancelled-fragment-push-recovery.json",
  ),
  true,
  "cancelled pushed-fragment recovery must participate in stale artifact cleanup",
);
assert.equal(
  documentationSourceDocument.evidence?.staleRemoval?.includes(
    "scenarios/form-submission/expected/recovery-supersession-continuity.json",
  ),
  true,
  "recovery supersession continuity must participate in stale artifact cleanup",
);
console.log("V2-07 action ordering contract passed (redirect GET handoff, authenticated CRUD, stale suppression, and native recovery)");
