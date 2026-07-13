import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import Ajv2020Module from "ajv/dist/2020.js";

import {
  createDecisionAction,
  DecisionReplayLedger,
  decisionActionFailure,
  decisionActionLimits,
  decisionCheckboxField,
  decisionFileField,
  decisionIntegerField,
  decisionTextField,
  executeDecisionAction,
  issueDecisionActionProof,
  type DecisionAction,
  type DecisionActionOutcome,
  type DecisionSubmissionPart,
} from "../packages/framework/src/internal/action-decision.ts";
import {
  createDecisionSession,
  createDecisionSessionKeyring,
  decisionSessionLimits,
  formatDecisionSessionCookie,
  formatDecisionSessionDeletionCookie,
  openDecisionSession,
  renewDecisionSession,
  type DecisionSessionSnapshot,
} from "../packages/framework/src/internal/session-decision.ts";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): Validator };
const root = new URL("../", import.meta.url);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(new URL(path, root), "utf8")) as unknown;

const schema = await readJson("packages/framework/contracts/action-session-v1.schema.json");
const corpus = await readJson("packages/framework/contracts/action-session-v1.corpus.json") as {
  schemaVersion: number;
  operation: string;
  cases: readonly Readonly<{ id: string; category: string; expected: string }>[];
};
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
assert.equal(validate(corpus), true, JSON.stringify(validate.errors));
assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length, "corpus case IDs are unique");

const now = 1_000_000;
const oldKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const activeKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const proofKey = Uint8Array.from({ length: 32 }, (_, index) => index + 101);
const oldKeyring = createDecisionSessionKeyring([{ id: "old", key: oldKey }]);
const keyring = createDecisionSessionKeyring([{ id: "active", key: activeKey }, { id: "old", key: oldKey }]);
const created = createDecisionSession(oldKeyring, { accountId: 7, role: "editor" }, now);
const initialOpen = openDecisionSession(oldKeyring, created.envelope, now);
if (!initialOpen.snapshot) throw new Error("created decision session did not open");
const session = initialOpen.snapshot;

const action = createDecisionAction({
  title: decisionTextField({ maximumBytes: 128 }),
  priority: decisionIntegerField({ minimum: 1, maximum: 5 }),
  archived: decisionCheckboxField(),
  brief: decisionFileField({ required: false, acceptedTypes: ["text/plain"], maximumBytes: 1_024 }),
});

let nonceCounter = 0;
function proof(target = action, owner = session, generation = "generation-1", routeId = "route:projects/edit"): string {
  nonceCounter += 1;
  return issueDecisionActionProof({
    action: target,
    routeId,
    generation,
    session: owner,
    proofKey,
    now,
    nonce: new Uint8Array(24).fill(nonceCounter),
  });
}

type ExecuteOverrides = Partial<Readonly<{
  action: DecisionAction;
  method: string;
  mediaType: string;
  origin: string | null;
  expectedOrigin: string;
  routeId: string;
  expectedRouteId: string;
  generation: string;
  submittedProof: string;
  owner: DecisionSessionSnapshot;
  replay: DecisionReplayLedger;
  contentLength: number;
  parts: readonly DecisionSubmissionPart[];
  authorize: (fields: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
  run: (fields: Readonly<Record<string, unknown>>) => Readonly<{ redirect?: string }> | Promise<Readonly<{ redirect?: string }>>;
}>>;

const normalParts = (): readonly DecisionSubmissionPart[] => [
  { kind: "field", name: "title", value: "First project" },
  { kind: "field", name: "priority", value: "3" },
  { kind: "field", name: "archived", value: "on" },
];

async function execute(overrides: ExecuteOverrides = {}): Promise<DecisionActionOutcome> {
  const selectedAction = overrides.action ?? action;
  const owner = overrides.owner ?? session;
  const routeId = overrides.routeId ?? "route:projects/edit";
  const generation = overrides.generation ?? "generation-1";
  return executeDecisionAction({
    action: selectedAction,
    method: overrides.method ?? "POST",
    mediaType: overrides.mediaType ?? "application/x-www-form-urlencoded",
    origin: overrides.origin === undefined ? "https://example.test" : overrides.origin,
    expectedOrigin: overrides.expectedOrigin ?? "https://example.test",
    routeId,
    expectedRouteId: overrides.expectedRouteId ?? "route:projects/edit",
    generation,
    proof: overrides.submittedProof ?? proof(selectedAction, owner, generation, routeId),
    proofKey,
    session: owner,
    replay: overrides.replay ?? new DecisionReplayLedger(),
    contentLength: overrides.contentLength ?? 1_024,
    parts: overrides.parts ?? normalParts(),
    now,
    authorize: overrides.authorize ?? (() => true),
    run: overrides.run ?? (() => ({ redirect: "/projects/7?updated=1" })),
  });
}

const observed = new Map<string, string>();
const record = (id: string, value: string): void => { observed.set(id, value); };

let successfulUploadCleanups = 0;
const success = await execute({
  mediaType: "multipart/form-data",
  parts: [
    ...normalParts(),
    {
      kind: "file",
      name: "brief",
      upload: {
        originalName: "../../untrusted-name.txt",
        contentType: "text/plain",
        bytes: new TextEncoder().encode("bounded contents"),
        cleanup: () => { successfulUploadCleanups += 1; },
      },
    },
  ],
});
assert.equal(success.status, "success");
assert.equal(success.redirect, "/projects/7?updated=1");
assert.equal(success.revalidation, "complete");
assert.equal(successfulUploadCleanups, 1);
assert.equal((success.fields?.["brief"] as { originalName: string }).originalName, "../../untrusted-name.txt", "original upload names remain data, never paths");
record("native-success", success.code);

record("missing-field", (await execute({ parts: normalParts().filter(({ name }) => name !== "title") })).code);
record("malformed-field", (await execute({ parts: normalParts().map((part) => part.name === "priority" ? { ...part, value: "3.0" } : part) })).code);
record("duplicate-field", (await execute({ parts: [...normalParts(), { kind: "field", name: "title", value: "duplicate" }] })).code);
record("unexpected-field", (await execute({ parts: [...normalParts(), { kind: "field", name: "admin", value: "true" }] })).code);
record("oversized-body", (await execute({ contentLength: decisionActionLimits.maximumBodyBytes + 1 })).code);

let refusedUploadCleanups = 0;
const hostileUpload = await execute({
  mediaType: "multipart/form-data",
  parts: [
    ...normalParts(),
    {
      kind: "file",
      name: "brief",
      upload: {
        originalName: "payload.bin",
        contentType: "application/octet-stream",
        bytes: new Uint8Array(32),
        cleanup: () => { refusedUploadCleanups += 1; },
      },
    },
  ],
});
assert.equal(refusedUploadCleanups, 1, "refused partial uploads are always cleaned");
record("hostile-upload", hostileUpload.code);

let boundaryAuthorizationCalls = 0;
let boundaryMutationCalls = 0;
const crossOrigin = await execute({
  origin: "https://attacker.test",
  authorize: () => { boundaryAuthorizationCalls += 1; return true; },
  run: () => { boundaryMutationCalls += 1; return {}; },
});
assert.equal(boundaryAuthorizationCalls, 0);
assert.equal(boundaryMutationCalls, 0);
record("cross-origin", crossOrigin.code);
record("invalid-proof", (await execute({ submittedProof: "v1.invalid" })).code);

let unauthorizedMutations = 0;
const unauthorized = await execute({ authorize: () => false, run: () => { unauthorizedMutations += 1; return {}; } });
assert.equal(unauthorizedMutations, 0);
record("unauthorized", unauthorized.code);

const replayLedger = new DecisionReplayLedger();
const replayProof = proof();
assert.equal((await execute({ replay: replayLedger, submittedProof: replayProof })).status, "success");
const replayed = await execute({ replay: replayLedger, submittedProof: replayProof });
record("replayed", replayed.code);

const unsafeRedirect = await execute({ run: () => ({ redirect: "https://attacker.test/steal" }) });
assert.equal(unsafeRedirect.revalidation, "complete", "unsafe completion after mutation still refreshes server truth");
record("unsafe-redirect", unsafeRedirect.code);

const expectedUnchanged = await execute({ run: () => { throw decisionActionFailure({ code: "PROJECT_CONFLICT", fieldErrors: { title: "Already exists" } }); } });
assert.equal(expectedUnchanged.revalidation, "none");
record("expected-unchanged", expectedUnchanged.code);
const expectedChanged = await execute({ run: () => { throw decisionActionFailure({ code: "PROJECT_STORED_WITH_WARNING", changed: true, formErrors: ["Notification failed"] }); } });
assert.equal(expectedChanged.revalidation, "complete");
record("expected-changed", expectedChanged.code);

const tamperedEnvelope = `${created.envelope.slice(0, -1)}${created.envelope.endsWith("A") ? "B" : "A"}`;
const tampered = openDecisionSession(oldKeyring, tamperedEnvelope, now);
assert.deepEqual(tampered, { status: "invalid", snapshot: null, clearCookie: true });
record("session-tampered", tampered.status);
const expired = openDecisionSession(oldKeyring, created.envelope, now + decisionSessionLimits.sessionLifetimeMilliseconds);
assert.deepEqual(expired, { status: "expired", snapshot: null, clearCookie: true });
record("session-expired", expired.status);
const prior = openDecisionSession(keyring, created.envelope, now);
assert.equal(prior.status, "renew");
record("session-prior-key", prior.status);
assert.ok(prior.snapshot);
const renewedKey = renewDecisionSession(keyring, prior.snapshot, prior.snapshot.values, now + 1, "retain-identity");
assert.equal(renewedKey.snapshot.sessionId, session.sessionId);
assert.equal(openDecisionSession(keyring, renewedKey.envelope, now + 1).status, "valid");

const privileged = renewDecisionSession(keyring, session, { accountId: 7, role: "administrator" }, now + 1, "privilege-change");
assert.notEqual(privileged.snapshot.sessionId, session.sessionId);
assert.notEqual(privileged.snapshot.csrfSecret, session.csrfSecret);
assert.equal(privileged.snapshot.createdAt, now + 1);
record("session-fixation", "rotated");

const other = createDecisionSession(keyring, { accountId: 8 }, now).snapshot;
record("invalid-proof", (await execute({ owner: other, submittedProof: proof(action, session) })).code);

let recoveryAttempt = 0;
const recoveryFailure = await execute({ run: () => {
  recoveryAttempt += 1;
  throw decisionActionFailure({ code: "PROJECT_CONFLICT" });
} });
assert.equal(recoveryFailure.code, "PROJECT_CONFLICT");
const recovery = await execute({ run: () => {
  recoveryAttempt += 1;
  return { redirect: "/projects/7" };
} });
assert.equal(recoveryAttempt, 2);
record("recovery", recovery.code);

for (const fixture of corpus.cases) assert.equal(observed.get(fixture.id), fixture.expected, fixture.id);
assert.deepEqual([...observed.keys()].sort(), corpus.cases.map(({ id }) => id).sort(), "every corpus case executes");

assert.match(formatDecisionSessionCookie(created.envelope, now, session.expiresAt), /^__Host-fadeno-session=.*; Path=\/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax$/u);
assert.equal(formatDecisionSessionDeletionCookie(), "__Host-fadeno-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
assert.throws(() => createDecisionSessionKeyring([]), /FADENO_SESSION_KEYS/u);
assert.throws(() => createDecisionSessionKeyring([{ id: "short", key: new Uint8Array(31) }]), /FADENO_SESSION_KEYS/u);
assert.throws(() => createDecisionSession(keyring, { secret: "x".repeat(decisionSessionLimits.maximumValueBytes + 1) }, now), /FADENO_SESSION_VALUE_LIMIT/u);
const cyclic: Record<string, unknown> = {};
cyclic["cycle"] = cyclic;
assert.throws(() => createDecisionSession(keyring, cyclic as never, now), /FADENO_SESSION_VALUE/u);
let getterRan = false;
const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { getterRan = true; return "exposed"; } });
assert.throws(() => createDecisionSession(keyring, accessor, now), /FADENO_SESSION_VALUE/u);
assert.equal(getterRan, false);

const expectedHuman = [
  "FADENO_ACTION_ORIGIN: The mutation was refused because its Origin did not exactly match the application origin.",
  "FADENO_ACTION_UNAUTHORIZED: The signed-in session is not allowed to perform this mutation.",
  "FADENO_ACTION_REPLAY: This form proof was already consumed. Reload the page and submit the fresh form.",
  "",
].join("\n");
assert.equal(await readFile(new URL("fixtures/v1-action-session/diagnostics.human.txt", root), "utf8"), expectedHuman);

const expectedMachine = {
  schemaVersion: 1,
  diagnostics: [
    { code: "FADENO_ACTION_ORIGIN", phase: "boundary", range: null, rangeReason: "native-request-header", sensitiveValues: "redacted", correction: null },
    { code: "FADENO_ACTION_UNAUTHORIZED", phase: "authorization", range: null, rangeReason: "runtime-authorization-decision", sensitiveValues: "redacted", correction: null },
    { code: "FADENO_ACTION_REPLAY", phase: "boundary", range: null, rangeReason: "consumed-native-form-proof", sensitiveValues: "redacted", correction: { id: "fadeno.action.reload-fresh-form", safety: "review", intent: "reload-and-resubmit" } },
  ],
};
assert.deepEqual(await readJson("fixtures/v1-action-session/diagnostics.normalized.json"), expectedMachine);

const flowFixture = await readJson("fixtures/v1-action-session/flow.normalized.json") as { success: unknown; refusal: unknown; skipped: unknown };
assert.deepEqual(flowFixture.success, success.flow);
assert.deepEqual(flowFixture.refusal, crossOrigin.flow);
assert.deepEqual(flowFixture.skipped, ["application-authorization", "application-mutation", "resource-revalidation"]);
assert.equal(JSON.stringify(flowFixture).includes("First project"), false, "flow output excludes submitted values");

assert.equal(await readFile(new URL("fixtures/v1-action-session/correction.before.html", root), "utf8"), "<form method=\"get\"><button>Save project</button></form>\n");
assert.equal(await readFile(new URL("fixtures/v1-action-session/correction.after.html", root), "utf8"), "<form method=\"post\"><button>Save project</button></form>\n");
assert.deepEqual(await readJson("fixtures/v1-action-session/recovery.normalized.json"), {
  schemaVersion: 1,
  failedRequest: { code: "PROJECT_CONFLICT", revalidation: "none", staleMutation: "absent" },
  freshRequest: { code: "FADENO_ACTION_OK", revalidation: "complete", staleDiagnostic: "absent", staleUpload: "cleaned" },
});

const serializedEvidence = JSON.stringify({ corpus, diagnostics: expectedMachine, success: success.flow, refusal: crossOrigin.flow });
const roundTrip = JSON.parse(serializedEvidence) as { corpus: typeof corpus; diagnostics: typeof expectedMachine; success: unknown; refusal: unknown };
assert.deepEqual(roundTrip.corpus, corpus);
assert.deepEqual(roundTrip.diagnostics, expectedMachine);
assert.deepEqual(roundTrip.success, success.flow);
assert.deepEqual(roundTrip.refusal, crossOrigin.flow);
assert.equal(serializedEvidence.includes("First project"), false);
assert.equal(serializedEvidence.includes("accountId"), false);

console.log("V1 action/session decision passed (native success/refusal, authorization, replay, redirect, upload cleanup, session protection/rotation/fixation, flow, recovery)");
