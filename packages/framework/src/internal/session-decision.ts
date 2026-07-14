import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";

const cookieName = "__Host-fadeno-session";
const envelopeVersion = "v1";
const maximumKeys = 4;
const maximumCookieBytes = 4_096;
const maximumEnvelopeBytes = maximumCookieBytes - Buffer.byteLength(cookieName) - 1;
const maximumValueBytes = 2_048;
const maximumValueDepth = 16;
const maximumValueEntries = 256;
const sessionLifetimeMilliseconds = 12 * 60 * 60 * 1_000;
const encoder = new TextEncoder();
const actionProofPurpose = Buffer.from("fadeno:action-proof:v1", "utf8");

export type DecisionSessionValue =
  | null
  | boolean
  | number
  | string
  | readonly DecisionSessionValue[]
  | Readonly<{ [key: string]: DecisionSessionValue }>;

export const decisionSessionLimits = Object.freeze({
  maximumKeys,
  maximumCookieBytes,
  maximumValueBytes,
  maximumValueDepth,
  maximumValueEntries,
  sessionLifetimeMilliseconds,
});

type KeyState = Readonly<{ id: string; bytes: Buffer }>;
type KeyringState = Readonly<{ active: KeyState; byId: ReadonlyMap<string, KeyState> }>;
const keyrings = new WeakMap<object, KeyringState>();
const sessionOwners = new WeakMap<object, DecisionSessionKeyring>();

export interface DecisionSessionKeyring { readonly decisionSessionKeyring: unique symbol }

export type DecisionSessionSnapshot = Readonly<{
  sessionId: string;
  csrfSecret: string;
  createdAt: number;
  expiresAt: number;
  values: DecisionSessionValue;
}>;

export type DecisionSessionOpenResult = Readonly<
  | { status: "valid" | "renew"; snapshot: DecisionSessionSnapshot; clearCookie: false }
  | { status: "missing"; snapshot: null; clearCookie: false }
  | { status: "expired" | "invalid"; snapshot: null; clearCookie: true }
>;

function fail(code: string): never { throw new TypeError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
function decodeBase64url(value: string, code: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail(code);
  const bytes = Buffer.from(value, "base64url");
  if (base64url(bytes) !== value) fail(code);
  return bytes;
}

function plainObject(value: object): boolean {
  if (isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValues(value: unknown): Readonly<{ value: DecisionSessionValue; json: string }> {
  let entries = 0;
  let scalarBytes = 0;
  const active = new Set<object>();
  const addBytes = (bytes: number): void => {
    if (bytes > maximumValueBytes - scalarBytes) fail("FADENO_SESSION_VALUE_LIMIT");
    scalarBytes += bytes;
  };
  const visit = (current: unknown, depth: number): DecisionSessionValue => {
    entries += 1;
    if (entries > maximumValueEntries || depth > maximumValueDepth) fail("FADENO_SESSION_VALUE_LIMIT");
    if (current === null) return null;
    if (typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail("FADENO_SESSION_VALUE");
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current === "string") {
      addBytes(encoder.encode(current).byteLength);
      return current;
    }
    if (typeof current !== "object" || isProxy(current) || active.has(current)) fail("FADENO_SESSION_VALUE");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) fail("FADENO_SESSION_VALUE");
        const result: DecisionSessionValue[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("FADENO_SESSION_VALUE");
          result.push(visit(descriptor.value, depth + 1));
        }
        let ownKeys = 0;
        for (const name in current) {
          if (!Object.hasOwn(current, name)) continue;
          ownKeys += 1;
          if (ownKeys > current.length || !/^(0|[1-9][0-9]*)$/u.test(name) || Number(name) >= current.length) {
            fail("FADENO_SESSION_VALUE");
          }
        }
        if (ownKeys !== current.length) fail("FADENO_SESSION_VALUE");
        return Object.freeze(result);
      }
      if (!plainObject(current)) fail("FADENO_SESSION_VALUE");
      const result: Record<string, DecisionSessionValue> = Object.create(null) as Record<string, DecisionSessionValue>;
      const names: string[] = [];
      for (const name in current) {
        if (!Object.hasOwn(current, name)) continue;
        names.push(name);
        if (names.length > maximumValueEntries - entries) fail("FADENO_SESSION_VALUE_LIMIT");
      }
      names.sort(compareText);
      for (const name of names) {
        addBytes(encoder.encode(name).byteLength);
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("FADENO_SESSION_VALUE");
        result[name] = visit(descriptor.value, depth + 1);
      }
      return Object.freeze(result);
    } finally {
      active.delete(current);
    }
  };
  const normalized = visit(value, 0);
  const json = JSON.stringify(normalized);
  if (encoder.encode(json).byteLength > maximumValueBytes) fail("FADENO_SESSION_VALUE_LIMIT");
  return Object.freeze({ value: normalized, json });
}

export function createDecisionSessionKeyring(
  keys: readonly Readonly<{ id: string; key: Uint8Array }>[],
): DecisionSessionKeyring {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > maximumKeys) fail("FADENO_SESSION_KEYS");
  const states = keys.map(({ id, key }): KeyState => {
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(id) || !(key instanceof Uint8Array) || key.byteLength !== 32) {
      fail("FADENO_SESSION_KEYS");
    }
    return Object.freeze({ id, bytes: Buffer.from(key) });
  });
  if (new Set(states.map(({ id }) => id)).size !== states.length) fail("FADENO_SESSION_KEYS");
  const keyring = Object.freeze(Object.create(null) as object) as DecisionSessionKeyring;
  keyrings.set(keyring, Object.freeze({ active: states[0]!, byId: new Map(states.map((state) => [state.id, state])) }));
  return keyring;
}

function keyringState(keyring: DecisionSessionKeyring): KeyringState {
  const state = keyrings.get(keyring);
  if (!state) fail("FADENO_SESSION_KEYS");
  return state;
}

function snapshot(values: unknown, now: number, identity?: Readonly<{ sessionId: string; csrfSecret: string; createdAt: number }>): DecisionSessionSnapshot {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - sessionLifetimeMilliseconds) fail("FADENO_SESSION_TIME");
  const normalized = normalizeValues(values);
  return Object.freeze({
    sessionId: identity?.sessionId ?? base64url(randomBytes(32)),
    csrfSecret: identity?.csrfSecret ?? base64url(randomBytes(32)),
    createdAt: identity?.createdAt ?? now,
    expiresAt: (identity?.createdAt ?? now) + sessionLifetimeMilliseconds,
    values: normalized.value,
  });
}

function seal(keyring: DecisionSessionKeyring, session: DecisionSessionSnapshot): string {
  const key = keyringState(keyring).active;
  const iv = randomBytes(12);
  const aad = Buffer.from(`${cookieName}:${envelopeVersion}:${key.id}`, "utf8");
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    sessionId: session.sessionId,
    csrfSecret: session.csrfSecret,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    values: session.values,
  }), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = [envelopeVersion, key.id, base64url(iv), base64url(encrypted), base64url(cipher.getAuthTag())].join(".");
  if (Buffer.byteLength(envelope) > maximumEnvelopeBytes) fail("FADENO_SESSION_COOKIE_LIMIT");
  return envelope;
}

export function createDecisionSession(
  keyring: DecisionSessionKeyring,
  values: DecisionSessionValue,
  now: number,
): Readonly<{ envelope: string; snapshot: DecisionSessionSnapshot }> {
  const created = snapshot(values, now);
  sessionOwners.set(created, keyring);
  return Object.freeze({ envelope: seal(keyring, created), snapshot: created });
}

function parseSnapshot(value: unknown): DecisionSessionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("FADENO_SESSION_COOKIE");
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort(compareText).join("\0") !== "createdAt\0csrfSecret\0expiresAt\0sessionId\0values\0version") {
    fail("FADENO_SESSION_COOKIE");
  }
  if (
    root["version"] !== 1 || typeof root["sessionId"] !== "string" || typeof root["csrfSecret"] !== "string" ||
    decodeBase64url(root["sessionId"], "FADENO_SESSION_COOKIE").byteLength !== 32 ||
    decodeBase64url(root["csrfSecret"], "FADENO_SESSION_COOKIE").byteLength !== 32 ||
    !Number.isSafeInteger(root["createdAt"]) || !Number.isSafeInteger(root["expiresAt"]) ||
    (root["createdAt"] as number) < 0 || (root["expiresAt"] as number) !== (root["createdAt"] as number) + sessionLifetimeMilliseconds
  ) fail("FADENO_SESSION_COOKIE");
  const values = normalizeValues(root["values"]).value;
  return Object.freeze({
    sessionId: root["sessionId"],
    csrfSecret: root["csrfSecret"],
    createdAt: root["createdAt"],
    expiresAt: root["expiresAt"],
    values,
  }) as DecisionSessionSnapshot;
}

export function openDecisionSession(
  keyring: DecisionSessionKeyring,
  envelope: string | undefined,
  now: number,
): DecisionSessionOpenResult {
  if (!Number.isSafeInteger(now) || now < 0) fail("FADENO_SESSION_TIME");
  if (envelope === undefined) return Object.freeze({ status: "missing", snapshot: null, clearCookie: false });
  try {
    if (typeof envelope !== "string" || Buffer.byteLength(envelope) > maximumEnvelopeBytes) fail("FADENO_SESSION_COOKIE");
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== envelopeVersion) fail("FADENO_SESSION_COOKIE");
    const state = keyringState(keyring);
    const key = state.byId.get(parts[1]!);
    if (!key) fail("FADENO_SESSION_COOKIE");
    const iv = decodeBase64url(parts[2]!, "FADENO_SESSION_COOKIE");
    const encrypted = decodeBase64url(parts[3]!, "FADENO_SESSION_COOKIE");
    const tag = decodeBase64url(parts[4]!, "FADENO_SESSION_COOKIE");
    if (iv.byteLength !== 12 || tag.byteLength !== 16) fail("FADENO_SESSION_COOKIE");
    const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv);
    decipher.setAAD(Buffer.from(`${cookieName}:${envelopeVersion}:${key.id}`, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (plaintext.byteLength > maximumValueBytes + 1_024) fail("FADENO_SESSION_COOKIE_LIMIT");
    const opened = parseSnapshot(JSON.parse(plaintext.toString("utf8")) as unknown);
    if (now >= opened.expiresAt) return Object.freeze({ status: "expired", snapshot: null, clearCookie: true });
    sessionOwners.set(opened, keyring);
    return Object.freeze({
      status: key.id === state.active.id ? "valid" : "renew",
      snapshot: opened,
      clearCookie: false,
    });
  } catch {
    return Object.freeze({ status: "invalid", snapshot: null, clearCookie: true });
  }
}

export function renewDecisionSession(
  keyring: DecisionSessionKeyring,
  current: DecisionSessionSnapshot,
  values: DecisionSessionValue,
  now: number,
  mode: "retain-identity" | "privilege-change",
): Readonly<{ envelope: string; snapshot: DecisionSessionSnapshot }> {
  if (sessionOwners.get(current) !== keyring || (mode !== "retain-identity" && mode !== "privilege-change")) {
    fail("FADENO_SESSION_SNAPSHOT");
  }
  if (now >= current.expiresAt) fail("FADENO_SESSION_EXPIRED");
  const next = mode === "privilege-change"
    ? snapshot(values, now)
    : snapshot(values, now, current);
  sessionOwners.set(next, keyring);
  return Object.freeze({ envelope: seal(keyring, next), snapshot: next });
}

export function assertDecisionSessionSnapshot(value: unknown): asserts value is DecisionSessionSnapshot {
  if (!value || typeof value !== "object" || !sessionOwners.has(value)) fail("FADENO_SESSION_SNAPSHOT");
}

export function assertDecisionSessionOwner(value: unknown, keyring: DecisionSessionKeyring): asserts value is DecisionSessionSnapshot {
  if (!value || typeof value !== "object" || sessionOwners.get(value) !== keyring) fail("FADENO_SESSION_SNAPSHOT");
}

function actionProofKey(key: KeyState): Buffer {
  return Buffer.from(hkdfSync("sha256", key.bytes, Buffer.alloc(0), actionProofPurpose, 32));
}

export function signDecisionActionProof(keyring: DecisionSessionKeyring, message: string): Readonly<{ keyId: string; signature: Buffer }> {
  const active = keyringState(keyring).active;
  return Object.freeze({ keyId: active.id, signature: createHmac("sha256", actionProofKey(active)).update(message).digest() });
}

export function verifyDecisionActionProof(
  keyring: DecisionSessionKeyring,
  keyId: string,
  message: string,
  signature: Uint8Array,
): boolean {
  const key = keyringState(keyring).byId.get(keyId);
  if (!key || !(signature instanceof Uint8Array) || signature.byteLength !== 32) return false;
  const expected = createHmac("sha256", actionProofKey(key)).update(message).digest();
  return timingSafeEqual(Buffer.from(signature), expected);
}

export function formatDecisionSessionCookie(envelope: string, now: number, expiresAt: number): string {
  if (
    typeof envelope !== "string" || Buffer.byteLength(`${cookieName}=${envelope}`) > maximumCookieBytes ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || now < 0 || expiresAt <= now
  ) {
    fail("FADENO_SESSION_COOKIE");
  }
  const maximumAge = Math.ceil((expiresAt - now) / 1_000);
  return `${cookieName}=${envelope}; Path=/; Max-Age=${maximumAge}; Secure; HttpOnly; SameSite=Lax`;
}

export function formatDecisionSessionDeletionCookie(): string {
  return `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
