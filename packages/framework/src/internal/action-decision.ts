import { createHash, randomBytes } from "node:crypto";

import {
  assertDecisionSessionOwner,
  signDecisionActionProof,
  verifyDecisionActionProof,
  type DecisionSessionKeyring,
  type DecisionSessionSnapshot,
} from "./session-decision.ts";

const encoder = new TextEncoder();
const proofVersion = "v1";
const proofLifetimeMilliseconds = 15 * 60 * 1_000;
const maximumBodyBytes = 8 * 1_024 * 1_024;
const maximumFileBytes = 5 * 1_024 * 1_024;
const maximumFieldBytes = 64 * 1_024;
const maximumParts = 128;
const maximumFiles = 8;
const maximumFieldNameBytes = 128;
const maximumFileNameBytes = 256;
const maximumBoundaryDurationMilliseconds = 5_000;
const maximumReplayEntries = 4_096;
const maximumSessionReplayEntries = 64;
const maximumFailureTextBytes = 1_024;
const maximumFailureBytes = 16 * 1_024;
const maximumFormErrors = 16;

export const decisionActionLimits = Object.freeze({
  proofLifetimeMilliseconds,
  maximumBodyBytes,
  maximumFileBytes,
  maximumFieldBytes,
  maximumParts,
  maximumFiles,
  maximumFieldNameBytes,
  maximumFileNameBytes,
  maximumBoundaryDurationMilliseconds,
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
const fieldDeclarations = new WeakSet<object>();

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
  expectedFailure: DecisionActionExpectedFailure | null;
  flow: readonly DecisionActionFlow[];
}>;

class DecisionActionRefusal extends TypeError {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never { throw new DecisionActionRefusal(code); }
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
  const field = Object.freeze({ kind: "text", required, maximumBytes: boundedPositiveInteger(options.maximumBytes ?? maximumFieldBytes, maximumFieldBytes) }) as TextField;
  fieldDeclarations.add(field);
  return field;
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
  const field = Object.freeze({ kind: "integer", required, ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) }) as IntegerField;
  fieldDeclarations.add(field);
  return field;
}

export function decisionCheckboxField(): DecisionActionField {
  const field = Object.freeze({ kind: "checkbox" }) as CheckboxField;
  fieldDeclarations.add(field);
  return field;
}

export function decisionFileField(options: Readonly<{ required?: boolean; maximumBytes?: number; acceptedTypes?: readonly string[] }> = {}): DecisionActionField {
  if (!plainObject(options) || Object.keys(options).some((name) => !["required", "maximumBytes", "acceptedTypes"].includes(name))) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const required = options.required ?? true;
  const acceptedTypes = options.acceptedTypes ?? [];
  if (
    typeof required !== "boolean" || !Array.isArray(acceptedTypes) || acceptedTypes.length > 16 ||
    acceptedTypes.some((value) => typeof value !== "string" || value.length > 127 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value))
  ) fail("FADENO_ACTION_DECLARATION");
  const field = Object.freeze({
    kind: "file",
    required,
    maximumBytes: boundedPositiveInteger(options.maximumBytes ?? maximumFileBytes, maximumFileBytes),
    acceptedTypes: Object.freeze([...new Set(acceptedTypes)].sort(compareText)),
  }) as FileField;
  fieldDeclarations.add(field);
  return field;
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
    if (!field || typeof field !== "object" || !fieldDeclarations.has(field)) {
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
  keyring: DecisionSessionKeyring;
  now: number;
  nonce?: Uint8Array;
}>): string {
  assertDecisionSessionOwner(input.session, input.keyring);
  if (!Number.isSafeInteger(input.now) || input.now < 0 || input.now >= input.session.expiresAt) fail("FADENO_ACTION_PROOF");
  if (
    !input.routeId || !input.generation || input.routeId.includes("\0") || input.generation.includes("\0") ||
    encoder.encode(input.routeId).byteLength > 256 || encoder.encode(input.generation).byteLength > 256
  ) {
    fail("FADENO_ACTION_PROOF");
  }
  const nonceBytes = input.nonce ?? randomBytes(24);
  if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== 24) fail("FADENO_ACTION_PROOF");
  const nonce = base64url(nonceBytes);
  const signed = signDecisionActionProof(
    input.keyring,
    proofMessage(state(input.action), input.routeId, input.generation, input.session, input.now, nonce),
  );
  return [proofVersion, signed.keyId, String(input.now), nonce, base64url(signed.signature)].join(".");
}

function validateProof(input: Readonly<{
  proof: string;
  action: ActionState;
  routeId: string;
  generation: string;
  session: DecisionSessionSnapshot;
  keyring: DecisionSessionKeyring;
  now: number;
}>): Readonly<{ replayId: string; expiresAt: number }> {
  if (typeof input.proof !== "string" || input.proof.length > 320) fail("FADENO_ACTION_PROOF");
  const parts = input.proof.split(".");
  if (
    parts.length !== 5 || parts[0] !== proofVersion || !/^[A-Za-z0-9_-]{1,32}$/u.test(parts[1]!) ||
    !/^(0|[1-9][0-9]*)$/u.test(parts[2]!) || !/^[A-Za-z0-9_-]{32}$/u.test(parts[3]!)
  ) {
    fail("FADENO_ACTION_PROOF");
  }
  const issuedAt = Number(parts[2]);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > input.now || input.now - issuedAt >= proofLifetimeMilliseconds || input.now >= input.session.expiresAt) {
    fail("FADENO_ACTION_PROOF_EXPIRED");
  }
  let actual: Buffer;
  try { actual = Buffer.from(parts[4]!, "base64url"); } catch { fail("FADENO_ACTION_PROOF"); }
  if (
    base64url(actual) !== parts[4] ||
    !verifyDecisionActionProof(
      input.keyring,
      parts[1]!,
      proofMessage(input.action, input.routeId, input.generation, input.session, issuedAt, parts[3]!),
      actual,
    )
  ) {
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
  #nextExpiry = Number.POSITIVE_INFINITY;

  #prune(now: number): void {
    if (now < this.#nextExpiry) return;
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt > now) {
        nextExpiry = Math.min(nextExpiry, entry.expiresAt);
        continue;
      }
      this.#entries.delete(id);
      const remaining = (this.#perSession.get(entry.sessionId) ?? 1) - 1;
      if (remaining === 0) this.#perSession.delete(entry.sessionId);
      else this.#perSession.set(entry.sessionId, remaining);
    }
    this.#nextExpiry = nextExpiry;
  }

  consume(replayId: string, sessionId: string, expiresAt: number, now: number): void {
    if (this.#entries.has(replayId)) fail("FADENO_ACTION_REPLAY");
    if (this.#entries.size >= maximumReplayEntries || (this.#perSession.get(sessionId) ?? 0) >= maximumSessionReplayEntries) {
      this.#prune(now);
    }
    if (this.#entries.size >= maximumReplayEntries || (this.#perSession.get(sessionId) ?? 0) >= maximumSessionReplayEntries) {
      fail("FADENO_ACTION_REPLAY_LIMIT");
    }
    this.#entries.set(replayId, Object.freeze({ sessionId, expiresAt }));
    this.#perSession.set(sessionId, (this.#perSession.get(sessionId) ?? 0) + 1);
    this.#nextExpiry = Math.min(this.#nextExpiry, expiresAt);
  }

  get size(): number { return this.#entries.size; }
}

function cleanupUploads(parts: unknown): void {
  if (!Array.isArray(parts)) return;
  for (const candidate of parts as readonly unknown[]) {
    try {
      if (!plainObject(candidate) || ownData(candidate, "kind") !== "file") continue;
      const upload = ownData(candidate, "upload");
      if (!plainObject(upload)) continue;
      const cleanup = ownData(upload, "cleanup");
      if (typeof cleanup === "function") cleanup();
    } catch { /* cleanup failure or hostile shape cannot expose or accept refused input */ }
  }
}

function decodeFields(action: ActionState, parts: readonly DecisionSubmissionPart[], contentLength: number | null): Readonly<Record<string, unknown>> {
  if (
    !Array.isArray(parts) || parts.length > maximumParts ||
    (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBodyBytes))
  ) {
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
        encoder.encode(part.upload.originalName).byteLength > maximumFileNameBytes ||
        typeof part.upload.contentType !== "string" || part.upload.contentType.length > 127 ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(part.upload.contentType) ||
        typeof part.upload.cleanup !== "function"
      ) fail("FADENO_ACTION_PART");
      observedBytes += part.upload.bytes.byteLength;
    }
    if (observedBytes > maximumBodyBytes || files > maximumFiles) fail("FADENO_ACTION_BODY_LIMIT");
  }
  if (contentLength !== null && observedBytes > contentLength) fail("FADENO_ACTION_CONTENT_LENGTH");

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

function expectedFailureFields(
  action: ActionState,
  decoded: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const retained: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(action.fields)) {
    const value = decoded[name];
    if (descriptor.kind !== "file" || value === null) {
      retained[name] = value;
      continue;
    }
    const file = value as Readonly<{ originalName: string; contentType: string; bytes: Uint8Array }>;
    retained[name] = Object.freeze({
      originalName: file.originalName,
      contentType: file.contentType,
      size: file.bytes.byteLength,
    });
  }
  return Object.freeze(retained);
}

export function decisionActionFailure(input: Readonly<{
  code: string;
  changed?: boolean;
  fieldErrors?: Readonly<Record<string, string>>;
  formErrors?: readonly string[];
}>): Error {
  if (
    !plainObject(input) || Object.keys(input).some((name) => !["code", "changed", "fieldErrors", "formErrors"].includes(name)) ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.code) || (input.changed !== undefined && typeof input.changed !== "boolean")
  ) fail("FADENO_ACTION_EXPECTED_FAILURE");
  const fieldErrors = input.fieldErrors ?? {};
  const formErrors = input.formErrors ?? [];
  if (!plainObject(fieldErrors) || !Array.isArray(formErrors) || formErrors.length > maximumFormErrors || Object.getPrototypeOf(formErrors) !== Array.prototype) {
    fail("FADENO_ACTION_EXPECTED_FAILURE");
  }
  let bytes = 0;
  const normalizedFields: Record<string, string> = Object.create(null) as Record<string, string>;
  const fieldNames = Object.keys(fieldErrors).sort(compareText);
  if (fieldNames.length > maximumParts) fail("FADENO_ACTION_EXPECTED_FAILURE");
  for (const name of fieldNames) {
    const value = ownData(fieldErrors, name);
    const nextBytes = encoder.encode(name).byteLength + (typeof value === "string" ? encoder.encode(value).byteLength : maximumFailureBytes + 1);
    if (
      !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name) || typeof value !== "string" ||
      encoder.encode(value).byteLength > maximumFailureTextBytes || nextBytes > maximumFailureBytes - bytes
    ) fail("FADENO_ACTION_EXPECTED_FAILURE");
    bytes += nextBytes;
    normalizedFields[name] = value;
  }
  const normalizedForms: string[] = [];
  for (let index = 0; index < formErrors.length; index += 1) {
    const value = ownData(formErrors, String(index));
    const valueBytes = typeof value === "string" ? encoder.encode(value).byteLength : maximumFailureBytes + 1;
    if (typeof value !== "string" || valueBytes > maximumFailureTextBytes || valueBytes > maximumFailureBytes - bytes) {
      fail("FADENO_ACTION_EXPECTED_FAILURE");
    }
    bytes += valueBytes;
    normalizedForms.push(value);
  }
  if (Object.keys(formErrors).length !== formErrors.length) fail("FADENO_ACTION_EXPECTED_FAILURE");
  const error = new Error(input.code);
  expectedFailures.set(error, Object.freeze({
    code: input.code,
    changed: input.changed ?? false,
    fieldErrors: Object.freeze(normalizedFields),
    formErrors: Object.freeze(normalizedForms),
  }));
  return error;
}

function refusal(code: string, flow: DecisionActionFlow[]): DecisionActionOutcome {
  flow.push(Object.freeze({ phase: "boundary", decision: "refused", cause: code }));
  return Object.freeze({ status: "refused", code, revalidation: "none", redirect: null, fields: null, expectedFailure: null, flow: Object.freeze(flow) });
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
  keyring: DecisionSessionKeyring;
  session: DecisionSessionSnapshot;
  replay: DecisionReplayLedger;
  contentLength: number | null;
  boundaryDurationMilliseconds: number;
  parts: readonly DecisionSubmissionPart[];
  now: number;
  authorize: (fields: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
  run: (fields: Readonly<Record<string, unknown>>) => void | Readonly<{ redirect?: string }> | Promise<void | Readonly<{ redirect?: string }>>;
}>): Promise<DecisionActionOutcome> {
  const flow: DecisionActionFlow[] = [];
  let fields: Readonly<Record<string, unknown>> | null = null;
  try {
    try {
      if (input.method !== "POST") fail("FADENO_ACTION_METHOD");
      if (input.mediaType !== "application/x-www-form-urlencoded" && input.mediaType !== "multipart/form-data") fail("FADENO_ACTION_MEDIA_TYPE");
      if (
        !Number.isSafeInteger(input.boundaryDurationMilliseconds) || input.boundaryDurationMilliseconds < 0 ||
        input.boundaryDurationMilliseconds > maximumBoundaryDurationMilliseconds
      ) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
      const expectedOrigin = new URL(input.expectedOrigin);
      if (
        expectedOrigin.protocol !== "https:" || input.expectedOrigin !== expectedOrigin.origin ||
        input.origin !== input.expectedOrigin
      ) fail("FADENO_ACTION_ORIGIN");
      if (input.routeId !== input.expectedRouteId) fail("FADENO_ACTION_ROUTE");
      assertDecisionSessionOwner(input.session, input.keyring);
      const action = state(input.action);
      fields = decodeFields(action, input.parts, input.contentLength);
      const proof = validateProof({
        proof: input.proof,
        action,
        routeId: input.routeId,
        generation: input.generation,
        session: input.session,
        keyring: input.keyring,
        now: input.now,
      });
      input.replay.consume(proof.replayId, input.session.sessionId, proof.expiresAt, input.now);
      flow.push(Object.freeze({ phase: "boundary", decision: "accepted", cause: "complete-native-request" }));
    } catch (error) {
      return refusal(error instanceof DecisionActionRefusal ? error.code : "FADENO_ACTION_INTERNAL", flow);
    }

    let authorized: boolean;
    try { authorized = await input.authorize(fields); }
    catch {
      flow.push(Object.freeze({ phase: "authorization", decision: "unexpected-failure", cause: "redacted-internal-failure" }));
      return Object.freeze({ status: "unexpected-failure", code: "FADENO_ACTION_INTERNAL", revalidation: "none", redirect: null, fields: null, expectedFailure: null, flow: Object.freeze(flow) });
    }
    if (typeof authorized !== "boolean") {
      flow.push(Object.freeze({ phase: "authorization", decision: "unexpected-failure", cause: "invalid-authorization-result" }));
      return Object.freeze({ status: "unexpected-failure", code: "FADENO_ACTION_INTERNAL", revalidation: "none", redirect: null, fields: null, expectedFailure: null, flow: Object.freeze(flow) });
    }
    if (!authorized) {
      flow.push(Object.freeze({ phase: "authorization", decision: "refused", cause: "application-authorization" }));
      return Object.freeze({ status: "unauthorized", code: "FADENO_ACTION_UNAUTHORIZED", revalidation: "none", redirect: null, fields: null, expectedFailure: null, flow: Object.freeze(flow) });
    }
    flow.push(Object.freeze({ phase: "authorization", decision: "accepted", cause: "application-authorization" }));

    try {
      const result = await input.run(fields);
      flow.push(Object.freeze({ phase: "mutation", decision: "completed", cause: "action-returned" }));
      if (
        result !== undefined &&
        (!plainObject(result) || Object.keys(result).some((name) => name !== "redirect") ||
          (Object.hasOwn(result, "redirect") && typeof ownData(result, "redirect") !== "string"))
      ) fail("FADENO_ACTION_RESULT");
      const completion = result as Readonly<{ redirect?: string }> | undefined;
      let redirect: string | null;
      try { redirect = safeRedirect(completion?.redirect, input.expectedOrigin); }
      catch {
        flow.push(Object.freeze({ phase: "completion", decision: "refused", cause: "FADENO_ACTION_REDIRECT" }));
        return Object.freeze({
          status: "refused",
          code: "FADENO_ACTION_REDIRECT",
          revalidation: "complete",
          redirect: null,
          fields: null,
          expectedFailure: null,
          flow: Object.freeze(flow),
        });
      }
      flow.push(Object.freeze({ phase: "completion", decision: redirect ? "redirect-303" : "render", cause: "complete-revalidation" }));
      return Object.freeze({ status: "success", code: "FADENO_ACTION_OK", revalidation: "complete", redirect, fields, expectedFailure: null, flow: Object.freeze(flow) });
    } catch (error) {
      const expected = error && typeof error === "object" ? expectedFailures.get(error) : undefined;
      if (expected && Object.keys(expected.fieldErrors).every((name) => Object.hasOwn(state(input.action).fields, name))) {
        flow.push(Object.freeze({ phase: "mutation", decision: "expected-failure", cause: expected.code }));
        return Object.freeze({
          status: "expected-failure",
          code: expected.code,
          revalidation: expected.changed ? "complete" : "none",
          redirect: null,
          fields: expectedFailureFields(state(input.action), fields),
          expectedFailure: expected,
          flow: Object.freeze(flow),
        });
      }
      flow.push(Object.freeze({ phase: "mutation", decision: "unexpected-failure", cause: "redacted-internal-failure" }));
      return Object.freeze({ status: "unexpected-failure", code: "FADENO_ACTION_INTERNAL", revalidation: "complete", redirect: null, fields: null, expectedFailure: null, flow: Object.freeze(flow) });
    }
  } finally {
    cleanupUploads(input.parts);
  }
}
