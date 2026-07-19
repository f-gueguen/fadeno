import {
  encodePrivateUpdateEnvelope,
  V2_PATCH_PROTOCOL_LIMITS,
  withinPrivateUpdateFieldLimit,
  type PrivateScrollBoundaryInput,
} from "./browser-update.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u;
const errorCodePattern = /^[A-Z][A-Z0-9_]{1,63}$/u;
const recordSchema = "fadeno.private.server-update-projection";
const maximumEvidenceEntries = 128;
const maximumRecordBytes = 64 * 1024;

export type PrivateServerUpdateResourceEvidence = Readonly<{
  operation: "resource-read";
  outcome: "value" | "expected-error" | "unexpected-error" | "cancelled" | "refused";
  cache: "miss" | "request-hit" | "none";
  ownership: "request";
  dependencyRecorded: boolean;
  cause: string;
}>;

export type PrivateServerUpdateActionEvidence = Readonly<{
  code: string;
  status: "success" | "expected-failure" | "refused" | "unexpected-failure";
  revalidation: "complete" | "none";
  outcome: string;
}>;

export type PrivateServerUpdateOperation = Readonly<{
  origin: string;
  currentTruthUrl: string;
  applicationGeneration: string;
  documentEpoch: string;
  operation: Readonly<{
    id: string;
    sequence: number;
    kind: "navigation" | "mutation";
    url: string;
  }>;
  resultId: string;
  scrollBoundary: PrivateScrollBoundaryInput;
  authorizationOwner: object;
}>;

export type PrivateServerUpdateProjectionRecord = Readonly<{
  schema: typeof recordSchema;
  version: 1;
  operationId: string;
  resultId: string;
  status: "projected" | "refused";
  code: string;
  outcome: "document" | "expected-error" | "redirect" | "recover" | null;
  completeness: "complete" | "interrupted" | "refused";
  redaction: "applied";
  provenance: Readonly<{
    route: Readonly<{
      id: string;
      generation: string;
      outcome: "document" | "not-found" | "expected-error" | "redirect" | "unexpected-error";
    }> | null;
    resources: readonly PrivateServerUpdateResourceEvidence[];
    action: PrivateServerUpdateActionEvidence | null;
  }>;
  causes: readonly string[];
  skipped: readonly string[];
}>;

export type PrivateServerUpdateProjectionResult =
  | Readonly<{
      status: "projected";
      bytes: Uint8Array;
      record: PrivateServerUpdateProjectionRecord;
    }>
  | Readonly<{
      status: "refused";
      code: string;
      record: PrivateServerUpdateProjectionRecord;
    }>;

type RouteEvidence = Readonly<{
  authority: PrivateServerUpdateOperation;
  routeId: string;
  generation: string;
  outcome: "document" | "not-found" | "expected-error" | "redirect" | "unexpected-error";
  expectedCode: string | null;
  resources: () => readonly PrivateServerUpdateResourceEvidence[];
}>;

type MutableResponseEvidence = {
  route: RouteEvidence;
  action: PrivateServerUpdateActionEvidence | null;
};

type JsonRecord = Record<string, unknown>;

const operations = new WeakSet<object>();
const requestOperations = new WeakMap<Request, PrivateServerUpdateOperation>();
const responseEvidence = new WeakMap<Response, MutableResponseEvidence>();
const consumedResponses = new WeakSet<Response>();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string"
    && identityPattern.test(value)
    && withinPrivateUpdateFieldLimit("identity", value);
}

function boundedCode(value: unknown): value is string {
  return typeof value === "string" && errorCodePattern.test(value);
}

function safeUrl(value: unknown, origin: string): value is string {
  if (typeof value !== "string" || !withinPrivateUpdateFieldLimit("url", value)) return false;
  try {
    const expected = new URL(origin);
    const received = new URL(value, expected);
    const loopback = expected.protocol === "http:"
      && new Set(["127.0.0.1", "localhost", "[::1]"]).has(expected.hostname);
    return (expected.protocol === "https:" || loopback)
      && expected.origin === origin
      && received.origin === expected.origin
      && received.username === ""
      && received.password === "";
  } catch {
    return false;
  }
}

function exactScrollBoundary(value: PrivateScrollBoundaryInput): boolean {
  const allowed = ["unaffected", "affected", "unknown"] as const;
  return allowed.includes(value.documentPrecedingLayout)
    && allowed.includes(value.elementPrecedingLayout);
}

export function createPrivateServerUpdateOperation(input: PrivateServerUpdateOperation): PrivateServerUpdateOperation {
  if (!boundedIdentity(input.applicationGeneration)
    || !boundedIdentity(input.documentEpoch)
    || !boundedIdentity(input.operation.id)
    || !boundedIdentity(input.resultId)
    || !Number.isSafeInteger(input.operation.sequence)
    || input.operation.sequence < 0
    || !["navigation", "mutation"].includes(input.operation.kind)
    || typeof input.authorizationOwner !== "object"
    || input.authorizationOwner === null
    || !safeUrl(input.operation.url, input.origin)
    || !safeUrl(input.currentTruthUrl, input.origin)
    || !exactScrollBoundary(input.scrollBoundary)) {
    throw new TypeError("FADENO_UPDATE_PROJECTION_OPERATION");
  }
  const operation = Object.freeze({
    origin: input.origin,
    currentTruthUrl: input.currentTruthUrl,
    applicationGeneration: input.applicationGeneration,
    documentEpoch: input.documentEpoch,
    operation: Object.freeze({ ...input.operation }),
    resultId: input.resultId,
    scrollBoundary: Object.freeze({ ...input.scrollBoundary }),
    authorizationOwner: input.authorizationOwner,
  });
  operations.add(operation);
  return operation;
}

export function bindPrivateServerUpdateOperation(
  request: Request,
  operation: PrivateServerUpdateOperation,
): () => void {
  if (!operations.has(operation) || requestOperations.has(request)) {
    throw new TypeError("FADENO_UPDATE_PROJECTION_BINDING");
  }
  requestOperations.set(request, operation);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (requestOperations.get(request) === operation) requestOperations.delete(request);
  };
}

export function capturePrivateServerUpdateOperation(request: Request): PrivateServerUpdateOperation | undefined {
  return requestOperations.get(request);
}

export function forwardPrivateServerUpdateOperation(source: Request, target: Request): () => void {
  const operation = requestOperations.get(source);
  return operation ? bindPrivateServerUpdateOperation(target, operation) : () => undefined;
}

export function attachPrivateServerUpdateRouteEvidence(
  response: Response,
  request: Request,
  input: Readonly<{
    routeId: string;
    generation: string;
    outcome: RouteEvidence["outcome"];
    expectedCode?: string;
    resources: () => readonly PrivateServerUpdateResourceEvidence[];
  }>,
): Response {
  const authority = requestOperations.get(request);
  if (!authority) return response;
  if (!boundedIdentity(input.routeId)
    || !boundedIdentity(input.generation)
    || (input.expectedCode !== undefined && !boundedCode(input.expectedCode))) {
    return response;
  }
  if (responseEvidence.has(response)) return response;
  responseEvidence.set(response, {
    route: Object.freeze({
      authority,
      routeId: input.routeId,
      generation: input.generation,
      outcome: input.outcome,
      expectedCode: input.expectedCode ?? null,
      resources: input.resources,
    }),
    action: null,
  });
  return response;
}

export function attachPrivateServerUpdateActionEvidence(
  response: Response,
  request: Request,
  input: PrivateServerUpdateActionEvidence,
): Response {
  const authority = requestOperations.get(request);
  const evidence = responseEvidence.get(response);
  if (!authority || !evidence || evidence.route.authority !== authority || !boundedCode(input.code)) return response;
  evidence.action = Object.freeze({ ...input });
  return response;
}

export function copyPrivateServerUpdateEvidence(source: Response, target: Response): Response {
  const evidence = responseEvidence.get(source);
  if (evidence) responseEvidence.set(target, evidence);
  return target;
}

function safeResources(value: readonly PrivateServerUpdateResourceEvidence[]): readonly PrivateServerUpdateResourceEvidence[] | undefined {
  if (value.length > maximumEvidenceEntries) return undefined;
  const result: PrivateServerUpdateResourceEvidence[] = [];
  for (const item of value) {
    if (item.operation !== "resource-read"
      || !["value", "expected-error", "unexpected-error", "cancelled", "refused"].includes(item.outcome)
      || !["miss", "request-hit", "none"].includes(item.cache)
      || item.ownership !== "request"
      || typeof item.dependencyRecorded !== "boolean"
      || !boundedIdentity(item.cause)) return undefined;
    result.push(Object.freeze({ ...item }));
  }
  return Object.freeze(result);
}

function routeRecord(evidence: MutableResponseEvidence | undefined): PrivateServerUpdateProjectionRecord["provenance"]["route"] {
  if (!evidence) return null;
  return Object.freeze({
    id: evidence.route.routeId,
    generation: evidence.route.generation,
    outcome: evidence.route.outcome,
  });
}

function makeRecord(
  operation: PrivateServerUpdateOperation,
  evidence: MutableResponseEvidence | undefined,
  input: Readonly<{
    status: "projected" | "refused";
    code: string;
    outcome: PrivateServerUpdateProjectionRecord["outcome"];
    completeness: PrivateServerUpdateProjectionRecord["completeness"];
    resources?: readonly PrivateServerUpdateResourceEvidence[];
    causes: readonly string[];
    skipped: readonly string[];
  }>,
): PrivateServerUpdateProjectionRecord {
  return Object.freeze({
    schema: recordSchema,
    version: 1,
    operationId: operation.operation.id,
    resultId: operation.resultId,
    status: input.status,
    code: input.code,
    outcome: input.outcome,
    completeness: input.completeness,
    redaction: "applied",
    provenance: Object.freeze({
      route: routeRecord(evidence),
      resources: Object.freeze([...(input.resources ?? [])]),
      action: evidence?.action ?? null,
    }),
    causes: Object.freeze([...input.causes]),
    skipped: Object.freeze([...input.skipped]),
  });
}

function refusal(
  operation: PrivateServerUpdateOperation,
  evidence: MutableResponseEvidence | undefined,
  code: string,
  completeness: "interrupted" | "refused" = "refused",
  causes: readonly string[] = [],
): PrivateServerUpdateProjectionResult {
  return Object.freeze({
    status: "refused",
    code,
    record: makeRecord(operation, evidence, {
      status: "refused",
      code,
      outcome: null,
      completeness,
      causes,
      skipped: ["browser-envelope"],
    }),
  });
}

function authorityRefusal(): PrivateServerUpdateProjectionResult {
  const record: PrivateServerUpdateProjectionRecord = Object.freeze({
    schema: recordSchema,
    version: 1,
    operationId: "untrusted-operation",
    resultId: "untrusted-result",
    status: "refused",
    code: "FADENO_UPDATE_PROJECTION_AUTHORITY",
    outcome: null,
    completeness: "refused",
    redaction: "applied",
    provenance: Object.freeze({ route: null, resources: Object.freeze([]), action: null }),
    causes: Object.freeze([]),
    skipped: Object.freeze(["browser-envelope"]),
  });
  return Object.freeze({ status: "refused", code: record.code, record });
}

async function readBoundedBody(response: Response, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel("FADENO_UPDATE_PROJECTION_CANCELLED").catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) return undefined;
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes) {
        await reader.cancel("FADENO_UPDATE_PROJECTION_BODY_LIMIT").catch(() => undefined);
        return undefined;
      }
      chunks.push(result.value);
    }
  } catch {
    return undefined;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeTitle(value: string): string | undefined {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(value);
  if (!match) return "";
  const title = (match[1] ?? "").replace(/&(amp|lt|gt|quot|#39);/gu, (entity, name: string) => ({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
  })[name] ?? entity);
  return withinPrivateUpdateFieldLimit("title", title) ? title : undefined;
}

function projectedOutcome(
  response: Response,
  evidence: MutableResponseEvidence,
  html: string | undefined,
  operation: PrivateServerUpdateOperation,
): Readonly<{ outcome: JsonRecord; kind: NonNullable<PrivateServerUpdateProjectionRecord["outcome"]>; code: string }> | undefined {
  const action = evidence.action;
  if (action?.status === "refused") return undefined;
  if (action?.status === "unexpected-failure" || evidence.route.outcome === "unexpected-error") {
    return Object.freeze({
      kind: "recover",
      code: "FADENO_UPDATE_PROJECTION_RECOVERY",
      outcome: Object.freeze({ kind: "recover", reason: "server-current-truth", location: operation.currentTruthUrl }),
    });
  }
  if (evidence.route.outcome === "redirect") {
    const location = response.headers.get("location");
    if (!location || ![303, 307, 308].includes(response.status)) return undefined;
    return Object.freeze({
      kind: "redirect",
      code: "FADENO_UPDATE_PROJECTION_REDIRECT",
      outcome: Object.freeze({ kind: "redirect", status: response.status, location }),
    });
  }
  if (html === undefined) return undefined;
  const title = decodeTitle(html);
  if (title === undefined || !withinPrivateUpdateFieldLimit("html", html)) return undefined;
  const expectedCode = action?.status === "expected-failure"
    ? action.code
    : evidence.route.expectedCode;
  const expected = evidence.route.outcome === "expected-error"
    || evidence.route.outcome === "not-found"
    || action?.status === "expected-failure";
  if (expected && !expectedCode) return undefined;
  const kind = expected ? "expected-error" : "document";
  const outcome: JsonRecord = {
    kind,
    ...(expected ? { code: expectedCode } : {}),
    url: operation.operation.url,
    title,
    root: Object.freeze({ identity: "fadeno-document-root", html }),
    scrollBoundary: operation.scrollBoundary,
  };
  return Object.freeze({
    kind,
    code: expected ? "FADENO_UPDATE_PROJECTION_EXPECTED_ERROR" : "FADENO_UPDATE_PROJECTION_DOCUMENT",
    outcome: Object.freeze(outcome),
  });
}

export async function projectPrivateServerUpdate(
  response: Response,
  operation: PrivateServerUpdateOperation,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<PrivateServerUpdateProjectionResult> {
  const evidence = responseEvidence.get(response);
  if (!operations.has(operation)) return authorityRefusal();
  if (!evidence || evidence.route.authority !== operation) {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_OWNERSHIP");
  }
  if (evidence.route.generation !== operation.applicationGeneration) {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_GENERATION");
  }
  if (options.signal?.aborted) {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_CANCELLED", "interrupted");
  }
  if (evidence.action?.status === "refused") {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_AUTHORIZATION", "refused", ["action:refused"]);
  }
  if (consumedResponses.has(response)) {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_STALE", "refused", ["response:consumed"]);
  }
  const redirect = evidence.route.outcome === "redirect";
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!redirect && contentType !== "text/html") {
    return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_MEDIA_TYPE");
  }
  consumedResponses.add(response);
  const body = redirect ? new Uint8Array() : await readBoundedBody(response, options.signal);
  if (!body || options.signal?.aborted) {
    return refusal(operation, evidence, options.signal?.aborted
      ? "FADENO_UPDATE_PROJECTION_CANCELLED"
      : "FADENO_UPDATE_PROJECTION_BODY", "interrupted");
  }
  let html: string | undefined;
  if (!redirect) {
    try { html = decoder.decode(body); } catch { return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_BODY"); }
  }
  const resources = safeResources(evidence.route.resources());
  if (!resources) return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_PROVENANCE");
  const projection = projectedOutcome(response, evidence, html, operation);
  if (!projection) return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_OUTCOME");
  const envelope = Object.freeze({
    protocol: "fadeno.private.update",
    version: 1,
    applicationGeneration: operation.applicationGeneration,
    documentEpoch: operation.documentEpoch,
    operation: Object.freeze({
      id: operation.operation.id,
      sequence: operation.operation.sequence,
      kind: operation.operation.kind,
    }),
    resultId: operation.resultId,
    cache: "no-store",
    outcome: projection.outcome,
  });
  let bytes: Uint8Array;
  try { bytes = encodePrivateUpdateEnvelope(envelope); }
  catch { return refusal(operation, evidence, "FADENO_UPDATE_PROJECTION_ENCODE"); }
  const causes = [
    `route:${evidence.route.outcome}`,
    ...resources.map((resource) => `resource:${resource.outcome}:${resource.cause}`),
    ...(evidence.action ? [`action:${evidence.action.status}:${evidence.action.outcome}`] : []),
  ];
  const record = makeRecord(operation, evidence, {
    status: "projected",
    code: projection.code,
    outcome: projection.kind,
    completeness: "complete",
    resources,
    causes,
    skipped: [],
  });
  return Object.freeze({ status: "projected", bytes, record });
}

function plainRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
    Object.hasOwn(descriptor, "value") && descriptor.enumerable === true
  );
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function parseResource(value: unknown): PrivateServerUpdateResourceEvidence | undefined {
  if (!plainRecord(value)
    || !exactKeys(value, ["cache", "cause", "dependencyRecorded", "operation", "outcome", "ownership"])
    || value["operation"] !== "resource-read"
    || !["value", "expected-error", "unexpected-error", "cancelled", "refused"].includes(String(value["outcome"]))
    || !["miss", "request-hit", "none"].includes(String(value["cache"]))
    || value["ownership"] !== "request"
    || typeof value["dependencyRecorded"] !== "boolean"
    || !boundedIdentity(value["cause"])) return undefined;
  return Object.freeze(value as PrivateServerUpdateResourceEvidence);
}

export function deserializePrivateServerUpdateRecord(bytes: Uint8Array): PrivateServerUpdateProjectionRecord {
  if (bytes.byteLength > maximumRecordBytes) throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  let value: unknown;
  try { value = JSON.parse(decoder.decode(bytes)) as unknown; }
  catch { throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD"); }
  if (!plainRecord(value)
    || !exactKeys(value, ["causes", "code", "completeness", "operationId", "outcome", "provenance", "redaction", "resultId", "schema", "skipped", "status", "version"])
    || value["schema"] !== recordSchema
    || value["version"] !== 1
    || !boundedIdentity(value["operationId"])
    || !boundedIdentity(value["resultId"])
    || !boundedCode(value["code"])
    || !["projected", "refused"].includes(String(value["status"]))
    || !["document", "expected-error", "redirect", "recover", null].includes(value["outcome"] as never)
    || !["complete", "interrupted", "refused"].includes(String(value["completeness"]))
    || value["redaction"] !== "applied"
    || !Array.isArray(value["causes"])
    || !Array.isArray(value["skipped"])
    || value["causes"].length > maximumEvidenceEntries
    || value["skipped"].length > maximumEvidenceEntries
    || !value["causes"].every(boundedIdentity)
    || !value["skipped"].every(boundedIdentity)
    || !plainRecord(value["provenance"])) throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  const provenance = value["provenance"];
  if (!exactKeys(provenance, ["action", "resources", "route"])
    || !Array.isArray(provenance["resources"])
    || provenance["resources"].length > maximumEvidenceEntries) throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  const resources = provenance["resources"].map(parseResource);
  if (resources.some((resource) => resource === undefined)) throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  const route = provenance["route"];
  if (route !== null && (!plainRecord(route)
    || !exactKeys(route, ["generation", "id", "outcome"])
    || !boundedIdentity(route["id"])
    || !boundedIdentity(route["generation"])
    || !["document", "not-found", "expected-error", "redirect", "unexpected-error"].includes(String(route["outcome"])))) {
    throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  }
  const action = provenance["action"];
  if (action !== null && (!plainRecord(action)
    || !exactKeys(action, ["code", "outcome", "revalidation", "status"])
    || !boundedCode(action["code"])
    || !boundedIdentity(action["outcome"])
    || !["complete", "none"].includes(String(action["revalidation"]))
    || !["success", "expected-failure", "refused", "unexpected-failure"].includes(String(action["status"])))) {
    throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  }
  return Object.freeze({
    ...(value as Omit<PrivateServerUpdateProjectionRecord, "provenance" | "causes" | "skipped">),
    provenance: Object.freeze({
      route: route === null ? null : Object.freeze(route as NonNullable<PrivateServerUpdateProjectionRecord["provenance"]["route"]>),
      resources: Object.freeze(resources as PrivateServerUpdateResourceEvidence[]),
      action: action === null ? null : Object.freeze(action as PrivateServerUpdateActionEvidence),
    }),
    causes: Object.freeze([...(value["causes"] as string[])]),
    skipped: Object.freeze([...(value["skipped"] as string[])]),
  });
}

export function serializePrivateServerUpdateRecord(record: PrivateServerUpdateProjectionRecord): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(record));
  if (bytes.byteLength > maximumRecordBytes) throw new TypeError("FADENO_UPDATE_PROJECTION_RECORD");
  deserializePrivateServerUpdateRecord(bytes);
  return bytes;
}

export function privateServerUpdateRecordByteLength(record: PrivateServerUpdateProjectionRecord): number {
  return byteLength(JSON.stringify(record));
}
