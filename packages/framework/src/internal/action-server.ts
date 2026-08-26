import { createHash } from "node:crypto";

import type {
  ActionDeclaration,
  ActionFieldToken,
  ActionUpload,
  Handler,
  Session,
  SessionValue,
  SessionView,
} from "../index.ts";
import {
  readActionError,
  readActionFieldToken,
  readActionState,
  registeredActionStates,
  type ActionState,
} from "./action.ts";
import {
  bindActionRequestContext,
  type ActionRenderFailure,
  type ActionFormRendering,
  type ActionRequestContext,
} from "./action-request.ts";
import {
  createDecisionAction,
  decisionActionFailure,
  decisionCheckboxField,
  decisionFileField,
  decisionIntegerField,
  decisionTextField,
  DecisionReplayLedger,
  executeDecisionAction,
  issueDecisionActionProof,
  type DecisionAction,
  type DecisionActionOutcome,
  type DecisionSubmissionPart,
} from "./action-decision.ts";
import { actionLimits } from "./action-limits.ts";
import { installActionServerRuntimeFactory } from "./action-server-hook.ts";
import { reportFrameworkFailure, type FrameworkFailureObserver } from "./failure-observer.ts";
import { protectedOrigin } from "./protected-origin.ts";
import { readRedirectOutcome } from "./render-route.ts";
import {
  attachPrivateServerUpdateActionEvidence,
  attachPrivateServerUpdateRouteEvidence,
  copyPrivateServerUpdateEvidence,
  forwardPrivateServerUpdateOperation,
  type PrivateServerUpdateActionEvidence,
} from "./server-update.ts";
import {
  createDecisionSession,
  createDecisionSessionKeyring,
  formatDecisionSessionCookie,
  formatDecisionSessionDeletionCookie,
  normalizeDecisionSessionValues,
  openDecisionSession,
  renewDecisionSession,
  type DecisionSessionKeyring,
  type DecisionSessionSnapshot,
  type DecisionSessionValue,
} from "./session-decision.ts";

const actionPrefix = "/.fadeno/actions/v1/";
const proofField = "__fadeno_proof";
const { maximumBodyBytes, maximumBoundaryDurationMilliseconds, maximumParts } = actionLimits;
const maximumLocationBytes = 2_048;
const maximumCookieHeaderBytes = 16 * 1_024;
const maximumSessionKeyBytes = 128;
const maximumFormIndex = 4_095;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type Invoke = (request: Request) => Promise<Response>;
type RuntimeAction = Readonly<{ state: ActionState; decision: DecisionAction }>;
type RuntimeFlow = Readonly<{
  code: string;
  status: DecisionActionOutcome["status"] | "refused";
  revalidation: "complete" | "none";
  routeId: string | null;
  outcome: string;
}>;

const uploadBytes = new WeakMap<object, Uint8Array>();

function fail(code: string): never { throw new TypeError(code); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function canonicalBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail("FADENO_SESSION_KEYS");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) fail("FADENO_SESSION_KEYS");
  return bytes;
}
function parseKeyring(source: string): DecisionSessionKeyring {
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source) > 1_024) fail("FADENO_SESSION_KEYS");
  const entries = source.split(",");
  return createDecisionSessionKeyring(entries.map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1 || separator !== entry.lastIndexOf(":")) fail("FADENO_SESSION_KEYS");
    return Object.freeze({ id: entry.slice(0, separator), key: canonicalBase64url(entry.slice(separator + 1)) });
  }));
}
function objectValues(value: DecisionSessionValue): Readonly<Record<string, DecisionSessionValue>> | null {
  return plain(value) ? value as Readonly<Record<string, DecisionSessionValue>> : null;
}
export function decodeSessionCookieHeader(header: string | null): string | undefined {
  if (header === null) return undefined;
  if (Buffer.byteLength(header) > maximumCookieHeaderBytes) fail("FADENO_SESSION_COOKIE");
  let found: string | undefined;
  for (const item of header.split(";")) {
    const pair = item.trim();
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== "__Host-fadeno-session") continue;
    if (found !== undefined) fail("FADENO_SESSION_COOKIE");
    found = pair.slice(separator + 1);
  }
  return found;
}

function cookieValue(request: Request): string | undefined {
  return decodeSessionCookieHeader(request.headers.get("cookie"));
}
function safeKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || encoder.encode(key).byteLength > maximumSessionKeyBytes || key.includes("\0")) {
    fail("FADENO_SESSION_KEY");
  }
}

class ServerSession {
  readonly #keyring: DecisionSessionKeyring;
  readonly #opened: "valid" | "renew" | "missing" | "expired" | "invalid";
  readonly #initial: DecisionSessionSnapshot;
  #current: Readonly<Record<string, DecisionSessionValue>>;
  #dirty = false;
  #rotated = false;
  #initialEnvelope: string | null;
  #publication: Readonly<{ snapshot: DecisionSessionSnapshot; envelope: string }> | null = null;

  private constructor(
    keyring: DecisionSessionKeyring,
    opened: "valid" | "renew" | "missing" | "expired" | "invalid",
    snapshot: DecisionSessionSnapshot,
    envelope: string | null,
  ) {
    this.#keyring = keyring;
    this.#opened = opened;
    this.#initial = snapshot;
    this.#current = objectValues(snapshot.values) ?? Object.freeze(Object.create(null) as Record<string, never>);
    this.#initialEnvelope = envelope;
  }

  static open(keyring: DecisionSessionKeyring, request: Request, now: number): ServerSession {
    let value: string | undefined;
    try { value = cookieValue(request); } catch { value = "invalid"; }
    const opened = openDecisionSession(keyring, value, now);
    if (opened.snapshot && objectValues(opened.snapshot.values)) {
      return new ServerSession(keyring, opened.status, opened.snapshot, null);
    }
    const created = createDecisionSession(keyring, Object.freeze(Object.create(null) as Record<string, never>), now);
    return new ServerSession(keyring, opened.status, created.snapshot, opened.status === "missing" ? created.envelope : null);
  }

  readonly view: SessionView = Object.freeze({
    get: (key: string): SessionValue | undefined => {
      safeKey(key);
      return this.#current[key] as SessionValue | undefined;
    },
    has: (key: string): boolean => {
      safeKey(key);
      return Object.hasOwn(this.#current, key);
    },
  });

  readonly mutable: Session = Object.freeze({
    ...this.view,
    set: (key: string, value: SessionValue): void => {
      safeKey(key);
      const candidate: Record<string, DecisionSessionValue> = Object.assign(Object.create(null), this.#current);
      candidate[key] = value as DecisionSessionValue;
      const normalized = normalizeDecisionSessionValues(candidate);
      const values = objectValues(normalized);
      if (!values) fail("FADENO_SESSION_VALUE");
      this.#current = values;
      this.#dirty = true;
    },
    delete: (key: string): void => {
      safeKey(key);
      if (!Object.hasOwn(this.#current, key)) return;
      const candidate: Record<string, DecisionSessionValue> = Object.assign(Object.create(null), this.#current);
      delete candidate[key];
      const normalized = normalizeDecisionSessionValues(candidate);
      const values = objectValues(normalized);
      if (!values) fail("FADENO_SESSION_VALUE");
      this.#current = values;
      this.#dirty = true;
    },
    clear: (): void => {
      this.#current = Object.freeze(Object.create(null) as Record<string, never>);
      this.#dirty = true;
    },
    rotate: (): void => {
      this.#rotated = true;
      this.#dirty = true;
    },
  });

  get snapshot(): DecisionSessionSnapshot { return this.#publication?.snapshot ?? this.#initial; }
  get dirty(): boolean { return this.#dirty; }
  get requiresClear(): boolean { return this.#opened === "expired" || this.#opened === "invalid"; }

  acceptMutation(now: number): boolean {
    if (now >= this.#initial.expiresAt) {
      const created = createDecisionSession(
        this.#keyring,
        Object.freeze(Object.create(null) as Record<string, never>),
        now,
      );
      this.#current = Object.freeze(Object.create(null) as Record<string, never>);
      this.#dirty = false;
      this.#rotated = false;
      this.#publication = Object.freeze(created);
      return false;
    }
    if (!this.#dirty) return true;
    const renewed = renewDecisionSession(
      this.#keyring,
      this.#initial,
      this.#current,
      now,
      this.#rotated ? "privilege-change" : "retain-identity",
    );
    this.#publication = Object.freeze(renewed);
    return true;
  }

  discardMutation(): void {
    this.#current = objectValues(this.#initial.values) ?? Object.freeze(Object.create(null) as Record<string, never>);
    this.#dirty = false;
    this.#rotated = false;
    this.#publication = null;
  }

  cookie(now: number): string | null {
    if (this.#publication) {
      return formatDecisionSessionCookie(this.#publication.envelope, now, this.#publication.snapshot.expiresAt);
    }
    let envelope = this.#initialEnvelope;
    let snapshot = this.#initial;
    if (this.#opened === "renew") {
      const renewed = renewDecisionSession(this.#keyring, this.#initial, this.#current, now, "retain-identity");
      envelope = renewed.envelope;
      snapshot = renewed.snapshot;
    }
    if (envelope !== null) return formatDecisionSessionCookie(envelope, now, snapshot.expiresAt);
    if (this.#opened === "expired" || this.#opened === "invalid") return formatDecisionSessionDeletionCookie();
    return null;
  }
}

function decisionAction(state: ActionState): DecisionAction {
  const fields: Record<string, ReturnType<typeof decisionTextField>> = Object.create(null) as Record<string, ReturnType<typeof decisionTextField>>;
  for (const [name, descriptor] of Object.entries(state.descriptors)) {
    if (descriptor.kind === "text") fields[name] = decisionTextField({ required: descriptor.required, maximumBytes: descriptor.maximumBytes });
    else if (descriptor.kind === "integer") fields[name] = decisionIntegerField({
      required: descriptor.required,
      ...(descriptor.minimum === undefined ? {} : { minimum: descriptor.minimum }),
      ...(descriptor.maximum === undefined ? {} : { maximum: descriptor.maximum }),
    });
    else if (descriptor.kind === "checkbox") fields[name] = decisionCheckboxField();
    else fields[name] = decisionFileField({
      required: descriptor.required,
      maximumBytes: descriptor.maximumBytes,
      acceptedTypes: descriptor.acceptedTypes,
    });
  }
  return createDecisionAction(fields);
}

function safeLocation(value: string, canonicalOrigin: string): string {
  if (typeof value !== "string" || value.length === 0 || encoder.encode(value).byteLength > maximumLocationBytes || value.includes("\0")) {
    fail("FADENO_ACTION_ROUTE");
  }
  const url = new URL(value, canonicalOrigin);
  if (url.origin !== canonicalOrigin || url.username || url.password || url.hash) fail("FADENO_ACTION_ROUTE");
  return `${url.pathname}${url.search}`;
}
function routeBinding(routeId: string, returnLocation: string, index: number): string {
  if (typeof routeId !== "string" || routeId.length === 0 || routeId.includes("\0") || encoder.encode(routeId).byteLength > 256) {
    fail("FADENO_ACTION_ROUTE");
  }
  if (!Number.isSafeInteger(index) || index < 0 || index > maximumFormIndex) fail("FADENO_ACTION_ROUTE");
  return createHash("sha256").update(JSON.stringify([routeId, returnLocation, index])).digest("base64url");
}
function formIndex(value: string): number {
  if (!/^(?:0|[1-9][0-9]{0,3})$/u.test(value)) fail("FADENO_ACTION_ROUTE");
  const index = Number(value);
  if (index > maximumFormIndex) fail("FADENO_ACTION_ROUTE");
  return index;
}
function actionPath(id: string, routeId: string, returnLocation: string, index: number): string {
  const query = new URLSearchParams({ route: routeId, return: returnLocation, form: String(index) });
  return `${actionPrefix}${id}?${query}`;
}
function mediaType(request: Request): string {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
function declaredLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) fail("FADENO_ACTION_CONTENT_LENGTH");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximumBodyBytes) fail("FADENO_ACTION_BODY_LIMIT");
  return parsed;
}
async function readBody(request: Request, startedAt: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const remaining = maximumBoundaryDurationMilliseconds - (Date.now() - startedAt);
      if (remaining <= 0) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new TypeError("FADENO_ACTION_BOUNDARY_TIMEOUT")), remaining);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBodyBytes) fail("FADENO_ACTION_BODY_LIMIT");
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A cancelled pending read still owns the lock briefly. */ }
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

type ParsedBody = Readonly<{ proof: string; parts: readonly DecisionSubmissionPart[]; bytes: number }>;

type SemicolonParameter = Readonly<{ name: string; value: string }>;

function semicolonParameters(source: string, code: string): readonly SemicolonParameter[] {
  const parameters: SemicolonParameter[] = [];
  let cursor = source.indexOf(";");
  while (cursor >= 0 && cursor < source.length) {
    cursor += 1;
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    if (cursor === source.length) break;
    const nameStart = cursor;
    while (cursor < source.length && source[cursor] !== "=" && source[cursor] !== ";") cursor += 1;
    if (source[cursor] !== "=") fail(code);
    const name = source.slice(nameStart, cursor).trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) fail(code);
    cursor += 1;
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    let value = "";
    if (source[cursor] === "\"") {
      cursor += 1;
      let closed = false;
      while (cursor < source.length) {
        const character = source[cursor]!;
        cursor += 1;
        if (character === "\"") { closed = true; break; }
        if (character === "\\") {
          if (cursor >= source.length || source[cursor] === "\r" || source[cursor] === "\n") fail(code);
          value += source[cursor]!;
          cursor += 1;
          continue;
        }
        if (character === "\r" || character === "\n") fail(code);
        value += character;
      }
      if (!closed) fail(code);
      while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
      if (cursor < source.length && source[cursor] !== ";") fail(code);
    } else {
      const valueStart = cursor;
      while (cursor < source.length && source[cursor] !== ";") cursor += 1;
      value = source.slice(valueStart, cursor).trim();
      if (value.includes("\"") || value.includes("\r") || value.includes("\n")) fail(code);
    }
    parameters.push(Object.freeze({ name, value }));
  }
  return Object.freeze(parameters);
}

function multipartBoundary(contentType: string): string {
  const boundaries = semicolonParameters(contentType, "FADENO_ACTION_MEDIA_TYPE")
    .filter(({ name }) => name === "boundary")
    .map(({ value }) => value);
  const boundary = boundaries.length === 1 ? boundaries[0] : undefined;
  if (
    !boundary ||
    !/^[A-Za-z0-9'()+_,./:=?-](?:[A-Za-z0-9'()+_,./:=? -]{0,68}[A-Za-z0-9'()+_,./:=?-])?$/u.test(boundary)
  ) fail("FADENO_ACTION_MEDIA_TYPE");
  return boundary;
}

function bytesAt(source: Uint8Array, expected: Uint8Array, index: number): boolean {
  if (index < 0 || index + expected.byteLength > source.byteLength) return false;
  for (let offset = 0; offset < expected.byteLength; offset += 1) {
    if (source[index + offset] !== expected[offset]) return false;
  }
  return true;
}

function findBytes(source: Uint8Array, expected: Uint8Array, start: number): number {
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).indexOf(expected, start);
}

function findMultipartOpeningBoundary(source: Uint8Array, marker: Uint8Array): number {
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  for (let index = bytes.indexOf(marker); index >= 0; index = bytes.indexOf(marker, index + 1)) {
    if (index !== 0 && (index < 2 || source[index - 2] !== 0x0d || source[index - 1] !== 0x0a)) continue;
    const suffix = index + marker.byteLength;
    if (
      (source[suffix] === 0x0d && source[suffix + 1] === 0x0a)
      || (source[suffix] === 0x2d && source[suffix + 1] === 0x2d)
    ) return index;
  }
  return -1;
}

function multipartPartIsFile(headers: string): boolean {
  let contentDisposition: string | undefined;
  let activeName: string | undefined;
  for (const line of headers.split("\r\n")) {
    if (/^[\t ]/u.test(line)) {
      if (activeName === "content-disposition" && contentDisposition !== undefined) {
        contentDisposition += ` ${line.trim()}`;
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) fail("FADENO_ACTION_BODY");
    activeName = line.slice(0, separator).trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(activeName)) fail("FADENO_ACTION_BODY");
    if (activeName !== "content-disposition") continue;
    if (contentDisposition !== undefined) fail("FADENO_ACTION_BODY");
    contentDisposition = line.slice(separator + 1).trim();
  }
  if (contentDisposition === undefined) return false;
  return semicolonParameters(contentDisposition, "FADENO_ACTION_BODY")
    .some(({ name }) => name === "filename" || name === "filename*");
}

function assertMultipartTextEncoding(contentType: string, body: Uint8Array): void {
  if (body.byteLength === 0) return;
  const marker = encoder.encode(`--${multipartBoundary(contentType)}`);
  const delimiter = new Uint8Array(2 + marker.byteLength);
  delimiter.set([0x0d, 0x0a]);
  delimiter.set(marker, 2);
  const headerEndMarker = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);
  let cursor = findMultipartOpeningBoundary(body, marker);
  if (cursor < 0) fail("FADENO_ACTION_BODY");
  let parts = 0;
  for (;;) {
    if (!bytesAt(body, marker, cursor)) fail("FADENO_ACTION_BODY");
    cursor += marker.byteLength;
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) {
      cursor += 2;
      while (body[cursor] === 0x20 || body[cursor] === 0x09) cursor += 1;
      if (cursor === body.byteLength) return;
      if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) return;
      fail("FADENO_ACTION_BODY");
    }
    if (body[cursor] !== 0x0d || body[cursor + 1] !== 0x0a) fail("FADENO_ACTION_BODY");
    const headerStart = cursor + 2;
    const headerEnd = findBytes(body, headerEndMarker, headerStart);
    if (headerEnd < 0) fail("FADENO_ACTION_BODY");
    let headers: string;
    try { headers = decoder.decode(body.subarray(headerStart, headerEnd)); }
    catch { fail("FADENO_ACTION_BODY"); }
    const valueStart = headerEnd + headerEndMarker.byteLength;
    const valueEnd = findBytes(body, delimiter, valueStart);
    if (valueEnd < 0) fail("FADENO_ACTION_BODY");
    if (!multipartPartIsFile(headers)) {
      try { decoder.decode(body.subarray(valueStart, valueEnd)); }
      catch { fail("FADENO_ACTION_BODY"); }
    }
    parts += 1;
    if (parts > maximumParts + 1) fail("FADENO_ACTION_BODY_LIMIT");
    cursor = valueEnd + 2;
  }
}

function assertBoundedPartFraming(type: string, contentType: string, body: Uint8Array): void {
  if (body.byteLength === 0) return;
  const maximumFramedParts = maximumParts + 1; // Application fields plus the framework proof.
  if (type === "application/x-www-form-urlencoded") {
    let parts = 1;
    for (const byte of body) {
      if (byte === 0x26 && (parts += 1) > maximumFramedParts) fail("FADENO_ACTION_BODY_LIMIT");
    }
    return;
  }
  const boundary = multipartBoundary(contentType);
  const marker = encoder.encode(`--${boundary}`);
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  let delimiters = 0;
  for (let index = bytes.indexOf(marker); index >= 0; index = bytes.indexOf(marker, index + 1)) {
    if (index !== 0 && (index < 2 || body[index - 2] !== 0x0d || body[index - 1] !== 0x0a)) continue;
    if ((delimiters += 1) > maximumFramedParts + 1) fail("FADENO_ACTION_BODY_LIMIT");
  }
}

function assertUrlEncodedTextEncoding(source: string): void {
  for (const field of source.split("&")) {
    const separator = field.indexOf("=");
    const name = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? "" : field.slice(separator + 1);
    try {
      decodeURIComponent(name.replaceAll("+", " "));
      decodeURIComponent(value.replaceAll("+", " "));
    } catch {
      fail("FADENO_ACTION_BODY");
    }
  }
}

async function parseBody(request: Request, state: ActionState, startedAt: number): Promise<ParsedBody> {
  const declared = declaredLength(request);
  const body = await readBody(request, startedAt);
  if (declared !== null && body.byteLength > declared) fail("FADENO_ACTION_CONTENT_LENGTH");
  const type = mediaType(request);
  const contentType = request.headers.get("content-type") ?? "";
  assertBoundedPartFraming(type, contentType, body);
  const values: [string, string | File][] = [];
  if (type === "application/x-www-form-urlencoded") {
    let source: string;
    try { source = decoder.decode(body); } catch { fail("FADENO_ACTION_BODY"); }
    assertUrlEncodedTextEncoding(source);
    for (const entry of new URLSearchParams(source)) values.push(entry);
  } else if (type === "multipart/form-data") {
    assertMultipartTextEncoding(contentType, body);
    let parsed: FormData;
    try {
      parsed = await new Request(request.url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: body.slice().buffer as ArrayBuffer,
      }).formData();
    } catch {
      fail("FADENO_ACTION_BODY");
    }
    if (Date.now() - startedAt > maximumBoundaryDurationMilliseconds) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
    for (const entry of parsed) values.push(entry);
  } else fail("FADENO_ACTION_MEDIA_TYPE");
  let proof: string | undefined;
  const parts: DecisionSubmissionPart[] = [];
  const cleanups: (() => void)[] = [];
  try {
    for (const [generatedName, value] of values) {
      if (generatedName === proofField) {
        if (proof !== undefined || typeof value !== "string") fail("FADENO_ACTION_PROOF");
        proof = value;
        continue;
      }
      const logicalName = state.logicalNames.get(generatedName);
      if (logicalName === undefined) fail("FADENO_ACTION_UNEXPECTED_FIELD");
      if (typeof value === "string") {
        parts.push(Object.freeze({ kind: "field", name: logicalName, value }));
        continue;
      }
      if (value.name === "" && value.size === 0) continue;
      let bytes = new Uint8Array(await value.arrayBuffer());
      if (Date.now() - startedAt > maximumBoundaryDurationMilliseconds) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        bytes.fill(0);
        bytes = new Uint8Array();
      };
      cleanups.push(cleanup);
      parts.push(Object.freeze({
        kind: "file",
        name: logicalName,
        upload: Object.freeze({
          originalName: value.name,
          contentType: value.type || "application/octet-stream",
          get bytes() { return bytes; },
          cleanup,
        }),
      }));
    }
    if (proof === undefined) fail("FADENO_ACTION_PROOF");
    return Object.freeze({ proof, parts: Object.freeze(parts), bytes: body.byteLength });
  } catch (error) {
    for (const cleanup of cleanups) cleanup();
    throw error;
  }
}

function publicInput(state: ActionState, decoded: Readonly<Record<string, unknown>>, opened: ActionUpload[]): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(state.descriptors)) {
    const value = decoded[name];
    if (descriptor.kind !== "file" || value === null) { result[name] = value; continue; }
    const file = value as Readonly<{ originalName: string; contentType: string; bytes: Uint8Array }>;
    let bytes = new Uint8Array(file.bytes);
    const upload = Object.freeze({
      originalName: file.originalName,
      contentType: file.contentType,
      size: bytes.byteLength,
      bytes(): Uint8Array {
        const current = uploadBytes.get(upload);
        if (!current) fail("FADENO_ACTION_UPLOAD_CLOSED");
        return new Uint8Array(current);
      },
    }) as ActionUpload;
    uploadBytes.set(upload, bytes);
    opened.push(upload);
    result[name] = upload;
    bytes = new Uint8Array();
  }
  return Object.freeze(result);
}
function closeUploads(uploads: readonly ActionUpload[]): void {
  for (const upload of uploads) {
    const bytes = uploadBytes.get(upload);
    bytes?.fill(0);
    uploadBytes.delete(upload);
  }
}
function safePage(title: string, heading: string, code: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${heading}</h1><p>${code}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
function responseStatus(code: string, status: DecisionActionOutcome["status"] | "refused"): number {
  if (status === "unauthorized") return 403;
  if (status === "unexpected-failure") return 500;
  if (code === "FADENO_ACTION_REPLAY") return 409;
  if (code.endsWith("_LIMIT")) return 413;
  if (code === "FADENO_ACTION_MEDIA_TYPE") return 415;
  return 400;
}
async function consume(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    while (!(await reader.read()).done) { /* Drain without retaining chunks. */ }
  } finally {
    reader.releaseLock();
  }
}
function withCookie(response: Response, cookie: string | null): Response {
  if (cookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return copyPrivateServerUpdateEvidence(
    response,
    new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
  );
}

export class ActionServerRuntime {
  readonly #canonicalOrigin: string;
  readonly #generation: string;
  readonly #allowHttpLoopbackOrigin: boolean;
  readonly #keyring: DecisionSessionKeyring;
  readonly #actions = new Map<string, RuntimeAction>();
  readonly #replay = new DecisionReplayLedger();
  readonly #flows: RuntimeFlow[] = [];
  readonly #now: () => number;

  constructor(options: Readonly<{
    canonicalOrigin: string;
    generation: string;
    sessionKeys: string;
    allowHttpLoopbackOrigin?: boolean;
    now?: () => number;
  }>) {
    if (!protectedOrigin(options.canonicalOrigin, options.allowHttpLoopbackOrigin)) fail("FADENO_ACTION_ORIGIN");
    if (typeof options.generation !== "string" || options.generation.length === 0 || options.generation.includes("\0") || encoder.encode(options.generation).byteLength > 256) {
      fail("FADENO_ACTION_GENERATION");
    }
    this.#canonicalOrigin = options.canonicalOrigin;
    this.#generation = options.generation;
    this.#allowHttpLoopbackOrigin = options.allowHttpLoopbackOrigin === true;
    this.#keyring = parseKeyring(options.sessionKeys);
    this.#now = options.now ?? Date.now;
    for (const state of registeredActionStates()) this.#actions.set(state.id, Object.freeze({ state, decision: decisionAction(state) }));
    if (this.#actions.size === 0) fail("FADENO_ACTION_DECLARATION");
  }

  get flows(): readonly RuntimeFlow[] { return Object.freeze([...this.#flows]); }

  async serve(
    request: Request,
    invoke: Invoke,
    failureObserver?: FrameworkFailureObserver,
  ): Promise<Response> {
    if (new URL(request.url).pathname.startsWith(actionPrefix)) {
      const preflightCode = request.method !== "POST"
        ? "FADENO_ACTION_METHOD"
        : request.headers.get("origin") !== this.#canonicalOrigin
          ? "FADENO_ACTION_ORIGIN"
          : null;
      if (preflightCode) {
        this.#record(preflightCode, "refused", "none", null, "native-boundary-refused");
        return safePage("Action refused", "Action refused", preflightCode, responseStatus(preflightCode, "refused"));
      }
    }
    const now = this.#now();
    const session = ServerSession.open(this.#keyring, request, now);
    if (session.requiresClear) {
      return withCookie(
        safePage("Session refused", "Session refused", "FADENO_SESSION_INVALID", 401),
        session.cookie(now),
      );
    }
    const response = await this.#invokeBound(request, invoke, session, null, true, failureObserver);
    return withCookie(response, session.cookie(this.#now()));
  }

  async #invokeBound(
    request: Request,
    invoke: Invoke,
    session: ServerSession,
    failure: ActionRenderFailure | null,
    intercept: boolean,
    failureObserver?: FrameworkFailureObserver,
  ): Promise<Response> {
    let nextFormIndex = 0;
    const context: ActionRequestContext = Object.freeze({
      session: session.view,
      applicationGeneration: this.#generation,
      renderForm: (
        declaration: ActionDeclaration<Record<string, unknown>>,
        routeId: string,
        returnLocation: string,
      ): ActionFormRendering => {
        const state = readActionState(declaration);
        const runtime = state ? this.#actions.get(state.id) : undefined;
        if (!runtime || runtime.state.declaration !== declaration) fail("FADENO_ACTION_DECLARATION");
        const actionState = runtime.state;
        const location = safeLocation(returnLocation, this.#canonicalOrigin);
        const index = nextFormIndex;
        nextFormIndex += 1;
        const binding = routeBinding(routeId, location, index);
        return Object.freeze({
          actionUrl: actionPath(actionState.id, routeId, location, index),
          encoding: Object.values(actionState.descriptors).some(({ kind }) => kind === "file")
            ? "multipart/form-data"
            : "application/x-www-form-urlencoded",
          proof: issueDecisionActionProof({
            action: runtime.decision,
            routeId: binding,
            generation: this.#generation,
            session: session.snapshot,
            keyring: this.#keyring,
            now: this.#now(),
          }),
          generatedNames: actionState.generatedNames,
          failure: failure?.action === declaration && failure.formIndex === index ? failure : null,
        });
      },
      fieldName: (token: ActionFieldToken<unknown>) => {
        const field = readActionFieldToken(token);
        if (!field) fail("FADENO_ACTION_FIELD_TOKEN");
        const action = readActionState(field.action);
        const state = action ? this.#actions.get(action.id)?.state : undefined;
        const generated = state?.generatedNames[field.logicalName];
        if (!generated) fail("FADENO_ACTION_FIELD_TOKEN");
        return generated;
      },
    });
    const release = bindActionRequestContext(request, context);
    try {
      return intercept && new URL(request.url).pathname.startsWith(actionPrefix)
        ? await this.#handleAction(request, invoke, session, failureObserver)
        : await invoke(request);
    } finally {
      release();
    }
  }

  async #handleAction(
    request: Request,
    invoke: Invoke,
    session: ServerSession,
    failureObserver?: FrameworkFailureObserver,
  ): Promise<Response> {
    const startedAt = this.#now();
    const url = new URL(request.url);
    const id = url.pathname.slice(actionPrefix.length);
    const runtime = this.#actions.get(id);
    const routeId = url.searchParams.get("route");
    const rawReturn = url.searchParams.get("return");
    const rawFormIndex = url.searchParams.get("form");
    if (!runtime || !routeId || !rawReturn || rawFormIndex === null || url.searchParams.size !== 3) {
      this.#record("FADENO_ACTION_ROUTE", "refused", "none", null, "unknown-generated-endpoint");
      return safePage("Action refused", "Action refused", "FADENO_ACTION_ROUTE", 404);
    }
    let returnLocation: string;
    let binding: string;
    let submittedFormIndex: number;
    try {
      returnLocation = safeLocation(rawReturn, this.#canonicalOrigin);
      submittedFormIndex = formIndex(rawFormIndex);
      binding = routeBinding(routeId, returnLocation, submittedFormIndex);
    } catch {
      this.#record("FADENO_ACTION_ROUTE", "refused", "none", null, "invalid-generated-endpoint");
      return safePage("Action refused", "Action refused", "FADENO_ACTION_ROUTE", 400);
    }
    let parsed: ParsedBody;
    try {
      if (request.method !== "POST") fail("FADENO_ACTION_METHOD");
      const expectedOrigin = request.headers.get("origin");
      if (expectedOrigin !== this.#canonicalOrigin) fail("FADENO_ACTION_ORIGIN");
      parsed = await parseBody(request, runtime.state, startedAt);
    } catch (error) {
      const code = error instanceof TypeError && /^FADENO_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "FADENO_ACTION_INTERNAL";
      this.#record(code, "refused", "none", routeId, "native-boundary-refused");
      return safePage("Action refused", "Action refused", code, responseStatus(code, "refused"));
    }
    const openedUploads: ActionUpload[] = [];
    const publicInputs = new WeakMap<object, Readonly<Record<string, unknown>>>();
    const translated = (decoded: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
      const existing = publicInputs.get(decoded);
      if (existing) return existing;
      const value = publicInput(runtime.state, decoded, openedUploads);
      publicInputs.set(decoded, value);
      return value;
    };
    let outcome: DecisionActionOutcome;
    let internalCause: unknown;
    try {
      outcome = await executeDecisionAction({
        action: runtime.decision,
        method: request.method,
        mediaType: mediaType(request),
        origin: request.headers.get("origin"),
        expectedOrigin: this.#canonicalOrigin,
        allowHttpLoopbackOrigin: this.#allowHttpLoopbackOrigin,
        routeId: binding,
        expectedRouteId: binding,
        generation: this.#generation,
        proof: parsed.proof,
        keyring: this.#keyring,
        session: session.snapshot,
        replay: this.#replay,
        contentLength: parsed.bytes,
        boundaryDurationMilliseconds: this.#now() - startedAt,
        parts: parsed.parts,
        now: startedAt,
        authorize: async (decoded) => {
          try {
            return await runtime.state.authorize(Object.freeze({
              request,
              session: session.view,
              input: translated(decoded),
              signal: request.signal,
            })) as boolean;
          } catch (cause) {
            internalCause = cause;
            throw cause;
          }
        },
        run: async (decoded) => {
          try {
            const result = await runtime.state.run(Object.freeze({
              request,
              session: session.mutable,
              input: translated(decoded),
              signal: request.signal,
            }));
            const redirect = readRedirectOutcome(result);
            if (result !== undefined && (!redirect || redirect.status !== 303)) {
              internalCause = new TypeError("FADENO_ACTION_RESULT");
              return Object.freeze({ invalid: true }) as never;
            }
            return redirect ? Object.freeze({ redirect: redirect.location }) : undefined;
          } catch (error) {
            const expected = readActionError(error);
            if (expected) throw decisionActionFailure(expected);
            internalCause = error;
            throw error;
          }
        },
      });
    } finally {
      closeUploads(openedUploads);
    }
    if (session.dirty && outcome.status === "refused" && outcome.code === "FADENO_ACTION_REDIRECT") {
      session.discardMutation();
    } else if (session.dirty && !(outcome.status === "success" || (outcome.status === "expected-failure" && outcome.expectedFailure?.changed))) {
      session.discardMutation();
      outcome = Object.freeze({
        status: "unexpected-failure",
        code: "FADENO_ACTION_INTERNAL",
        revalidation: "complete",
        redirect: null,
        fields: null,
        expectedFailure: null,
        flow: Object.freeze([...outcome.flow, Object.freeze({ phase: "completion", decision: "unexpected-failure", cause: "uncommitted-session-mutation" })]),
      });
    } else if (outcome.status === "success" || (outcome.status === "expected-failure" && outcome.expectedFailure?.changed)) {
      if (!session.acceptMutation(this.#now())) {
        internalCause = new TypeError("FADENO_SESSION_EXPIRED");
        outcome = Object.freeze({
          status: "unexpected-failure",
          code: "FADENO_ACTION_INTERNAL",
          revalidation: "complete",
          redirect: null,
          fields: null,
          expectedFailure: null,
          flow: Object.freeze([...outcome.flow, Object.freeze({ phase: "completion", decision: "unexpected-failure", cause: "session-expired-at-completion" })]),
        });
      }
    } else session.discardMutation();
    let incidentId: string | null = null;
    if (outcome.status === "unexpected-failure") {
      incidentId = globalThis.crypto.randomUUID();
      reportFrameworkFailure(
        failureObserver,
        request,
        incidentId,
        "pre-publication",
        "FADENO_ACTION_INTERNAL",
        internalCause ?? new Error("FADENO_ACTION_INTERNAL"),
      );
    }
    this.#record(outcome.code, outcome.status, outcome.revalidation, routeId, outcome.flow.at(-1)?.decision ?? outcome.status);
    const actionEvidence: PrivateServerUpdateActionEvidence = Object.freeze({
      code: outcome.code,
      status: outcome.status === "unauthorized" || outcome.status === "refused" ? "refused" : outcome.status,
      revalidation: outcome.revalidation,
      outcome: outcome.flow.at(-1)?.decision ?? outcome.status,
    });
    const attachActionEvidence = (
      response: Response,
      routeOutcome: "document" | "expected-error" | "redirect" | "unexpected-error",
    ): Response => {
      attachPrivateServerUpdateRouteEvidence(response, request, {
        routeId,
        generation: this.#generation,
        outcome: routeOutcome,
        ...(outcome.status === "expected-failure" ? { expectedCode: outcome.code } : {}),
        resources: () => Object.freeze([]),
      });
      return attachPrivateServerUpdateActionEvidence(response, request, actionEvidence);
    };

    const failure = outcome.status === "expected-failure" && outcome.expectedFailure && outcome.fields
      ? Object.freeze({
          action: runtime.state.declaration,
          formIndex: submittedFormIndex,
          fields: outcome.fields,
          fieldErrors: outcome.expectedFailure.fieldErrors,
          formErrors: outcome.expectedFailure.formErrors,
          code: outcome.code,
        })
      : null;
    const pageRequest = new Request(new URL(returnLocation, this.#canonicalOrigin), {
      method: "GET",
      headers: this.#pageHeaders(request),
      signal: request.signal,
    });
    const releaseProjection = forwardPrivateServerUpdateOperation(request, pageRequest);
    try {
      if (outcome.status === "expected-failure") {
        return attachActionEvidence(
          await this.#invokeBound(pageRequest, invoke, session, failure, false, failureObserver),
          "expected-error",
        );
      }
      if (outcome.revalidation === "complete") {
        const revalidated = await this.#invokeBound(pageRequest, invoke, session, null, false, failureObserver);
        if (outcome.status === "success" && outcome.redirect === null) {
          return attachActionEvidence(revalidated, "document");
        }
        if (revalidated.status >= 400) {
          return attachActionEvidence(
            revalidated,
            outcome.status === "unexpected-failure" ? "unexpected-error" : "expected-error",
          );
        }
        await consume(revalidated);
      }
      if (outcome.status === "success" && outcome.redirect !== null) {
        return attachActionEvidence(
          new Response(null, { status: 303, headers: { location: outcome.redirect } }),
          "redirect",
        );
      }
      return attachActionEvidence(safePage(
        outcome.status === "unexpected-failure" ? "Action failed" : "Action refused",
        outcome.status === "unexpected-failure" ? "Action failed" : "Action refused",
        incidentId === null ? outcome.code : `Incident ${incidentId}`,
        responseStatus(outcome.code, outcome.status),
      ), outcome.status === "unexpected-failure" ? "unexpected-error" : "expected-error");
    } finally {
      releaseProjection();
    }
  }

  #pageHeaders(request: Request): Headers {
    const headers = new Headers(request.headers);
    for (const name of ["content-length", "content-type", "origin"]) headers.delete(name);
    return headers;
  }

  #record(
    code: string,
    status: RuntimeFlow["status"],
    revalidation: RuntimeFlow["revalidation"],
    routeId: string | null,
    outcome: string,
  ): void {
    this.#flows.push(Object.freeze({ code, status, revalidation, routeId, outcome }));
    if (this.#flows.length > 256) this.#flows.shift();
  }
}

export function createActionServerRuntime(options: Readonly<{
  canonicalOrigin?: string;
  applicationGeneration?: string;
  sessionKeys?: string;
  allowHttpLoopbackOrigin?: boolean;
}>): ActionServerRuntime | null {
  if (registeredActionStates().length === 0) return null;
  if (!options.canonicalOrigin || !options.applicationGeneration || !options.sessionKeys) {
    fail("FADENO_ACTION_RUNTIME_CONFIG");
  }
  return new ActionServerRuntime({
    canonicalOrigin: options.canonicalOrigin,
    generation: options.applicationGeneration,
    sessionKeys: options.sessionKeys,
    ...(options.allowHttpLoopbackOrigin === undefined ? {} : {
      allowHttpLoopbackOrigin: options.allowHttpLoopbackOrigin,
    }),
  });
}

export type ActionServerInvoke = (request: Request, handler: Handler) => Promise<Response>;

export function registerActionServerRuntime(): void {
  installActionServerRuntimeFactory(createActionServerRuntime);
}
