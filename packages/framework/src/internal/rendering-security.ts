export const renderingSecurityRegistry = Object.freeze({
  schemaVersion: 1,
  textContexts: Object.freeze(["html-text", "attribute-double-quoted", "rcdata-title", "rcdata-textarea"] as const),
  urlSinks: Object.freeze({
    "a.href": Object.freeze(["relative", "network-path", "http", "https", "mailto", "tel"] as const),
    "area.href": Object.freeze(["relative", "network-path", "http", "https", "mailto", "tel"] as const),
    "form.action": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "button.formaction": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "input.formaction": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "img.src": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "source.src": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "audio.src": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "video.src": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "video.poster": Object.freeze(["relative", "network-path", "http", "https"] as const),
    "link.href": Object.freeze(["relative", "network-path", "http", "https"] as const),
  }),
  refusedContexts: Object.freeze([
    "dynamic-tag-name",
    "dynamic-attribute-name",
    "comment",
    "event-attribute",
    "srcdoc",
    "meta-refresh",
    "srcset",
    "ping",
    "xlink-href",
    "style-attribute",
    "script-children",
    "style-children",
    "svg",
    "mathml",
    "obsolete-element",
  ] as const),
  enumeratedAttributes: Object.freeze({
    contenteditable: Object.freeze(["false", "plaintext-only", "true"] as const),
    crossorigin: Object.freeze(["anonymous", "use-credentials"] as const),
    decoding: Object.freeze(["async", "auto", "sync"] as const),
    loading: Object.freeze(["eager", "lazy"] as const),
  }),
});

export type TextContext = (typeof renderingSecurityRegistry.textContexts)[number];
export type UrlSink = keyof typeof renderingSecurityRegistry.urlSinks;

function normalizeHtmlValue(value: string): string {
  const lineNormalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let normalized = "";
  for (const character of lineNormalized) {
    const codePoint = character.codePointAt(0);
    normalized += codePoint === 0 || (codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "\ufffd"
      : character;
  }
  return normalized;
}

function replaceHtmlDelimiters(value: string, attribute: boolean): string {
  let encoded = "";
  for (const character of normalizeHtmlValue(value)) {
    if (character === "&") encoded += "&amp;";
    else if (character === "<") encoded += "&lt;";
    else if (character === ">") encoded += "&gt;";
    else if (attribute && character === '"') encoded += "&quot;";
    else if (attribute && character === "'") encoded += "&#39;";
    else encoded += character;
  }
  return encoded;
}

export function encodeText(value: string, context: TextContext): string {
  if (typeof value !== "string") throw new TypeError("FADENO_RENDER_TEXT_VALUE");
  return replaceHtmlDelimiters(value, context === "attribute-double-quoted");
}

function urlKind(value: string): string {
  if (/[\u0000-\u0020\u007f\\]/u.test(value)) throw new TypeError("FADENO_RENDER_URL_CHARACTERS");
  const explicitScheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(value)?.[1]?.toLowerCase();
  const kind = explicitScheme ?? (value.startsWith("//") ? "network-path" : "relative");
  if (["javascript", "vbscript", "data", "blob", "file"].includes(kind)) {
    throw new TypeError("FADENO_RENDER_URL_SCHEME");
  }
  if (explicitScheme !== undefined || value.startsWith("//")) {
    let parsed: URL;
    try {
      parsed = new URL(value, "https://fadeno.invalid/");
    } catch {
      throw new TypeError("FADENO_RENDER_URL_SYNTAX");
    }
    if (parsed.username !== "" || parsed.password !== "") throw new TypeError("FADENO_RENDER_URL_CREDENTIALS");
  }
  return kind;
}

export function encodeUrl(value: string, sink: UrlSink): string {
  if (typeof value !== "string") throw new TypeError("FADENO_RENDER_URL_VALUE");
  const allowed = renderingSecurityRegistry.urlSinks[sink];
  if (allowed === undefined) throw new TypeError("FADENO_RENDER_URL_SINK");
  const kind = urlKind(value);
  if (!(allowed as readonly string[]).includes(kind)) throw new TypeError("FADENO_RENDER_URL_SCHEME");
  return replaceHtmlDelimiters(value, true);
}

export function encodeBoolean(attribute: string, value: boolean): string {
  if (typeof value !== "boolean") throw new TypeError("FADENO_RENDER_BOOLEAN_VALUE");
  return value ? attribute : "";
}

export function encodeEnumerated(value: string, tokens: readonly string[]): string {
  if (typeof value !== "string" || !tokens.includes(value)) {
    throw new TypeError("FADENO_RENDER_ENUMERATED_VALUE");
  }
  return value;
}

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => void;

const nonceValues = new WeakMap<object, string>();
const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += base64UrlAlphabet[first >> 2];
    result += base64UrlAlphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) result += base64UrlAlphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) result += base64UrlAlphabet[third & 63];
  }
  return result;
}

export function createCspNonce(fill: RandomFill = (bytes) => globalThis.crypto.getRandomValues(bytes)): object {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  fill(bytes);
  const token = Object.freeze(Object.create(null) as object);
  nonceValues.set(token, base64Url(bytes));
  return token;
}

export function readCspNonce(value: unknown): string | undefined {
  return typeof value === "object" && value !== null ? nonceValues.get(value) : undefined;
}

const defaultSensitiveFields = [
  "authorization", "proxy-authorization", "cookie", "set-cookie", "body", "request-body", "response-body",
  "query", "search", "search-params", "message", "stack", "cause", "secret", "password", "token",
] as const;

function normalizedField(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function withoutQuery(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const end = Math.min(query === -1 ? value.length : query, fragment === -1 ? value.length : fragment);
  return value.slice(0, end);
}

export interface RedactionOptions {
  readonly sensitiveFields?: readonly string[];
}

export function redactStructured(value: unknown, options: RedactionOptions = {}): unknown {
  const sensitive = new Set([...defaultSensitiveFields, ...(options.sensitiveFields ?? [])].map(normalizedField));
  const seen = new WeakSet<object>();

  function visit(current: unknown, field?: string): unknown {
    if (field !== undefined && sensitive.has(normalizedField(field))) return "[REDACTED]";
    if (field !== undefined && normalizedField(field) === "url" && typeof current === "string") return withoutQuery(current);
    if (current === null || typeof current !== "object") return current;
    try {
      if (current instanceof Error) return Object.freeze({ type: "Error" });
      if (seen.has(current)) return "[CIRCULAR]";
      seen.add(current);
      if (Array.isArray(current)) {
        const result: unknown[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          result.push(descriptor && "value" in descriptor ? visit(descriptor.value) : "[ACCESSOR OMITTED]");
        }
        return result;
      }
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(current)) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        result[key] = descriptor && "value" in descriptor
          ? visit(descriptor.value, key)
          : "[ACCESSOR OMITTED]";
      }
      return result;
    } catch {
      return "[REDACTED OPAQUE VALUE]";
    }
  }

  return visit(value);
}
