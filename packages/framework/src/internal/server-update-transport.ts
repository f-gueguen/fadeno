import {
  bindPrivateServerUpdateOperation,
  createPrivateServerUpdateOperation,
  projectPrivateServerUpdate,
} from "./server-update.ts";

export const privateUpdateMediaType = "application/vnd.fadeno.private-update+json; version=1";

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u;
const maximumIdentityBytes = 128;
const maximumUrlBytes = 8_192;
const generatedActionPrefix = "/.fadeno/actions/v1/";
const encoder = new TextEncoder();

type Invoke = (request: Request) => Promise<Response>;

function bounded(value: string | null, maximum: number, pattern?: RegExp): value is string {
  return value !== null
    && encoder.encode(value).byteLength <= maximum
    && (pattern === undefined || pattern.test(value));
}

function exactSingleHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value !== null && !value.includes(",") ? value : null;
}

function decodeCurrentTruthHeader(value: string | null): string | undefined {
  if (!bounded(value, maximumUrlBytes * 3)) return undefined;
  try { return decodeURIComponent(value); }
  catch { return undefined; }
}

function safeSameOriginUrl(value: string, origin: string): string | undefined {
  if (!bounded(value, maximumUrlBytes)) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.origin === origin && parsed.username === "" && parsed.password === ""
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function nativeSetCookies(response: Response): readonly string[] {
  const getSetCookie = Reflect.get(response.headers, "getSetCookie");
  if (typeof getSetCookie === "function") {
    const values = Reflect.apply(getSetCookie, response.headers, []) as unknown;
    if (Array.isArray(values) && values.every((value) => typeof value === "string")) {
      return Object.freeze([...values]);
    }
  }
  return Object.freeze([]);
}

function transportHeaders(contentType: string, code?: string, setCookies: readonly string[] = []): Headers {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": contentType,
    vary: "accept",
    "x-content-type-options": "nosniff",
  });
  if (code !== undefined) headers.set("x-fadeno-update-code", code);
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return headers;
}

function refusal(code: string, status = 400, setCookies: readonly string[] = []): Response {
  return new Response(null, {
    status,
    headers: transportHeaders("text/plain; charset=utf-8", code, setCookies),
  });
}

export async function servePrivateServerUpdate(
  request: Request,
  input: Readonly<{
    origin: string;
    applicationGeneration?: string;
    invoke: Invoke;
  }>,
): Promise<Response | undefined> {
  if (request.headers.get("accept") !== privateUpdateMediaType) return undefined;
  if (request.method !== "GET" && request.method !== "POST") return refusal("FADENO_UPDATE_REQUEST_METHOD", 405);
  const operationKind = request.method === "POST" ? "mutation" : "navigation";
  const applicationGeneration = input.applicationGeneration ?? null;
  if (!bounded(applicationGeneration, maximumIdentityBytes, identityPattern)) {
    return refusal("FADENO_UPDATE_REQUEST_GENERATION", 409);
  }
  const documentEpoch = exactSingleHeader(request, "x-fadeno-document-epoch");
  const operationId = exactSingleHeader(request, "x-fadeno-operation-id");
  const sequenceSource = exactSingleHeader(request, "x-fadeno-operation-sequence");
  const currentSource = exactSingleHeader(request, "x-fadeno-current-url");
  const destination = safeSameOriginUrl(request.url, input.origin);
  const decodedCurrentSource = decodeCurrentTruthHeader(currentSource);
  const currentTruthUrl = decodedCurrentSource === undefined
    ? undefined
    : safeSameOriginUrl(decodedCurrentSource, input.origin);
  const sequence = sequenceSource === null || !/^[1-9][0-9]{0,15}$/u.test(sequenceSource)
    ? undefined
    : Number(sequenceSource);
  if (!bounded(documentEpoch, maximumIdentityBytes, identityPattern)
    || !bounded(operationId, maximumIdentityBytes, identityPattern)
    || sequence === undefined
    || !Number.isSafeInteger(sequence)
    || destination === undefined
    || currentTruthUrl === undefined) {
    return refusal("FADENO_UPDATE_REQUEST_SCHEMA");
  }
  if (operationKind === "mutation") {
    const actionUrl = new URL(destination);
    if (actionUrl.protocol !== "https:"
      || !actionUrl.pathname.startsWith(generatedActionPrefix)
      || exactSingleHeader(request, "origin") !== input.origin) {
      return refusal("FADENO_UPDATE_REQUEST_ORIGIN", 403);
    }
  }
  const operation = createPrivateServerUpdateOperation({
    origin: input.origin,
    currentTruthUrl,
    applicationGeneration,
    documentEpoch,
    operation: Object.freeze({ id: operationId, sequence, kind: operationKind, url: destination }),
    resultId: globalThis.crypto.randomUUID(),
    scrollBoundary: Object.freeze({
      documentPrecedingLayout: "unaffected",
      elementPrecedingLayout: "unaffected",
    }),
    authorizationOwner: Object.freeze({}),
  });
  const release = bindPrivateServerUpdateOperation(request, operation);
  try {
    const nativeResponse = await input.invoke(request);
    const setCookies = nativeSetCookies(nativeResponse);
    const projected = await projectPrivateServerUpdate(nativeResponse, operation, { signal: request.signal });
    if (projected.status !== "projected") return refusal(projected.code, 409, setCookies);
    const headers = transportHeaders(privateUpdateMediaType, undefined, setCookies);
    return new Response(Uint8Array.from(projected.bytes).buffer, {
      status: 200,
      headers,
    });
  } finally {
    release();
  }
}
