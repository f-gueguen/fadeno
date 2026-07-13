import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { DecisionSessionSnapshot } from "./session-decision.js";

const encoder = new TextEncoder();
const proofVersion = "v1";
const proofLifetimeMilliseconds = 15 * 60 * 1_000;
const maximumBodyBytes = 8 * 1_024 * 1_024;
const maximumFileBytes = 5 * 1_024 * 1_024;
const maximumFieldBytes = 64 * 1_024;
const maximumParts = 128;
const maximumFiles = 8;
const maximumFieldNameBytes = 128;
const maximumReplayEntries = 4_096;
const maximumSessionReplayEntries = 64;

export const decisionActionLimits = Object.freeze({
  proofLifetimeMilliseconds,
  maximumBodyBytes,
  maximumFileBytes,
  maximumFieldBytes,
  maximumParts,
  maximumFiles,
  maximumFieldNameBytes,
  maximumReplayEntries,
  maximumSessionReplayEntries,
});

type TextField = Readonly<{ kind: "text"; required: boolean; maximumBytes: number }>;
type IntegerField = Readonly<{ kind: "integer"; required: boolean; minimum?: number; maximum?: number }>;
type CheckboxField = Readonly<{ kind: "checkbox" }>;
type FileField = Readonly<{
  kind: "file";
  required: boolean;
  maximumBytes: number;
  acceptedTypes: readonly string[];
}>;
export type DecisionActionField = TextField | IntegerField | CheckboxField | FileField;

export type DecisionUpload = Readonly<{
  originalName: string;
  contentType: string;
  bytes: Uint8Array;
  cleanup: () => void;
}>;

export type DecisionSubmissionPart =
  | Readonly<{ kind: "field"; name: string; value: string }>
  | Readonly<{ kind: "file"; name: string; upload: DecisionUpload }>;

export type DecisionAction = Readonly<{ readonly decisionAction: unique symbol }>;
type ActionState = Readonly<{ id: string; fields: Readonly<Record<string, DecisionActionField>> }>;
const actions = new WeakMap<object, ActionState>();

export type DecisionActionExpectedFailure = Readonly<{
  code: string;
  changed: boolean;
  fieldErrors: Readonly<Record<string, string>>;
  formErrors: readonly string[];
}>;
const expectedFailures = new WeakMap<object, DecisionActionExpectedFailure>();

export type DecisionActionFlow = Readonly<{
  phase: "boundary" | "authorization" | "mutation" | "completion";
  decision: string;
  cause: string;
}>;

export type DecisionActionOutcome = Readonly<{
  status: "success" | "expected-failure" | "unauthorized" | "refused" | "unexpected-failure";
  code: string;
  revalidation: "complete" | "none";
  redirect: string | null;
  fields: Readonly<Record<string, unknown>> | null;
  flow: readonly DecisionActionFlow[];
}>;

function fail(code: string): never { throw new TypeError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function ownData(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("FADENO_ACTION_DECLARATION");
  return descriptor.value;
}
function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function boundedPositiveInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail("FADENO_ACTION_DECLARATION");
  }
  return value as number;
}
function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
function proofKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) fail("FADENO_ACTION_PROOF_KEY");
  return Buffer.from(key);
}
function state(action: DecisionAction): ActionState {
  const found = actions.get(action);
  if (!found) fail("FADENO_ACTION_DECLARATION");
  return found;
}

export function decisionTextField(options: Readonly<{ required?: boolean; maximumBytes?: number }> = {}): DecisionActionField {
  if (!plainObject(options) || Object.keys(options).some((name) => name !== "required" && name !== "maximumBytes")) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const required = options.required ?? true;
  if (typeof required !== "boolean") fail("FADENO_ACTION_DECLARATION");
  return Object.freeze({ kind: "text", required, maximumBytes: boundedPositiveInteger(options.maximumBytes ?? maximumFieldBytes, maximumFieldBytes) });
}

export function decisionIntegerField(options: Readonly<{ required?: boolean; minimum?: number; maximum?: number }> = {}): DecisionActionField {
  if (!plainObject(options) || Object.keys(options).some((name) => !["required", "minimum", "maximum"].includes(name))) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const required = options.required ?? true;
  if (typeof required !== "boolean") fail("FADENO_ACTION_DECLARATION");
  const { minimum, maximum } = options;
  if ((minimum !== undefined && !Number.isSafeInteger(minimum)) || (maximum !== undefined && !Number.isSafeInteger(maximum))) {
    fail("FADENO_ACTION_DECLARATION");
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) fail("FADENO_ACTION_DECLARATION");
  return Object.freeze({ kind: "integer", required, ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
}

export function decisionCheckboxField(): DecisionActionField {
  return Object.freeze({ kind: "checkbox" });
}

export function decisionFileField(options: Readonly<{ required?: boolean; maximumBytes?: number; acceptedTypes?: readonly string[] }> = {}): DecisionActionField {
  if (!plainObject(options) || Object.keys(options).some((name) => !["required", "maximumBytes", "acceptedTypes"].includes(name))) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const required = options.required ?? true;
  const acceptedTypes = options.acceptedTypes ?? [];
  if (
    typeof required !== "boolean" || !Array.isArray(acceptedTypes) || acceptedTypes.length > 16 ||
    acceptedTypes.some((value) => typeof value !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value))
  ) fail("FADENO_ACTION_DECLARATION");
  return Object.freeze({
    kind: "file",
    required,
    maximumBytes: boundedPositiveInteger(options.maximumBytes ?? maximumFileBytes, maximumFileBytes),
    acceptedTypes: Object.freeze([...new Set(acceptedTypes)].sort(compareText)),
  });
}

export function createDecisionAction(fields: Readonly<Record<string, DecisionActionField>>): DecisionAction {
  if (!plainObject(fields)) fail("FADENO_ACTION_DECLARATION");
  const normalized: Record<string, DecisionActionField> = Object.create(null) as Record<string, DecisionActionField>;
  const names = Object.keys(fields).sort(compareText);
  if (names.length === 0 || names.length > maximumParts) fail("FADENO_ACTION_DECLARATION");
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name) || encoder.encode(name).byteLength > maximumFieldNameBytes || name === "__fadeno_proof") {
      fail("FADENO_ACTION_DECLARATION");
    }
    const field = ownData(fields, name);
    if (!field || typeof field !== "object" || !Object.isFrozen(field) || !["text", "integer", "checkbox", "file"].includes((field as { kind?: unknown }).kind as string)) {
      fail("FADENO_ACTION_DECLARATION");
    }
    normalized[name] = field as DecisionActionField;
  }
  const action = Object.freeze(Object.create(null) as object) as DecisionAction;
  actions.set(action, Object.freeze({ id: base64url(randomBytes(24)), fields: Object.freeze(normalized) }));
  return action;
}

function proofMessage(action: ActionState, routeId: string, generation: string, session: DecisionSessionSnapshot, issuedAt: number, nonce: string): string {
  return [proofVersion, action.id, routeId, generation, session.sessionId, session.csrfSecret, String(issuedAt), nonce].join("\0");
}

export function issueDecisionActionProof(input: Readonly<{
  action: DecisionAction;
  routeId: string;
  generation: string;
  session: DecisionSessionSnapshot;
  proofKey: Uint8Array;
  now: number;
  nonce?: Uint8Array;
}>): string {
  if (!Number.isSafeInteger(input.now) || input.now < 0 || input.now >= input.session.expiresAt) fail("FADENO_ACTION_PROOF");
  if (!input.routeId || !input.generation || encoder.encode(input.routeId).byteLength > 256 || encoder.encode(input.generation).byteLength > 256) {
    fail("FADENO_ACTION_PROOF");
  }
  const nonceBytes = input.nonce ?? randomBytes(24);
  if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== 24) fail("FADENO_ACTION_PROOF");
  const nonce = base64url(nonceBytes);
  const signature = createHmac("sha256", proofKey(input.proofKey))
    .update(proofMessage(state(input.action), input.routeId, input.generation, input.session, input.now, nonce))
    .digest();
  return [proofVersion, String(input.now), nonce, base64url(signature)].join(".");
}

function validateProof(input: Readonly<{
  proof: string;
  action: ActionState;
  routeId: string;
  generation: string;
  session: DecisionSessionSnapshot;
  proofKey: Uint8Array;
  now: number;
}>): Readonly<{ replayId: string; expiresAt: number }> {
  const parts = input.proof.split(".");
  if (parts.length !== 4 || parts[0] !== proofVersion || !/^(0|[1-9][0-9]*)$/u.test(parts[1]!) || !/^[A-Za-z0-9_-]{32}$/u.test(parts[2]!)) {
    fail("FADENO_ACTION_PROOF");
  }
  const issuedAt = Number(parts[1]);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > input.now || input.now - issuedAt > proofLifetimeMilliseconds || input.now >= input.session.expiresAt) {
    fail("FADENO_ACTION_PROOF_EXPIRED");
  }
  const expected = createHmac("sha256", proofKey(input.proofKey))
    .update(proofMessage(input.action, input.routeId, input.generation, input.session, issuedAt, parts[2]!))
    .digest();
  let actual: Buffer;
  try { actual = Buffer.from(parts[3]!, "base64url"); } catch { fail("FADENO_ACTION_PROOF"); }
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected) || base64url(actual) !== parts[3]) {
    fail("FADENO_ACTION_PROOF");
  }
  return Object.freeze({
    replayId: createHash("sha256").update(input.proof).digest("base64url"),
    expiresAt: Math.min(issuedAt + proofLifetimeMilliseconds, input.session.expiresAt),
  });
}

export class DecisionReplayLedger {
  readonly #entries = new Map<string, Readonly<{ sessionId: string; expiresAt: number }>>();
  readonly #perSession = new Map<string, number>();

  consume(replayId: string, sessionId: string, expiresAt: number, now: number): void {
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt > now) continue;
      this.#entries.delete(id);
      const remaining = (this.#perSession.get(entry.sessionId) ?? 1) - 1;
      if (remaining === 0) this.#perSession.delete(entry.sessionId);
      else this.#perSession.set(entry.sessionId, remaining);
    }
    if (this.#entries.has(replayId)) fail("FADENO_ACTION_REPLAY");
    if (this.#entries.size >= maximumReplayEntries || (this.#perSession.get(sessionId) ?? 0) >= maximumSessionReplayEntries) {
      fail("FADENO_ACTION_REPLAY_LIMIT");
    }
    this.#entries.set(replayId, Object.freeze({ sessionId, expiresAt }));
    this.#perSession.set(sessionId, (this.#perSession.get(sessionId) ?? 0) + 1);
  }

  get size(): number { return this.#entries.size; }
}

function cleanupUploads(parts: readonly DecisionSubmissionPart[]): void {
  for (const part of parts) {
    if (part.kind !== "file") continue;
    try { part.upload.cleanup(); } catch { /* cleanup failures cannot expose or accept refused input */ }
  }
}

function decodeFields(action: ActionState, parts: readonly DecisionSubmissionPart[], contentLength: number): Readonly<Record<string, unknown>> {
  if (!Array.isArray(parts) || parts.length > maximumParts || !Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBodyBytes) {
    fail("FADENO_ACTION_BODY_LIMIT");
  }
  const supplied = new Map<string, DecisionSubmissionPart>();
  let observedBytes = 0;
  let files = 0;
  for (const candidate of parts as readonly unknown[]) {
    if (!plainObject(candidate) || (candidate["kind"] !== "field" && candidate["kind"] !== "file") || typeof candidate["name"] !== "string") {
      fail("FADENO_ACTION_PART");
    }
    const part = candidate as DecisionSubmissionPart;
    if (encoder.encode(part.name).byteLength > maximumFieldNameBytes || !Object.hasOwn(action.fields, part.name)) fail("FADENO_ACTION_UNEXPECTED_FIELD");
    if (supplied.has(part.name)) fail("FADENO_ACTION_DUPLICATE_FIELD");
    supplied.set(part.name, part);
    observedBytes += encoder.encode(part.name).byteLength;
    if (part.kind === "field") {
      if (typeof part.value !== "string") fail("FADENO_ACTION_PART");
      observedBytes += encoder.encode(part.value).byteLength;
    } else {
      files += 1;
      if (
        !(part.upload.bytes instanceof Uint8Array) || typeof part.upload.originalName !== "string" ||
        typeof part.upload.contentType !== "string" || typeof part.upload.cleanup !== "function"
      ) fail("FADENO_ACTION_PART");
      observedBytes += part.upload.bytes.byteLength;
    }
    if (observedBytes > maximumBodyBytes || files > maximumFiles) fail("FADENO_ACTION_BODY_LIMIT");
  }
  if (observedBytes > contentLength) fail("FADENO_ACTION_CONTENT_LENGTH");

  const decoded: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(action.fields)) {
    const part = supplied.get(name);
    if (descriptor.kind === "checkbox") {
      if (!part) { decoded[name] = false; continue; }
      if (part.kind !== "field" || part.value !== "on") fail("FADENO_ACTION_FIELD");
      decoded[name] = true;
      continue;
    }
    if (!part) {
      if (descriptor.required) fail("FADENO_ACTION_MISSING_FIELD");
      decoded[name] = null;
      continue;
    }
    if (descriptor.kind === "file") {
      if (part.kind !== "file") fail("FADENO_ACTION_FIELD");
      if (
        part.upload.bytes.byteLength > descriptor.maximumBytes ||
        (descriptor.acceptedTypes.length > 0 && !descriptor.acceptedTypes.includes(part.upload.contentType))
      ) fail("FADENO_ACTION_FILE");
      decoded[name] = Object.freeze({
        originalName: part.upload.originalName,
        contentType: part.upload.contentType,
        bytes: new Uint8Array(part.upload.bytes),
      });
      continue;
    }
    if (part.kind !== "field") fail("FADENO_ACTION_FIELD");
    if (encoder.encode(part.value).byteLength > (descriptor.kind === "text" ? descriptor.maximumBytes : maximumFieldBytes)) {
      fail("FADENO_ACTION_FIELD_LIMIT");
    }
    if (descriptor.kind === "text") decoded[name] = part.value;
    else {
      if (!/^-?(0|[1-9][0-9]*)$/u.test(part.value)) fail("FADENO_ACTION_FIELD");
      const number = Number(part.value);
      if (!Number.isSafeInteger(number) || (descriptor.minimum !== undefined && number < descriptor.minimum) || (descriptor.maximum !== undefined && number > descriptor.maximum)) {
        fail("FADENO_ACTION_FIELD");
      }
      decoded[name] = number;
    }
  }
  return Object.freeze(decoded);
}

function safeRedirect(destination: string | undefined, expectedOrigin: string): string | null {
  if (destination === undefined) return null;
  let url: URL;
  try { url = new URL(destination, expectedOrigin); } catch { fail("FADENO_ACTION_REDIRECT"); }
  if (url.origin !== expectedOrigin || url.protocol !== "https:" || url.username || url.password) fail("FADENO_ACTION_REDIRECT");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function decisionActionFailure(input: Readonly<{
  code: string;
  changed?: boolean;
  fieldErrors?: Readonly<Record<string, string>>;
  formErrors?: readonly string[];
}>): Error {
  if (!plainObject(input) || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.code)) fail("FADENO_ACTION_EXPECTED_FAILURE");
  const fieldErrors = input.fieldErrors ?? {};
  const formErrors = input.formErrors ?? [];
  if (!plainObject(fieldErrors) || !Array.isArray(formErrors) || Object.values(fieldErrors).some((value) => typeof value !== "string") || formErrors.some((value) => typeof value !== "string")) {
    fail("FADENO_ACTION_EXPECTED_FAILURE");
  }
  const error = new Error(input.code);
  expectedFailures.set(error, Object.freeze({
    code: input.code,
    changed: input.changed ?? false,
    fieldErrors: Object.freeze({ ...fieldErrors }),
    formErrors: Object.freeze([...formErrors]),
  }));
  return error;
}

function refusal(code: string, flow: DecisionActionFlow[]): DecisionActionOutcome {
  flow.push(Object.freeze({ phase: "boundary", decision: "refused", cause: code }));
  return Object.freeze({ status: "refused", code, revalidation: "none", redirect: null, fields: null, flow: Object.freeze(flow) });
}

export async function executeDecisionAction(input: Readonly<{
  action: DecisionAction;
  method: string;
  mediaType: string;
  origin: string | null;
  expectedOrigin: string;
  routeId: string;
  expectedRouteId: string;
  generation: string;
  proof: string;
  proofKey: Uint8Array;
  session: DecisionSessionSnapshot;
  replay: DecisionReplayLedger;
  contentLength: number;
  parts: readonly DecisionSubmissionPart[];
  now: number;
  authorize: (fields: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
  run: (fields: Readonly<Record<string, unknown>>) => Readonly<{ redirect?: string }> | Promise<Readonly<{ redirect?: string }>>;
}>): Promise<DecisionActionOutcome> {
  const flow: DecisionActionFlow[] = [];
  let fields: Readonly<Record<string, unknown>> | null = null;
  try {
    try {
      if (input.method !== "POST") fail("FADENO_ACTION_METHOD");
      if (input.mediaType !== "application/x-www-form-urlencoded" && input.mediaType !== "multipart/form-data") fail("FADENO_ACTION_MEDIA_TYPE");
      if (input.expectedOrigin !== new URL(input.expectedOrigin).origin || input.origin !== input.expectedOrigin) fail("FADENO_ACTION_ORIGIN");
      if (input.routeId !== input.expectedRouteId) fail("FADENO_ACTION_ROUTE");
      const action = state(input.action);
      fields = decodeFields(action, input.parts, input.contentLength);
      const proof = validateProof({
        proof: input.proof,
        action,
        routeId: input.routeId,
        generation: input.generation,
        session: input.session,
        proofKey: input.proofKey,
        now: input.now,
      });
      input.replay.consume(proof.replayId, input.session.sessionId, proof.expiresAt, input.now);
      flow.push(Object.freeze({ phase: "boundary", decision: "accepted", cause: "complete-native-request" }));
    } catch (error) {
      return refusal(error instanceof Error ? error.message : "FADENO_ACTION_BOUNDARY", flow);
    }

    let authorized: boolean;
    try { authorized = await input.authorize(fields); }
    catch { authorized = false; }
    if (!authorized) {
      flow.push(Object.freeze({ phase: "authorization", decision: "refused", cause: "application-authorization" }));
      return Object.freeze({ status: "unauthorized", code: "FADENO_ACTION_UNAUTHORIZED", revalidation: "none", redirect: null, fields: null, flow: Object.freeze(flow) });
    }
    flow.push(Object.freeze({ phase: "authorization", decision: "accepted", cause: "application-authorization" }));

    try {
      const result = await input.run(fields);
      flow.push(Object.freeze({ phase: "mutation", decision: "completed", cause: "action-returned" }));
      const redirect = safeRedirect(result.redirect, input.expectedOrigin);
      flow.push(Object.freeze({ phase: "completion", decision: redirect ? "redirect-303" : "render", cause: "complete-revalidation" }));
      return Object.freeze({ status: "success", code: "FADENO_ACTION_OK", revalidation: "complete", redirect, fields, flow: Object.freeze(flow) });
    } catch (error) {
      const expected = error && typeof error === "object" ? expectedFailures.get(error) : undefined;
      if (expected) {
        flow.push(Object.freeze({ phase: "mutation", decision: "expected-failure", cause: expected.code }));
        return Object.freeze({
          status: "expected-failure",
          code: expected.code,
          revalidation: expected.changed ? "complete" : "none",
          redirect: null,
          fields,
          flow: Object.freeze(flow),
        });
      }
      flow.push(Object.freeze({ phase: "mutation", decision: "unexpected-failure", cause: "redacted-internal-failure" }));
      return Object.freeze({ status: "unexpected-failure", code: "FADENO_ACTION_INTERNAL", revalidation: "complete", redirect: null, fields: null, flow: Object.freeze(flow) });
    }
  } finally {
    cleanupUploads(input.parts);
  }
}
