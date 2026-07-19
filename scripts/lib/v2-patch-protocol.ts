export const V2_PATCH_PROTOCOL_LIMITS = Object.freeze({
  maximumBytes: 2 * 1024 * 1024,
  maximumRecords: 4_096,
  maximumDepth: 16,
  maximumDurationMilliseconds: 50,
  maximumIdentityBytes: 128,
  maximumUrlBytes: 8_192,
  maximumTitleBytes: 4_096,
  maximumHtmlBytes: 2 * 1024 * 1024,
});

export type PrivateScrollBoundaryInput = Readonly<{
  documentPrecedingLayout: "unaffected" | "affected" | "unknown";
  elementPrecedingLayout: "unaffected" | "affected" | "unknown";
}>;

export type PrivateScrollBoundaryDecision = Readonly<{
  decision: "apply" | "refuse";
  code: "FADENO_UPDATE_SCROLL_SAFE" | "FADENO_UPDATE_SCROLL_BOUNDARY";
  cause: "proven-unaffected" | "document-layout" | "element-layout" | "unknown-layout";
}>;

export type PrivateUpdateDecision = Readonly<{
  status: "accepted" | "refused" | "recovery";
  code: string;
  outcome: "document" | "expected-error" | "redirect" | "recover" | null;
  recovery: "none" | "native-navigation" | "reload-current-truth";
  mutationResubmission: "never";
}>;

export type PrivateUpdateDecisionContext = Readonly<{
  origin: string;
  transport: Readonly<{
    requestCache: string;
    responseCacheControl: string | null;
  }>;
  generation: string;
  documentEpoch: string;
  currentOperation: Readonly<{
    id: string;
    sequence: number;
    kind: "navigation" | "mutation";
  }>;
  consumedResultIds: readonly string[];
  requestCommitted: boolean;
  boundary: Readonly<{
    bytes: number;
    records: number;
    depth: number;
    durationMilliseconds: number;
  }>;
}>;

type JsonRecord = Record<string, unknown>;

export type V2PatchProtocolFixture = Readonly<{
  id: string;
  category: string;
  changes: readonly Readonly<{
    target: "context" | "envelope";
    operation: "set" | "delete";
    path: readonly (string | number)[];
    value?: unknown;
  }>[];
  expected: PrivateUpdateDecision;
}>;

export type V2PatchProtocolCorpus = Readonly<{
  schemaVersion: 1;
  operation: "fadeno.private.v2-patch-protocol-decision";
  baseContext: PrivateUpdateDecisionContext;
  baseEnvelope: JsonRecord;
  cases: readonly V2PatchProtocolFixture[];
}>;

const encoder = new TextEncoder();
const identityPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/u;
const errorCodePattern = /^[A-Z][A-Z0-9_]{1,63}$/u;

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
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
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string"
    && identityPattern.test(value)
    && byteLength(value) <= V2_PATCH_PROTOCOL_LIMITS.maximumIdentityBytes;
}

function finiteInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function safeSameOriginUrl(value: unknown, origin: string): boolean {
  if (typeof value !== "string" || byteLength(value) > V2_PATCH_PROTOCOL_LIMITS.maximumUrlBytes) return false;
  try {
    const expected = new URL(origin);
    const received = new URL(value, expected);
    const trustworthyLoopback = expected.protocol === "http:"
      && new Set(["127.0.0.1", "localhost", "[::1]"]).has(expected.hostname);
    return (expected.protocol === "https:" || trustworthyLoopback)
      && received.protocol === expected.protocol
      && received.origin === expected.origin;
  } catch {
    return false;
  }
}

function hasNoStoreDirective(value: string | null): boolean {
  return value !== null
    && value.split(",").some((directive) => directive.trim().toLowerCase() === "no-store");
}

function recoveryFor(context: PrivateUpdateDecisionContext): "native-navigation" | "reload-current-truth" {
  return context.currentOperation.kind === "navigation" && !context.requestCommitted
    ? "native-navigation"
    : "reload-current-truth";
}

function refused(code: string, context: PrivateUpdateDecisionContext): PrivateUpdateDecision {
  return Object.freeze({
    status: "refused",
    code,
    outcome: null,
    recovery: recoveryFor(context),
    mutationResubmission: "never",
  });
}

function accepted(
  code: string,
  outcome: Exclude<PrivateUpdateDecision["outcome"], null>,
): PrivateUpdateDecision {
  return Object.freeze({
    status: "accepted",
    code,
    outcome,
    recovery: "none",
    mutationResubmission: "never",
  });
}

export function decidePrivateScrollBoundary(
  input: PrivateScrollBoundaryInput,
): PrivateScrollBoundaryDecision {
  if (input.documentPrecedingLayout === "unknown" || input.elementPrecedingLayout === "unknown") {
    return Object.freeze({ decision: "refuse", code: "FADENO_UPDATE_SCROLL_BOUNDARY", cause: "unknown-layout" });
  }
  if (input.documentPrecedingLayout === "affected") {
    return Object.freeze({ decision: "refuse", code: "FADENO_UPDATE_SCROLL_BOUNDARY", cause: "document-layout" });
  }
  if (input.elementPrecedingLayout === "affected") {
    return Object.freeze({ decision: "refuse", code: "FADENO_UPDATE_SCROLL_BOUNDARY", cause: "element-layout" });
  }
  return Object.freeze({ decision: "apply", code: "FADENO_UPDATE_SCROLL_SAFE", cause: "proven-unaffected" });
}

function decodeScrollBoundary(value: unknown): PrivateScrollBoundaryInput | undefined {
  if (!plainRecord(value) || !exactKeys(value, ["documentPrecedingLayout", "elementPrecedingLayout"])) return undefined;
  const allowed = new Set(["unaffected", "affected", "unknown"]);
  if (!allowed.has(String(value["documentPrecedingLayout"])) || !allowed.has(String(value["elementPrecedingLayout"]))) return undefined;
  return Object.freeze({
    documentPrecedingLayout: value["documentPrecedingLayout"] as PrivateScrollBoundaryInput["documentPrecedingLayout"],
    elementPrecedingLayout: value["elementPrecedingLayout"] as PrivateScrollBoundaryInput["elementPrecedingLayout"],
  });
}

function decodeRoot(value: unknown): Readonly<{ identity: string; html: string }> | undefined {
  if (!plainRecord(value) || !exactKeys(value, ["identity", "html"])) return undefined;
  if (!boundedIdentity(value["identity"]) || typeof value["html"] !== "string") return undefined;
  if (byteLength(value["html"]) > V2_PATCH_PROTOCOL_LIMITS.maximumHtmlBytes) return undefined;
  return Object.freeze({ identity: value["identity"], html: value["html"] });
}

type DecodedOutcome =
  | Readonly<{ kind: "document"; url: string; title: string; root: Readonly<{ identity: string; html: string }>; scrollBoundary: PrivateScrollBoundaryInput }>
  | Readonly<{ kind: "expected-error"; code: string; url: string; title: string; root: Readonly<{ identity: string; html: string }>; scrollBoundary: PrivateScrollBoundaryInput }>
  | Readonly<{ kind: "redirect"; status: 303 | 307 | 308; location: string }>
  | Readonly<{ kind: "recover"; reason: "desynchronized" | "server-current-truth"; location: string }>;

function decodeOutcome(value: unknown): DecodedOutcome | undefined {
  if (!plainRecord(value) || typeof value["kind"] !== "string") return undefined;
  if (value["kind"] === "document" || value["kind"] === "expected-error") {
    const expectedKeys = value["kind"] === "document"
      ? ["kind", "url", "title", "root", "scrollBoundary"]
      : ["kind", "code", "url", "title", "root", "scrollBoundary"];
    if (!exactKeys(value, expectedKeys)) return undefined;
    if (typeof value["url"] !== "string" || typeof value["title"] !== "string") return undefined;
    if (byteLength(value["title"]) > V2_PATCH_PROTOCOL_LIMITS.maximumTitleBytes) return undefined;
    const root = decodeRoot(value["root"]);
    const scrollBoundary = decodeScrollBoundary(value["scrollBoundary"]);
    if (!root || !scrollBoundary) return undefined;
    if (value["kind"] === "expected-error") {
      if (typeof value["code"] !== "string" || !errorCodePattern.test(value["code"])) return undefined;
      return Object.freeze({ kind: "expected-error", code: value["code"], url: value["url"], title: value["title"], root, scrollBoundary });
    }
    return Object.freeze({ kind: "document", url: value["url"], title: value["title"], root, scrollBoundary });
  }
  if (value["kind"] === "redirect") {
    if (!exactKeys(value, ["kind", "status", "location"])) return undefined;
    if (![303, 307, 308].includes(value["status"] as number) || typeof value["location"] !== "string") return undefined;
    return Object.freeze({ kind: "redirect", status: value["status"] as 303 | 307 | 308, location: value["location"] });
  }
  if (value["kind"] === "recover") {
    if (!exactKeys(value, ["kind", "reason", "location"])) return undefined;
    if (!new Set(["desynchronized", "server-current-truth"]).has(String(value["reason"])) || typeof value["location"] !== "string") return undefined;
    return Object.freeze({ kind: "recover", reason: value["reason"] as "desynchronized" | "server-current-truth", location: value["location"] });
  }
  return undefined;
}

type DecodedEnvelope = Readonly<{
  applicationGeneration: string;
  documentEpoch: string;
  operation: Readonly<{ id: string; sequence: number; kind: "navigation" | "mutation" }>;
  resultId: string;
  cache: "no-store" | string;
  outcome: DecodedOutcome;
}>;

function decodeEnvelope(value: unknown): { envelope?: DecodedEnvelope; code?: string } {
  if (!plainRecord(value) || !exactKeys(value, ["protocol", "version", "applicationGeneration", "documentEpoch", "operation", "resultId", "cache", "outcome"])) {
    return { code: "FADENO_UPDATE_SCHEMA" };
  }
  if (value["protocol"] !== "fadeno.private.update") return { code: "FADENO_UPDATE_SCHEMA" };
  if (value["version"] !== 1) return { code: "FADENO_UPDATE_VERSION" };
  if (!boundedIdentity(value["applicationGeneration"]) || !boundedIdentity(value["documentEpoch"]) || !boundedIdentity(value["resultId"])) {
    return { code: "FADENO_UPDATE_IDENTITY" };
  }
  const operation = value["operation"];
  if (!plainRecord(operation) || !exactKeys(operation, ["id", "sequence", "kind"])) return { code: "FADENO_UPDATE_SCHEMA" };
  if (!boundedIdentity(operation["id"]) || !finiteInteger(operation["sequence"], 1) || !new Set(["navigation", "mutation"]).has(String(operation["kind"]))) {
    return { code: "FADENO_UPDATE_OPERATION" };
  }
  if (typeof value["cache"] !== "string") return { code: "FADENO_UPDATE_SCHEMA" };
  const outcome = decodeOutcome(value["outcome"]);
  if (!outcome) return { code: "FADENO_UPDATE_SCHEMA" };
  return {
    envelope: Object.freeze({
      applicationGeneration: value["applicationGeneration"],
      documentEpoch: value["documentEpoch"],
      operation: Object.freeze({
        id: operation["id"],
        sequence: operation["sequence"],
        kind: operation["kind"] as "navigation" | "mutation",
      }),
      resultId: value["resultId"],
      cache: value["cache"],
      outcome,
    }),
  };
}

export function evaluatePrivateUpdate(
  value: unknown,
  context: PrivateUpdateDecisionContext,
): PrivateUpdateDecision {
  const boundary = context.boundary;
  if (boundary.bytes > V2_PATCH_PROTOCOL_LIMITS.maximumBytes
    || boundary.records > V2_PATCH_PROTOCOL_LIMITS.maximumRecords
    || boundary.depth > V2_PATCH_PROTOCOL_LIMITS.maximumDepth) {
    return refused("FADENO_UPDATE_LIMIT", context);
  }
  if (boundary.durationMilliseconds > V2_PATCH_PROTOCOL_LIMITS.maximumDurationMilliseconds) {
    return refused("FADENO_UPDATE_TIMEOUT", context);
  }
  if (context.transport.requestCache !== "no-store"
    || !hasNoStoreDirective(context.transport.responseCacheControl)) {
    return refused("FADENO_UPDATE_CACHE", context);
  }
  const decoded = decodeEnvelope(value);
  if (!decoded.envelope) return refused(decoded.code ?? "FADENO_UPDATE_SCHEMA", context);
  const envelope = decoded.envelope;
  if (envelope.cache !== "no-store") return refused("FADENO_UPDATE_CACHE", context);
  if (envelope.applicationGeneration !== context.generation) return refused("FADENO_UPDATE_GENERATION", context);
  if (envelope.documentEpoch !== context.documentEpoch) return refused("FADENO_UPDATE_DOCUMENT", context);
  if (envelope.operation.kind !== context.currentOperation.kind
    || envelope.operation.id !== context.currentOperation.id
    || envelope.operation.sequence !== context.currentOperation.sequence) {
    return refused("FADENO_UPDATE_STALE", context);
  }
  if (context.consumedResultIds.includes(envelope.resultId)) return refused("FADENO_UPDATE_DUPLICATE", context);

  const outcome = envelope.outcome;
  if (outcome.kind === "redirect") {
    if (!safeSameOriginUrl(outcome.location, context.origin)) return refused("FADENO_UPDATE_REDIRECT", context);
    if (context.currentOperation.kind === "mutation" && outcome.status !== 303) return refused("FADENO_UPDATE_REDIRECT", context);
    return accepted("FADENO_UPDATE_REDIRECT", "redirect");
  }
  if (outcome.kind === "recover") {
    if (!safeSameOriginUrl(outcome.location, context.origin)) return refused("FADENO_UPDATE_RECOVERY_URL", context);
    return Object.freeze({
      status: "recovery",
      code: "FADENO_UPDATE_RECOVERY",
      outcome: "recover",
      recovery: "reload-current-truth",
      mutationResubmission: "never",
    });
  }
  if (!safeSameOriginUrl(outcome.url, context.origin)) return refused("FADENO_UPDATE_URL", context);
  const scroll = decidePrivateScrollBoundary(outcome.scrollBoundary);
  if (scroll.decision === "refuse") return refused(scroll.code, context);
  return accepted(
    outcome.kind === "document" ? "FADENO_UPDATE_DOCUMENT" : "FADENO_UPDATE_EXPECTED_ERROR",
    outcome.kind,
  );
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!plainRecord(value)) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label}`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label}`);
  return value;
}

function parseExpected(value: unknown, label: string): PrivateUpdateDecision {
  const record = requireRecord(value, label);
  if (!exactKeys(record, ["status", "code", "outcome", "recovery", "mutationResubmission"])) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label} keys`);
  if (!new Set(["accepted", "refused", "recovery"]).has(String(record["status"]))) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label} status`);
  if (!(record["outcome"] === null || new Set(["document", "expected-error", "redirect", "recover"]).has(String(record["outcome"])))) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label} outcome`);
  if (!new Set(["none", "native-navigation", "reload-current-truth"]).has(String(record["recovery"]))) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label} recovery`);
  if (record["mutationResubmission"] !== "never") throw new Error(`FADENO_V2_FIXTURE_SCHEMA: ${label} mutation resubmission`);
  return Object.freeze({
    status: record["status"] as PrivateUpdateDecision["status"],
    code: requireString(record["code"], `${label} code`),
    outcome: record["outcome"] as PrivateUpdateDecision["outcome"],
    recovery: record["recovery"] as PrivateUpdateDecision["recovery"],
    mutationResubmission: "never",
  });
}

function parseContext(value: unknown): PrivateUpdateDecisionContext {
  const record = requireRecord(value, "baseContext");
  if (!exactKeys(record, ["origin", "transport", "generation", "documentEpoch", "currentOperation", "consumedResultIds", "requestCommitted", "boundary"])) throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext keys");
  const transport = requireRecord(record["transport"], "baseContext transport");
  const operation = requireRecord(record["currentOperation"], "baseContext currentOperation");
  const boundary = requireRecord(record["boundary"], "baseContext boundary");
  if (!exactKeys(transport, ["requestCache", "responseCacheControl"])) throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext transport keys");
  const requestCache = transport["requestCache"];
  const responseCacheControl = transport["responseCacheControl"];
  if (typeof requestCache !== "string") throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext transport values");
  if (responseCacheControl !== null && typeof responseCacheControl !== "string") throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext transport values");
  if (!exactKeys(operation, ["id", "sequence", "kind"]) || !exactKeys(boundary, ["bytes", "records", "depth", "durationMilliseconds"])) throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext nested keys");
  if (!Array.isArray(record["consumedResultIds"]) || !record["consumedResultIds"].every((item) => typeof item === "string")) throw new Error("FADENO_V2_FIXTURE_SCHEMA: consumed results");
  if (typeof record["requestCommitted"] !== "boolean" || !finiteInteger(operation["sequence"], 1) || !new Set(["navigation", "mutation"]).has(String(operation["kind"]))) throw new Error("FADENO_V2_FIXTURE_SCHEMA: baseContext operation");
  const bytes = boundary["bytes"];
  const records = boundary["records"];
  const depth = boundary["depth"];
  const durationMilliseconds = boundary["durationMilliseconds"];
  if (!finiteInteger(bytes) || !finiteInteger(records) || !finiteInteger(depth) || !finiteInteger(durationMilliseconds)) throw new Error("FADENO_V2_FIXTURE_SCHEMA: boundary metrics");
  return Object.freeze({
    origin: requireString(record["origin"], "baseContext origin"),
    transport: Object.freeze({ requestCache, responseCacheControl: responseCacheControl as string | null }),
    generation: requireString(record["generation"], "baseContext generation"),
    documentEpoch: requireString(record["documentEpoch"], "baseContext documentEpoch"),
    currentOperation: Object.freeze({ id: requireString(operation["id"], "operation id"), sequence: operation["sequence"], kind: operation["kind"] as "navigation" | "mutation" }),
    consumedResultIds: Object.freeze([...record["consumedResultIds"]] as string[]),
    requestCommitted: record["requestCommitted"],
    boundary: Object.freeze({ bytes, records, depth, durationMilliseconds }),
  });
}

export function parseV2PatchProtocolCorpus(value: unknown): V2PatchProtocolCorpus {
  const record = requireRecord(value, "corpus");
  if (!exactKeys(record, ["schemaVersion", "operation", "baseContext", "baseEnvelope", "cases"])) throw new Error("FADENO_V2_FIXTURE_SCHEMA: corpus keys");
  if (record["schemaVersion"] !== 1 || record["operation"] !== "fadeno.private.v2-patch-protocol-decision") throw new Error("FADENO_V2_FIXTURE_VERSION");
  if (!Array.isArray(record["cases"]) || record["cases"].length < 20 || record["cases"].length > 128) throw new Error("FADENO_V2_FIXTURE_SCHEMA: cases");
  const ids = new Set<string>();
  const cases = record["cases"].map((item, index) => {
    const fixture = requireRecord(item, `case ${index}`);
    if (!exactKeys(fixture, ["id", "category", "changes", "expected"])) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: case ${index} keys`);
    const id = requireString(fixture["id"], `case ${index} id`);
    if (!/^[a-z][a-z0-9-]{1,63}$/u.test(id) || ids.has(id)) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: case ${index} id`);
    ids.add(id);
    if (!Array.isArray(fixture["changes"]) || fixture["changes"].length > 8) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: case ${id} changes`);
    const changes = fixture["changes"].map((item, changeIndex) => {
      const change = requireRecord(item, `case ${id} change ${changeIndex}`);
      const allowed = change["operation"] === "set" ? ["target", "operation", "path", "value"] : ["target", "operation", "path"];
      if (!exactKeys(change, allowed) || !new Set(["context", "envelope"]).has(String(change["target"])) || !new Set(["set", "delete"]).has(String(change["operation"]))) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: case ${id} change ${changeIndex}`);
      if (!Array.isArray(change["path"]) || change["path"].length < 1 || change["path"].length > 8 || !change["path"].every((part) => typeof part === "string" || finiteInteger(part))) throw new Error(`FADENO_V2_FIXTURE_SCHEMA: case ${id} path`);
      return Object.freeze({ target: change["target"] as "context" | "envelope", operation: change["operation"] as "set" | "delete", path: Object.freeze([...change["path"]] as (string | number)[]), ...(change["operation"] === "set" ? { value: structuredClone(change["value"]) } : {}) });
    });
    return Object.freeze({ id, category: requireString(fixture["category"], `case ${id} category`), changes: Object.freeze(changes), expected: parseExpected(fixture["expected"], `case ${id} expected`) });
  });
  return Object.freeze({
    schemaVersion: 1,
    operation: "fadeno.private.v2-patch-protocol-decision",
    baseContext: parseContext(record["baseContext"]),
    baseEnvelope: structuredClone(requireRecord(record["baseEnvelope"], "baseEnvelope")),
    cases: Object.freeze(cases),
  });
}

function applyChange(root: unknown, change: V2PatchProtocolFixture["changes"][number]): void {
  let owner: unknown = root;
  for (const part of change.path.slice(0, -1)) {
    if ((typeof owner !== "object" || owner === null) || !(part in owner)) throw new Error(`FADENO_V2_FIXTURE_PATH: ${change.path.join(".")}`);
    owner = (owner as Record<string | number, unknown>)[part];
  }
  if (typeof owner !== "object" || owner === null) throw new Error(`FADENO_V2_FIXTURE_PATH: ${change.path.join(".")}`);
  const key = change.path.at(-1);
  if (key === undefined) throw new Error("FADENO_V2_FIXTURE_PATH");
  if (change.operation === "delete") {
    if (!(key in owner)) throw new Error(`FADENO_V2_FIXTURE_PATH: ${change.path.join(".")}`);
    delete (owner as Record<string | number, unknown>)[key];
  } else {
    (owner as Record<string | number, unknown>)[key] = structuredClone(change.value);
  }
}

export function runV2PatchProtocolFixture(
  corpus: V2PatchProtocolCorpus,
  fixture: V2PatchProtocolFixture,
): PrivateUpdateDecision {
  const context = structuredClone(corpus.baseContext) as PrivateUpdateDecisionContext;
  const envelope = structuredClone(corpus.baseEnvelope);
  for (const change of fixture.changes) applyChange(change.target === "context" ? context : envelope, change);
  return evaluatePrivateUpdate(envelope, context);
}
