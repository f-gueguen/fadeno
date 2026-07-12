import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextEncoder, types as utilTypes } from "node:util";

import type { AnalyzerDocumentOnlySnapshot } from "./analyzer-session.ts";

export const ANALYZER_FACET_LIMITS = Object.freeze({
  maximumFacets: 32,
  maximumFacetBytes: 65_536,
  maximumTotalBytes: 262_144,
  maximumDepth: 16,
  maximumNodes: 4_096,
});

export type AnalyzerFacetScalar = null | boolean | number | string;
export type AnalyzerFacetValue =
  | AnalyzerFacetScalar
  | readonly AnalyzerFacetValue[]
  | Readonly<{ readonly [key: string]: AnalyzerFacetValue }>;

export interface AnalyzerFacetRequest {
  readonly namespace: string;
}

export interface AnalyzerFacetContribution {
  readonly namespace: string;
  readonly version: number;
  readonly value: AnalyzerFacetValue;
}

export interface AnalyzerFacetSnapshot {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 2;
  readonly sessionId: string;
  readonly operationId: string;
  readonly operation: "facets";
  readonly workspaceEpoch: number;
  readonly requestedFacets: readonly AnalyzerFacetRequest[];
  readonly documentVersions: AnalyzerDocumentOnlySnapshot["documentVersions"];
  readonly ownership: AnalyzerDocumentOnlySnapshot["ownership"];
  readonly documents: AnalyzerDocumentOnlySnapshot["documents"];
  readonly facets: readonly AnalyzerFacetContribution[];
  readonly completeness: "complete";
  readonly interruption: null;
  readonly truncated: false;
}

export type AnalyzerFacetRefusalCode =
  | "FADENO_ANALYZER_FACET_NAMESPACE"
  | "FADENO_ANALYZER_FACET_VERSION"
  | "FADENO_ANALYZER_FACET_DUPLICATE"
  | "FADENO_ANALYZER_FACET_UNREQUESTED"
  | "FADENO_ANALYZER_FACET_VALUE"
  | "FADENO_ANALYZER_FACET_LIMIT"
  | "FADENO_ANALYZER_SERIALIZATION";

export type AnalyzerFacetOperationResult =
  | Readonly<{ accepted: true; operationId: string; snapshot: AnalyzerFacetSnapshot }>
  | Readonly<{ accepted: false; operationId: string; code: AnalyzerFacetRefusalCode; currentEpoch: number }>;

export type AnalyzerFacetReadResult =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "unknown"; namespace: string; version: number; opaque: AnalyzerFacetValue }>
  | Readonly<{ state: "newer"; namespace: string; version: number; supportedVersion: number; opaque: AnalyzerFacetValue }>
  | Readonly<{ state: "supported"; namespace: string; version: number; value: AnalyzerFacetValue }>;

const encoder = new TextEncoder();
const namespacePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u;

class FacetRefusal extends Error {
  readonly code: AnalyzerFacetRefusalCode;

  constructor(code: AnalyzerFacetRefusalCode) {
    super(code);
    this.code = code;
  }
}

function refuse(code: AnalyzerFacetRefusalCode): never {
  throw new FacetRefusal(code);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertNamespace(value: unknown): asserts value is string {
  if (typeof value !== "string" || !namespacePattern.test(value)) refuse("FADENO_ANALYZER_FACET_NAMESPACE");
}

function assertFacetVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) refuse("FADENO_ANALYZER_FACET_VERSION");
}

function normalizeValue(value: unknown, depth: number, counter: { nodes: number }): AnalyzerFacetValue {
  counter.nodes += 1;
  if (counter.nodes > ANALYZER_FACET_LIMITS.maximumNodes || depth > ANALYZER_FACET_LIMITS.maximumDepth) {
    refuse("FADENO_ANALYZER_FACET_LIMIT");
  }
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) refuse("FADENO_ANALYZER_FACET_VALUE");
    return value;
  }
  if (typeof value === "object" && value !== null && utilTypes.isProxy(value)) refuse("FADENO_ANALYZER_FACET_VALUE");
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length") || ownKeys.some((key) => typeof key !== "string")) {
      refuse("FADENO_ANALYZER_FACET_VALUE");
    }
    const result: AnalyzerFacetValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) refuse("FADENO_ANALYZER_FACET_VALUE");
      result.push(normalizeValue(descriptor.value, depth + 1, counter));
    }
    return frozen(result);
  }
  if (typeof value !== "object" || value === undefined) refuse("FADENO_ANALYZER_FACET_VALUE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse("FADENO_ANALYZER_FACET_VALUE");
  const source = value as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const result: Record<string, AnalyzerFacetValue> = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) refuse("FADENO_ANALYZER_FACET_VALUE");
    Object.defineProperty(result, key, {
      value: normalizeValue(descriptor.value, depth + 1, counter),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (Reflect.ownKeys(source).length !== Object.keys(descriptors).length) refuse("FADENO_ANALYZER_FACET_VALUE");
  return frozen(result);
}

function encodedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    refuse("FADENO_ANALYZER_SERIALIZATION");
  }
}

function asRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("FADENO_ANALYZER_SERIALIZATION");
  const record = value as Record<string, unknown>;
  assertExactKeys(record, keys);
  return record;
}

function assertNonNegativeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) refuse("FADENO_ANALYZER_SERIALIZATION");
}

function validateDocumentEnvelope(source: Record<string, unknown>): void {
  const versions = source["documentVersions"] as unknown[];
  const documents = source["documents"] as unknown[];
  const sessionId = source["sessionId"] as string;
  const operationId = source["operationId"] as string;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(sessionId) ||
    !operationId.startsWith(`${sessionId}:operation-`) ||
    !/^[1-9][0-9]*$/u.test(operationId.slice(`${sessionId}:operation-`.length)) ||
    !Number.isSafeInteger(Number(operationId.slice(`${sessionId}:operation-`.length)))
  ) refuse("FADENO_ANALYZER_SERIALIZATION");
  const ownership = source["ownership"] as Record<string, unknown>;
  const root = ownership["root"] as string;
  let rootUrl: URL;
  let rootPath: string;
  try {
    rootUrl = new URL(root);
    if (rootUrl.protocol !== "file:" || rootUrl.host !== "" || rootUrl.search !== "" || rootUrl.hash !== "") {
      refuse("FADENO_ANALYZER_SERIALIZATION");
    }
    rootPath = fileURLToPath(rootUrl);
  } catch {
    refuse("FADENO_ANALYZER_SERIALIZATION");
  }
  if (!rootPath.endsWith(sep) || pathToFileURL(rootPath).href !== root) refuse("FADENO_ANALYZER_SERIALIZATION");
  const seenVersions = new Set<string>();
  for (const entry of versions) {
    const version = asRecord(entry, ["uri", "version", "lifetime"]);
    if (typeof version["uri"] !== "string") refuse("FADENO_ANALYZER_SERIALIZATION");
    assertNonNegativeInteger(version["version"]);
    assertNonNegativeInteger(version["lifetime"]);
    if (version["lifetime"] === 0) refuse("FADENO_ANALYZER_SERIALIZATION");
    if (seenVersions.has(version["uri"])) refuse("FADENO_ANALYZER_SERIALIZATION");
    seenVersions.add(version["uri"]);
  }
  const seenDocuments = new Set<string>();
  let previousPath: string | undefined;
  for (const entry of documents) {
    const document = asRecord(entry, ["path", "uri", "savedRevision", "open", "effective"]);
    if (typeof document["path"] !== "string" || document["path"].length === 0 || typeof document["uri"] !== "string") {
      refuse("FADENO_ANALYZER_SERIALIZATION");
    }
    const candidate = resolve(rootPath, ...document["path"].split("/"));
    const containment = relative(rootPath, candidate);
    if (
      containment === "" || containment.startsWith("..") || isAbsolute(containment) ||
      containment.split(sep).join("/") !== document["path"] || pathToFileURL(candidate).href !== document["uri"]
    ) refuse("FADENO_ANALYZER_SERIALIZATION");
    assertNonNegativeInteger(document["savedRevision"]);
    if (previousPath !== undefined && compareText(previousPath, document["path"]) >= 0) refuse("FADENO_ANALYZER_SERIALIZATION");
    previousPath = document["path"];
    if (seenDocuments.has(document["uri"])) refuse("FADENO_ANALYZER_SERIALIZATION");
    seenDocuments.add(document["uri"]);
    const effective = asRecord(document["effective"], ["source", "text"]);
    if ((effective["source"] !== "saved" && effective["source"] !== "overlay") || typeof effective["text"] !== "string") {
      refuse("FADENO_ANALYZER_SERIALIZATION");
    }
    if (document["open"] === null) {
      if (effective["source"] !== "saved" || seenVersions.has(document["uri"])) refuse("FADENO_ANALYZER_SERIALIZATION");
      continue;
    }
    const open = asRecord(document["open"], ["version", "lifetime"]);
    assertNonNegativeInteger(open["version"]);
    assertNonNegativeInteger(open["lifetime"]);
    if (open["lifetime"] === 0) refuse("FADENO_ANALYZER_SERIALIZATION");
    if (effective["source"] !== "overlay") refuse("FADENO_ANALYZER_SERIALIZATION");
    const matchingVersion = versions.find((candidate) => {
      const record = candidate as Record<string, unknown>;
      return record["uri"] === document["uri"] && record["version"] === open["version"] && record["lifetime"] === open["lifetime"];
    });
    if (!matchingVersion) refuse("FADENO_ANALYZER_SERIALIZATION");
  }
  if (versions.length !== documents.filter((entry) => (entry as Record<string, unknown>)["open"] !== null).length) {
    refuse("FADENO_ANALYZER_SERIALIZATION");
  }
  const openDocuments = documents.filter((entry) => (entry as Record<string, unknown>)["open"] !== null);
  for (const [index, entry] of openDocuments.entries()) {
    const document = entry as Record<string, unknown>;
    const open = document["open"] as Record<string, unknown>;
    const version = versions[index] as Record<string, unknown> | undefined;
    if (
      !version || version["uri"] !== document["uri"] ||
      version["version"] !== open["version"] || version["lifetime"] !== open["lifetime"]
    ) refuse("FADENO_ANALYZER_SERIALIZATION");
  }
}

export function createAnalyzerFacetSnapshot(
  base: AnalyzerDocumentOnlySnapshot,
  operationId: string,
  requests: readonly AnalyzerFacetRequest[],
  contributions: readonly AnalyzerFacetContribution[],
): AnalyzerFacetOperationResult {
  try {
    if (!Array.isArray(requests) || !Array.isArray(contributions)) refuse("FADENO_ANALYZER_FACET_VALUE");
    if (requests.length > ANALYZER_FACET_LIMITS.maximumFacets || contributions.length > ANALYZER_FACET_LIMITS.maximumFacets) {
      refuse("FADENO_ANALYZER_FACET_LIMIT");
    }
    const requested = new Set<string>();
    const normalizedRequests = requests.map((request) => {
      if (typeof request !== "object" || request === null) refuse("FADENO_ANALYZER_FACET_VALUE");
      assertNamespace(request.namespace);
      if (requested.has(request.namespace)) refuse("FADENO_ANALYZER_FACET_DUPLICATE");
      requested.add(request.namespace);
      return frozen({ namespace: request.namespace });
    }).sort((left, right) => compareText(left.namespace, right.namespace));

    const contributed = new Set<string>();
    let totalBytes = 0;
    const normalizedContributions = contributions.map((contribution) => {
      if (typeof contribution !== "object" || contribution === null) refuse("FADENO_ANALYZER_FACET_VALUE");
      assertNamespace(contribution.namespace);
      assertFacetVersion(contribution.version);
      if (!requested.has(contribution.namespace)) refuse("FADENO_ANALYZER_FACET_UNREQUESTED");
      if (contributed.has(contribution.namespace)) refuse("FADENO_ANALYZER_FACET_DUPLICATE");
      contributed.add(contribution.namespace);
      const value = normalizeValue(contribution.value, 0, { nodes: 0 });
      const normalized = frozen({ namespace: contribution.namespace, version: contribution.version, value });
      const bytes = encodedBytes(normalized);
      if (bytes > ANALYZER_FACET_LIMITS.maximumFacetBytes) refuse("FADENO_ANALYZER_FACET_LIMIT");
      totalBytes += bytes;
      if (totalBytes > ANALYZER_FACET_LIMITS.maximumTotalBytes) refuse("FADENO_ANALYZER_FACET_LIMIT");
      return normalized;
    }).sort((left, right) => compareText(left.namespace, right.namespace));

    const snapshot = frozen({
      analyzerVersion: 1 as const,
      schemaVersion: 2 as const,
      sessionId: base.sessionId,
      operationId,
      operation: "facets" as const,
      workspaceEpoch: base.workspaceEpoch,
      requestedFacets: frozen(normalizedRequests),
      documentVersions: base.documentVersions,
      ownership: base.ownership,
      documents: base.documents,
      facets: frozen(normalizedContributions),
      completeness: "complete" as const,
      interruption: null,
      truncated: false as const,
    });
    return frozen({ accepted: true as const, operationId, snapshot });
  } catch (error) {
    if (!(error instanceof FacetRefusal)) throw error;
    return frozen({ accepted: false as const, operationId, code: error.code, currentEpoch: base.workspaceEpoch });
  }
}

export function readAnalyzerFacet(
  snapshot: AnalyzerFacetSnapshot,
  namespace: string,
  supportedVersions: Readonly<Record<string, number>>,
): AnalyzerFacetReadResult {
  assertNamespace(namespace);
  const contribution = snapshot.facets.find((facet) => facet.namespace === namespace);
  if (!contribution) return frozen({ state: "absent" as const });
  if (!Object.hasOwn(supportedVersions, namespace)) {
    return frozen({ state: "unknown" as const, namespace, version: contribution.version, opaque: contribution.value });
  }
  const supportedVersion = supportedVersions[namespace];
  assertFacetVersion(supportedVersion);
  if (contribution.version > supportedVersion) {
    return frozen({ state: "newer" as const, namespace, version: contribution.version, supportedVersion, opaque: contribution.value });
  }
  return frozen({ state: "supported" as const, namespace, version: contribution.version, value: contribution.value });
}

export function serializeAnalyzerFacetSnapshot(snapshot: AnalyzerFacetSnapshot): string {
  try {
    const serialized = JSON.stringify({
      format: "fadeno-private-analyzer-snapshot",
      serializationVersion: 1,
      snapshot,
    });
    deserializeAnalyzerFacetSnapshot(serialized);
    return serialized;
  } catch {
    throw new TypeError("FADENO_ANALYZER_SERIALIZATION");
  }
}

export function deserializeAnalyzerFacetSnapshot(serialized: string): AnalyzerFacetSnapshot {
  try {
    if (typeof serialized !== "string") refuse("FADENO_ANALYZER_SERIALIZATION");
    const envelope = JSON.parse(serialized) as unknown;
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) refuse("FADENO_ANALYZER_SERIALIZATION");
    const record = envelope as Record<string, unknown>;
    assertExactKeys(record, ["format", "serializationVersion", "snapshot"]);
    if (record["format"] !== "fadeno-private-analyzer-snapshot" || record["serializationVersion"] !== 1) {
      refuse("FADENO_ANALYZER_SERIALIZATION");
    }
    const snapshot = record["snapshot"];
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) refuse("FADENO_ANALYZER_SERIALIZATION");
    const source = snapshot as Record<string, unknown>;
    assertExactKeys(source, [
      "analyzerVersion", "schemaVersion", "sessionId", "operationId", "operation", "workspaceEpoch",
      "requestedFacets", "documentVersions", "ownership", "documents", "facets", "completeness", "interruption", "truncated",
    ]);
    if (
      source["analyzerVersion"] !== 1 || source["schemaVersion"] !== 2 || source["operation"] !== "facets" ||
      typeof source["sessionId"] !== "string" || source["sessionId"].length === 0 ||
      typeof source["operationId"] !== "string" || source["operationId"].length === 0 ||
      !Number.isSafeInteger(source["workspaceEpoch"]) || (source["workspaceEpoch"] as number) < 0 ||
      source["completeness"] !== "complete" || source["interruption"] !== null || source["truncated"] !== false ||
      !Array.isArray(source["requestedFacets"]) || !Array.isArray(source["documentVersions"]) ||
      !Array.isArray(source["documents"]) || !Array.isArray(source["facets"])
    ) refuse("FADENO_ANALYZER_SERIALIZATION");
    const ownership = source["ownership"];
    if (typeof ownership !== "object" || ownership === null || Array.isArray(ownership)) refuse("FADENO_ANALYZER_SERIALIZATION");
    const ownershipRecord = ownership as Record<string, unknown>;
    assertExactKeys(ownershipRecord, ["mode", "root"]);
    if (ownershipRecord["mode"] !== "single-root" || typeof ownershipRecord["root"] !== "string") refuse("FADENO_ANALYZER_SERIALIZATION");
    validateDocumentEnvelope(source);

    const base = deepFreezeParsed(source) as unknown as AnalyzerFacetSnapshot;
    const rebuilt = createAnalyzerFacetSnapshot(
      {
        analyzerVersion: 1,
        schemaVersion: 1,
        sessionId: base.sessionId,
        operationId: base.operationId,
        operation: "initialize",
        workspaceEpoch: base.workspaceEpoch,
        requestedFacets: [],
        documentVersions: base.documentVersions,
        ownership: base.ownership,
        documents: base.documents,
        completeness: "complete",
        interruption: null,
        truncated: false,
      },
      base.operationId,
      base.requestedFacets,
      base.facets,
    );
    if (!rebuilt.accepted || JSON.stringify(rebuilt.snapshot) !== JSON.stringify(base)) refuse("FADENO_ANALYZER_SERIALIZATION");
    return base;
  } catch (error) {
    if (error instanceof FacetRefusal) throw new TypeError(error.code);
    throw new TypeError("FADENO_ANALYZER_SERIALIZATION");
  }
}

function deepFreezeParsed(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreezeParsed(entry);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreezeParsed(entry);
    return Object.freeze(value);
  }
  return value;
}
