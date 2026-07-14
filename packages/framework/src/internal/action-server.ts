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
import { readRedirectOutcome } from "./render-route.ts";
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
const maximumBodyBytes = 8 * 1_024 * 1_024;
const maximumBoundaryMilliseconds = 5_000;
const maximumLocationBytes = 2_048;
const maximumCookieHeaderBytes = 16 * 1_024;
const maximumSessionKeyBytes = 128;
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
function cookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie");
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
  #accepted = false;
  #initialEnvelope: string | null;

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
    return new ServerSession(keyring, opened.status, created.snapshot, created.envelope);
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

  get snapshot(): DecisionSessionSnapshot { return this.#initial; }
  get dirty(): boolean { return this.#dirty; }

  acceptMutation(): void { this.#accepted = true; }

  discardMutation(): void {
    this.#current = objectValues(this.#initial.values) ?? Object.freeze(Object.create(null) as Record<string, never>);
    this.#dirty = false;
    this.#rotated = false;
    this.#accepted = false;
  }

  cookie(now: number): string | null {
    let envelope = this.#initialEnvelope;
    let snapshot = this.#initial;
    if (this.#accepted && this.#dirty) {
      const renewed = renewDecisionSession(
        this.#keyring,
        this.#initial,
        this.#current,
        now,
        this.#rotated ? "privilege-change" : "retain-identity",
      );
      envelope = renewed.envelope;
      snapshot = renewed.snapshot;
    } else if (this.#opened === "renew") {
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
function routeBinding(routeId: string, returnLocation: string): string {
  if (typeof routeId !== "string" || routeId.length === 0 || routeId.includes("\0") || encoder.encode(routeId).byteLength > 256) {
    fail("FADENO_ACTION_ROUTE");
  }
  return JSON.stringify([routeId, returnLocation]);
}
function actionPath(id: string, routeId: string, returnLocation: string): string {
  const query = new URLSearchParams({ route: routeId, return: returnLocation });
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
      const remaining = maximumBoundaryMilliseconds - (Date.now() - startedAt);
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

async function parseBody(request: Request, state: ActionState, startedAt: number): Promise<ParsedBody> {
  const declared = declaredLength(request);
  const body = await readBody(request, startedAt);
  if (declared !== null && body.byteLength > declared) fail("FADENO_ACTION_CONTENT_LENGTH");
  const type = mediaType(request);
  const values: [string, string | File][] = [];
  if (type === "application/x-www-form-urlencoded") {
    for (const entry of new URLSearchParams(decoder.decode(body))) values.push(entry);
  } else if (type === "multipart/form-data") {
    const parsed = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: body.slice().buffer as ArrayBuffer,
    }).formData();
    if (Date.now() - startedAt > maximumBoundaryMilliseconds) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
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
      const logicalName = state.logicalNames.get(generatedName) ?? generatedName;
      if (typeof value === "string") {
        parts.push(Object.freeze({ kind: "field", name: logicalName, value }));
        continue;
      }
      if (value.name === "" && value.size === 0) continue;
      let bytes = new Uint8Array(await value.arrayBuffer());
      if (Date.now() - startedAt > maximumBoundaryMilliseconds) fail("FADENO_ACTION_BOUNDARY_TIMEOUT");
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
  if (response.body) await response.arrayBuffer();
}
function withCookie(response: Response, cookie: string | null): Response {
  if (cookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export class ActionServerRuntime {
  readonly #canonicalOrigin: string;
  readonly #generation: string;
  readonly #keyring: DecisionSessionKeyring;
  readonly #actions = new Map<string, RuntimeAction>();
  readonly #replay = new DecisionReplayLedger();
  readonly #flows: RuntimeFlow[] = [];

  constructor(options: Readonly<{ canonicalOrigin: string; generation: string; sessionKeys: string }>) {
    const origin = new URL(options.canonicalOrigin);
    if (origin.protocol !== "https:" || origin.origin !== options.canonicalOrigin || origin.username || origin.password) {
      fail("FADENO_ACTION_ORIGIN");
    }
    if (typeof options.generation !== "string" || options.generation.length === 0 || options.generation.includes("\0") || encoder.encode(options.generation).byteLength > 256) {
      fail("FADENO_ACTION_GENERATION");
    }
    this.#canonicalOrigin = options.canonicalOrigin;
    this.#generation = options.generation;
    this.#keyring = parseKeyring(options.sessionKeys);
    for (const state of registeredActionStates()) this.#actions.set(state.id, Object.freeze({ state, decision: decisionAction(state) }));
    if (this.#actions.size === 0) fail("FADENO_ACTION_DECLARATION");
  }

  get flows(): readonly RuntimeFlow[] { return Object.freeze([...this.#flows]); }

  async serve(request: Request, invoke: Invoke): Promise<Response> {
    const now = Date.now();
    const session = ServerSession.open(this.#keyring, request, now);
    const response = await this.#invokeBound(request, invoke, session, null, true);
    return withCookie(response, session.cookie(Date.now()));
  }

  async #invokeBound(
    request: Request,
    invoke: Invoke,
    session: ServerSession,
    failure: ActionRenderFailure | null,
    intercept: boolean,
  ): Promise<Response> {
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
        const binding = routeBinding(routeId, location);
        return Object.freeze({
          actionUrl: actionPath(actionState.id, routeId, location),
          encoding: Object.values(actionState.descriptors).some(({ kind }) => kind === "file")
            ? "multipart/form-data"
            : "application/x-www-form-urlencoded",
          proof: issueDecisionActionProof({
            action: runtime.decision,
            routeId: binding,
            generation: this.#generation,
            session: session.snapshot,
            keyring: this.#keyring,
            now: Date.now(),
          }),
          generatedNames: actionState.generatedNames,
          failure: failure?.action === declaration ? failure : null,
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
        ? await this.#handleAction(request, invoke, session)
        : await invoke(request);
    } finally {
      release();
    }
  }

  async #handleAction(request: Request, invoke: Invoke, session: ServerSession): Promise<Response> {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const id = url.pathname.slice(actionPrefix.length);
    const runtime = this.#actions.get(id);
    const routeId = url.searchParams.get("route");
    const rawReturn = url.searchParams.get("return");
    if (!runtime || !routeId || !rawReturn || url.searchParams.size !== 2) {
      this.#record("FADENO_ACTION_ROUTE", "refused", "none", null, "unknown-generated-endpoint");
      return safePage("Action refused", "Action refused", "FADENO_ACTION_ROUTE", 404);
    }
    let returnLocation: string;
    let binding: string;
    try {
      returnLocation = safeLocation(rawReturn, this.#canonicalOrigin);
      binding = routeBinding(routeId, returnLocation);
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
    try {
      outcome = await executeDecisionAction({
        action: runtime.decision,
        method: request.method,
        mediaType: mediaType(request),
        origin: request.headers.get("origin"),
        expectedOrigin: this.#canonicalOrigin,
        routeId: binding,
        expectedRouteId: binding,
        generation: this.#generation,
        proof: parsed.proof,
        keyring: this.#keyring,
        session: session.snapshot,
        replay: this.#replay,
        contentLength: parsed.bytes,
        boundaryDurationMilliseconds: Date.now() - startedAt,
        parts: parsed.parts,
        now: startedAt,
        authorize: async (decoded) => runtime.state.authorize(Object.freeze({
          request,
          session: session.view,
          input: translated(decoded),
          signal: request.signal,
        })) as boolean | Promise<boolean>,
        run: async (decoded) => {
          try {
            const result = await runtime.state.run(Object.freeze({
              request,
              session: session.mutable,
              input: translated(decoded),
              signal: request.signal,
            }));
            const redirect = readRedirectOutcome(result);
            if (result !== undefined && (!redirect || redirect.status !== 303)) return Object.freeze({ invalid: true }) as never;
            return redirect ? Object.freeze({ redirect: redirect.location }) : undefined;
          } catch (error) {
            const expected = readActionError(error);
            if (expected) throw decisionActionFailure(expected);
            throw error;
          }
        },
      });
    } finally {
      closeUploads(openedUploads);
    }
    if (session.dirty && !(outcome.status === "success" || (outcome.status === "expected-failure" && outcome.expectedFailure?.changed))) {
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
      session.acceptMutation();
    } else session.discardMutation();
    this.#record(outcome.code, outcome.status, outcome.revalidation, routeId, outcome.flow.at(-1)?.decision ?? outcome.status);

    const failure = outcome.status === "expected-failure" && outcome.expectedFailure && outcome.fields
      ? Object.freeze({
          action: runtime.state.declaration,
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
    if (outcome.status === "expected-failure") {
      return this.#invokeBound(pageRequest, invoke, session, failure, false);
    }
    if (outcome.revalidation === "complete") {
      const revalidated = await this.#invokeBound(pageRequest, invoke, session, null, false);
      if (outcome.status === "success" && outcome.redirect === null) return revalidated;
      if (revalidated.status >= 400) return revalidated;
      await consume(revalidated);
    }
    if (outcome.status === "success" && outcome.redirect !== null) {
      return new Response(null, { status: 303, headers: { location: outcome.redirect } });
    }
    return safePage(
      outcome.status === "unexpected-failure" ? "Action failed" : "Action refused",
      outcome.status === "unexpected-failure" ? "Action failed" : "Action refused",
      outcome.code,
      responseStatus(outcome.code, outcome.status),
    );
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
}>): ActionServerRuntime | null {
  if (registeredActionStates().length === 0) return null;
  if (!options.canonicalOrigin || !options.applicationGeneration || !options.sessionKeys) {
    fail("FADENO_ACTION_RUNTIME_CONFIG");
  }
  return new ActionServerRuntime({
    canonicalOrigin: options.canonicalOrigin,
    generation: options.applicationGeneration,
    sessionKeys: options.sessionKeys,
  });
}

export type ActionServerInvoke = (request: Request, handler: Handler) => Promise<Response>;
