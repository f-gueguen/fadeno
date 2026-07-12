export interface UnsafeHtmlPayload {
  readonly html: string;
  readonly reason: string;
}

const payloads = new WeakMap<object, UnsafeHtmlPayload>();
const maximumReasonLength = 240;

function validateReason(reason: string): string {
  if (
    reason.length === 0 ||
    reason.length > maximumReasonLength ||
    reason.trim().length === 0 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(reason)
  ) {
    throw new TypeError("FADENO_UNSAFE_HTML_REASON");
  }
  return reason;
}

export function createUnsafeHtml(html: string, reason: string): object {
  if (typeof html !== "string" || typeof reason !== "string") {
    throw new TypeError("FADENO_UNSAFE_HTML_ARGUMENT");
  }
  const token = Object.freeze(Object.create(null) as object);
  payloads.set(token, Object.freeze({ html, reason: validateReason(reason) }));
  return token;
}

export function readUnsafeHtml(value: unknown): UnsafeHtmlPayload | undefined {
  return typeof value === "object" && value !== null ? payloads.get(value) : undefined;
}
