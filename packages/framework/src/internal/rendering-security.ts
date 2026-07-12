export const renderingSecurityRegistry = Object.freeze({
  schemaVersion: 1,
  acceptedSinkClasses: Object.freeze([
    "html-text",
    "attribute-double-quoted",
    "rcdata",
    "url-attribute",
    "boolean-attribute",
    "enumerated-attribute",
    "authenticated-raw-html",
  ] as const),
  textContexts: Object.freeze(["html-text", "rcdata-title", "rcdata-textarea"] as const),
  childSinks: Object.freeze({
    html: "html-text", head: "html-text", body: "html-text", title: "rcdata-title", textarea: "rcdata-textarea",
    main: "html-text", header: "html-text", footer: "html-text", nav: "html-text", section: "html-text",
    article: "html-text", aside: "html-text", div: "html-text", span: "html-text", p: "html-text",
    h1: "html-text", h2: "html-text", h3: "html-text", h4: "html-text", h5: "html-text", h6: "html-text",
    ul: "html-text", ol: "html-text", li: "html-text", dl: "html-text", dt: "html-text", dd: "html-text",
    figure: "html-text", figcaption: "html-text", blockquote: "html-text", pre: "html-text", code: "html-text",
    em: "html-text", strong: "html-text", small: "html-text", s: "html-text", mark: "html-text",
    abbr: "html-text", cite: "html-text", q: "html-text", time: "html-text", address: "html-text",
    br: "html-text", hr: "html-text", wbr: "html-text", b: "html-text", i: "html-text", u: "html-text",
    kbd: "html-text", samp: "html-text", var: "html-text", sub: "html-text", sup: "html-text",
    a: "html-text", area: "html-text", img: "html-text", picture: "html-text", source: "html-text",
    audio: "html-text", video: "html-text", link: "html-text", meta: "html-text", form: "html-text",
    label: "html-text", input: "html-text", button: "html-text", select: "html-text", option: "html-text",
    optgroup: "html-text", fieldset: "html-text", legend: "html-text", datalist: "html-text", output: "html-text",
    progress: "html-text", meter: "html-text", details: "html-text", summary: "html-text", dialog: "html-text",
    table: "html-text", caption: "html-text", colgroup: "html-text", col: "html-text", thead: "html-text",
    tbody: "html-text", tfoot: "html-text", tr: "html-text", th: "html-text", td: "html-text",
  } as const),
  globalOrdinaryAttributes: Object.freeze(["id", "class", "title", "lang", "dir", "role", "tabindex"] as const),
  ordinaryAttributes: Object.freeze({
    a: Object.freeze(["download", "hreflang", "referrerpolicy", "target", "type"] as const),
    area: Object.freeze(["alt", "coords", "download", "shape", "target"] as const),
    img: Object.freeze(["alt", "height", "referrerpolicy", "width"] as const),
    source: Object.freeze(["height", "media", "type", "width"] as const),
    audio: Object.freeze(["preload"] as const), video: Object.freeze(["height", "preload", "width"] as const),
    link: Object.freeze(["as", "media", "referrerpolicy", "rel", "sizes", "type"] as const),
    meta: Object.freeze(["charset", "content", "name"] as const),
    form: Object.freeze(["autocomplete", "enctype", "method", "name", "target"] as const),
    label: Object.freeze(["for"] as const),
    input: Object.freeze(["accept", "alt", "autocomplete", "capture", "height", "max", "maxlength", "min", "minlength", "name", "pattern", "placeholder", "size", "step", "type", "value", "width"] as const),
    button: Object.freeze(["formenctype", "formmethod", "formtarget", "name", "type", "value"] as const),
    select: Object.freeze(["autocomplete", "name", "size"] as const),
    option: Object.freeze(["label", "value"] as const), optgroup: Object.freeze(["label"] as const),
    textarea: Object.freeze(["autocomplete", "cols", "maxlength", "minlength", "name", "placeholder", "rows", "wrap"] as const),
    ol: Object.freeze(["start", "type"] as const), li: Object.freeze(["value"] as const),
    time: Object.freeze(["datetime"] as const), output: Object.freeze(["for", "name"] as const),
    progress: Object.freeze(["max", "value"] as const), meter: Object.freeze(["high", "low", "max", "min", "optimum", "value"] as const),
    th: Object.freeze(["abbr", "colspan", "headers", "rowspan", "scope"] as const),
    td: Object.freeze(["colspan", "headers", "rowspan"] as const), col: Object.freeze(["span"] as const),
  } as const),
  booleanAttributes: Object.freeze([
    "*.hidden", "*.inert", "audio.autoplay", "audio.controls", "audio.loop", "audio.muted",
    "button.autofocus", "button.disabled", "details.open", "dialog.open", "fieldset.disabled",
    "form.novalidate", "input.autofocus", "input.checked", "input.disabled", "input.multiple",
    "input.readonly", "input.required", "ol.reversed", "optgroup.disabled", "option.disabled",
    "option.selected", "select.autofocus", "select.disabled", "select.multiple", "select.required",
    "textarea.autofocus", "textarea.disabled", "textarea.readonly", "textarea.required",
    "video.autoplay", "video.controls", "video.loop", "video.muted", "video.playsinline",
  ] as const),
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
    "*.contenteditable": Object.freeze(["false", "plaintext-only", "true"] as const),
    "audio.crossorigin": Object.freeze(["anonymous", "use-credentials"] as const),
    "img.crossorigin": Object.freeze(["anonymous", "use-credentials"] as const),
    "link.crossorigin": Object.freeze(["anonymous", "use-credentials"] as const),
    "video.crossorigin": Object.freeze(["anonymous", "use-credentials"] as const),
    "img.decoding": Object.freeze(["async", "auto", "sync"] as const),
    "img.loading": Object.freeze(["eager", "lazy"] as const),
  }),
});

export type TextContext = (typeof renderingSecurityRegistry.textContexts)[number];
export type UrlSink = keyof typeof renderingSecurityRegistry.urlSinks;
export type SinkKind = TextContext | "attribute-double-quoted" | "url-attribute" | "boolean-attribute" | "enumerated-attribute";

function registryKey(element: string, attribute: string): string {
  return `${element}.${attribute}`;
}

export function classifySink(element: string, attribute?: string): SinkKind {
  if (!/^[a-z][a-z0-9]*$/u.test(element)) throw new TypeError("FADENO_RENDER_ELEMENT");
  if (attribute === undefined) {
    if (element === "script") throw new TypeError("FADENO_RENDER_SCRIPT_CHILDREN");
    if (element === "style") throw new TypeError("FADENO_RENDER_STYLE_CHILDREN");
    if (element === "svg" || element === "math") throw new TypeError("FADENO_RENDER_FOREIGN_CONTENT");
    if (["marquee", "frameset", "frame", "basefont"].includes(element)) throw new TypeError("FADENO_RENDER_OBSOLETE_ELEMENT");
    const context = renderingSecurityRegistry.childSinks[element as keyof typeof renderingSecurityRegistry.childSinks];
    if (context === undefined) throw new TypeError("FADENO_RENDER_ELEMENT");
    return context;
  }
  if (!/^[a-z][a-z0-9:-]*$/u.test(attribute)) throw new TypeError("FADENO_RENDER_ATTRIBUTE");
  if (attribute.startsWith("on")) throw new TypeError("FADENO_RENDER_EVENT_ATTRIBUTE");
  const refused: Record<string, string> = {
    style: "FADENO_RENDER_STYLE_ATTRIBUTE", srcdoc: "FADENO_RENDER_SRCDOC", srcset: "FADENO_RENDER_SRCSET",
    ping: "FADENO_RENDER_PING", "xlink:href": "FADENO_RENDER_XLINK", "http-equiv": "FADENO_RENDER_META_REFRESH",
  };
  const refusal = refused[attribute];
  if (refusal !== undefined) throw new TypeError(refusal);
  classifySink(element);
  const key = registryKey(element, attribute);
  if (key in renderingSecurityRegistry.urlSinks) return "url-attribute";
  if (renderingSecurityRegistry.booleanAttributes.includes(key as never) || renderingSecurityRegistry.booleanAttributes.includes(`*.${attribute}` as never)) return "boolean-attribute";
  if (key in renderingSecurityRegistry.enumeratedAttributes || `*.${attribute}` in renderingSecurityRegistry.enumeratedAttributes) return "enumerated-attribute";
  const ordinary = renderingSecurityRegistry.ordinaryAttributes[element as keyof typeof renderingSecurityRegistry.ordinaryAttributes] as readonly string[] | undefined;
  if (renderingSecurityRegistry.globalOrdinaryAttributes.includes(attribute as never) || ordinary?.includes(attribute) || /^aria-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(attribute)) return "attribute-double-quoted";
  throw new TypeError("FADENO_RENDER_ATTRIBUTE");
}

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
  if (!(renderingSecurityRegistry.textContexts as readonly string[]).includes(context)) throw new TypeError("FADENO_RENDER_TEXT_CONTEXT");
  return replaceHtmlDelimiters(value, false);
}

export function encodeAttribute(element: string, attribute: string, value: string): string {
  if (classifySink(element, attribute) !== "attribute-double-quoted") throw new TypeError("FADENO_RENDER_ATTRIBUTE_SINK");
  if (typeof value !== "string") throw new TypeError("FADENO_RENDER_ATTRIBUTE_VALUE");
  return replaceHtmlDelimiters(value, true);
}

function urlKind(value: string): string {
  if (/[\u0000-\u0020\u007f\\]/u.test(value)) throw new TypeError("FADENO_RENDER_URL_CHARACTERS");
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff) throw new TypeError("FADENO_RENDER_URL_UNICODE");
  }
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

export function encodeBoolean(element: string, attribute: string, value: boolean): string {
  if (classifySink(element, attribute) !== "boolean-attribute") throw new TypeError("FADENO_RENDER_BOOLEAN_SINK");
  if (typeof value !== "boolean") throw new TypeError("FADENO_RENDER_BOOLEAN_VALUE");
  return value ? attribute : "";
}

export function encodeEnumerated(element: string, attribute: string, value: string): string {
  if (classifySink(element, attribute) !== "enumerated-attribute") throw new TypeError("FADENO_RENDER_ENUMERATED_SINK");
  const key = registryKey(element, attribute);
  const registry = renderingSecurityRegistry.enumeratedAttributes as Record<string, readonly string[]>;
  const tokens = registry[key] ?? registry[`*.${attribute}`];
  if (typeof value !== "string" || tokens === undefined || !tokens.includes(value)) {
    throw new TypeError("FADENO_RENDER_ENUMERATED_VALUE");
  }
  return value;
}

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

export function createCspNonce(): object {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  globalThis.crypto.getRandomValues(bytes);
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
  readonly sensitiveValues?: readonly string[];
}

function redactStructured(value: unknown, options: RedactionOptions = {}): unknown {
  const sensitive = new Set([...defaultSensitiveFields, ...(options.sensitiveFields ?? [])].map(normalizedField));
  const sensitiveValues = new Set(options.sensitiveValues ?? []);
  const seen = new WeakSet<object>();

  function visit(current: unknown, field?: string): unknown {
    if (field !== undefined && sensitive.has(normalizedField(field))) return "[REDACTED]";
    if (typeof current === "string" && sensitiveValues.has(current)) return "[REDACTED]";
    if (field !== undefined && normalizedField(field).endsWith("url") && typeof current === "string") return withoutQuery(current);
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

export interface DiagnosticProjectionSource {
  readonly method?: string;
  readonly request?: {
    readonly url: string;
    readonly headers?: Headers | Readonly<Record<string, unknown>>;
  };
  readonly details?: unknown;
  readonly error?: unknown;
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function projectDiagnosticSource(
  source: DiagnosticProjectionSource,
  options: RedactionOptions = {},
): Readonly<Record<string, unknown>> {
  const projection = Object.create(null) as Record<string, unknown>;
  if (source === null || typeof source !== "object") return Object.freeze(projection);
  const method = ownValue(source, "method");
  if (typeof method === "string") projection["method"] = method;
  const request = ownValue(source, "request");
  if (request !== null && typeof request === "object") {
    const url = ownValue(request, "url");
    if (typeof url === "string") projection["request"] = Object.freeze({ url: withoutQuery(url) });
  }
  if (Object.getOwnPropertyDescriptor(source, "error") !== undefined) projection["error"] = Object.freeze({ type: "Error" });
  const details = ownValue(source, "details");
  if (details !== undefined) projection["details"] = redactStructured(details, options);
  return Object.freeze(projection);
}
