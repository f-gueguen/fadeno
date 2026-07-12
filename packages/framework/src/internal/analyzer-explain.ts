import { isAbsolute, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AnalyzerFacetContribution } from "./analyzer-facets.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";
import {
  deserializeRouteExplainContribution,
  processRouteExplainContribution,
  ROUTE_EXPLAIN_NAMESPACE,
  serializeRouteExplainContribution,
} from "./analyzer-route-explain.ts";

export const ANALYZER_EXPLAIN_LIMITS = Object.freeze({
  maximumBytes: 262_144,
  maximumRecords: 2_048,
  maximumDepth: 16,
  maximumDurationMs: 5_000,
  maximumChildren: 256,
});

export interface AnalyzerExplainBudgets {
  readonly bytes: number;
  readonly records: number;
  readonly depth: number;
  readonly durationMs: number;
  readonly children: number;
}

export type AnalyzerExplainTruncationReason = "bytes" | "records" | "depth" | "children";

export interface AnalyzerExplainAuthority {
  readonly publication: AnalyzerPublicationSnapshot | null;
  readonly sessionId: string;
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly configurationFingerprint: string;
  readonly root: string;
  readonly documentVersions: AnalyzerPublicationSnapshot["documentVersions"];
}

export interface AnalyzerExplainCollectionContext {
  readonly publication: AnalyzerPublicationSnapshot;
  readonly detail: "semantic" | "deep";
  readonly budgets: AnalyzerExplainBudgets;
  readonly signal: AbortSignal;
  readonly requestedFacets: readonly AnalyzerExplainFacetRequest[];
}

export interface AnalyzerExplainFacetRequest {
  readonly namespace: string;
}

export interface AnalyzerExplainIdentity {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 1;
  readonly operation: "explain";
  readonly operationId: string;
  readonly sessionId: string;
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly publicationOperationId: string | null;
  readonly publicationGeneration: number | null;
  readonly requestedFacets: readonly AnalyzerExplainFacetRequest[];
  readonly documentVersions: AnalyzerPublicationSnapshot["documentVersions"];
  readonly ownership: Readonly<{
    mode: "single-root";
    root: string;
    configurationFingerprint: string;
  }>;
}

export type AnalyzerExplainRequest =
  | Readonly<{ detail: "disabled" }>
  | Readonly<{
    detail: "semantic" | "deep";
    activateDeep?: boolean;
    budgets?: Partial<AnalyzerExplainBudgets>;
    requestedFacets?: readonly AnalyzerExplainFacetRequest[];
    collect(context: AnalyzerExplainCollectionContext):
      | readonly AnalyzerFacetContribution[]
      | Promise<readonly AnalyzerFacetContribution[]>;
  }>;

export type AnalyzerExplainResult =
  | Readonly<{ status: "disabled"; identity: AnalyzerExplainIdentity }>
  | Readonly<{
    status: "complete" | "partial";
    identity: AnalyzerExplainIdentity;
    detail: "semantic" | "deep";
    budgets: AnalyzerExplainBudgets;
    contributions: readonly AnalyzerFacetContribution[];
    completeness: "complete" | "partial";
    truncation: AnalyzerExplainTruncationReason | "duration" | null;
  }>
  | Readonly<{
    status: "cancelled" | "superseded" | "stale";
    identity: AnalyzerExplainIdentity;
    code: string;
    contributions: readonly AnalyzerFacetContribution[];
    completeness: "interrupted";
    interruption: "cancelled" | "superseded" | "stale";
  }>
  | Readonly<{
    status: "refused";
    identity: AnalyzerExplainIdentity;
    code: string;
  }>;

export interface AnalyzerExplainHandle {
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly result: Promise<AnalyzerExplainResult>;
  cancel(): void;
}

interface Ticket {
  readonly operationId: string;
  readonly authority: AnalyzerExplainAuthority;
  readonly controller: AbortController;
  state: "active" | "cancelled" | "superseded" | "stale";
}

const defaultBudgets: AnalyzerExplainBudgets = Object.freeze({
  bytes: 65_536,
  records: 512,
  depth: 8,
  durationMs: 1_000,
  children: 64,
});

interface AnalyzerExplainModuleDescriptor {
  readonly namespace: string;
  process(
    contribution: AnalyzerFacetContribution,
    budgets: AnalyzerExplainBudgets,
    detail: "semantic" | "deep",
    publication: AnalyzerPublicationSnapshot,
  ): Readonly<{ contribution: AnalyzerFacetContribution | null; truncation: AnalyzerExplainTruncationReason | null }>;
  serialize(contribution: AnalyzerFacetContribution): string;
  deserialize(serialized: string): AnalyzerFacetContribution;
  matches(
    contribution: AnalyzerFacetContribution,
    identity: AnalyzerExplainIdentity,
    detail: "semantic" | "deep",
  ): boolean;
}

const explainModuleDescriptors: readonly AnalyzerExplainModuleDescriptor[] = Object.freeze([
  Object.freeze({
    namespace: ROUTE_EXPLAIN_NAMESPACE,
    process: processRouteExplainContribution,
    serialize: serializeRouteExplainContribution,
    deserialize: deserializeRouteExplainContribution,
    matches: (contribution: AnalyzerFacetContribution, identity: AnalyzerExplainIdentity, detail: "semantic" | "deep") => {
      const value = contribution.value as unknown as Readonly<{
        publicationOperationId: string;
        publicationGeneration: number;
        detail: "semantic" | "deep";
      }>;
      return value.publicationOperationId === identity.publicationOperationId &&
        value.publicationGeneration === identity.publicationGeneration && value.detail === detail;
    },
  }),
]);

function explainModule(namespace: string): AnalyzerExplainModuleDescriptor | undefined {
  return explainModuleDescriptors.find((descriptor) => descriptor.namespace === namespace);
}

function requestedFacets(input: readonly AnalyzerExplainFacetRequest[] | undefined): readonly AnalyzerExplainFacetRequest[] | null {
  const source = input ?? [{ namespace: ROUTE_EXPLAIN_NAMESPACE }];
  if (!Array.isArray(source) || source.length === 0 || source.length > explainModuleDescriptors.length) return null;
  const normalized = source.map(({ namespace }) => frozen({ namespace })).sort((left, right) =>
    left.namespace < right.namespace ? -1 : left.namespace > right.namespace ? 1 : 0);
  if (normalized.some(({ namespace }, index) =>
    !explainModule(namespace) || index > 0 && namespace === normalized[index - 1]!.namespace)) return null;
  return frozen(normalized);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function authorityIdentity(authority: AnalyzerExplainAuthority): string {
  return JSON.stringify({
    publicationOperationId: authority.publication?.operationId ?? null,
    publicationGeneration: authority.publication?.publicationGeneration ?? null,
    workspaceEpoch: authority.workspaceEpoch,
    configurationEpoch: authority.configurationEpoch,
    configurationFingerprint: authority.configurationFingerprint,
  });
}

function explainIdentity(
  operationId: string,
  authority: AnalyzerExplainAuthority,
  requests: readonly AnalyzerExplainFacetRequest[],
): AnalyzerExplainIdentity {
  return frozen({
    analyzerVersion: 1 as const,
    schemaVersion: 1 as const,
    operation: "explain" as const,
    operationId,
    sessionId: authority.sessionId,
    workspaceEpoch: authority.workspaceEpoch,
    configurationEpoch: authority.configurationEpoch,
    publicationOperationId: authority.publication?.operationId ?? null,
    publicationGeneration: authority.publication?.publicationGeneration ?? null,
    requestedFacets: frozen([...requests]),
    documentVersions: frozen([...authority.documentVersions]),
    ownership: frozen({
      mode: "single-root" as const,
      root: authority.root,
      configurationFingerprint: authority.configurationFingerprint,
    }),
  });
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function budgets(input: Partial<AnalyzerExplainBudgets> | undefined): AnalyzerExplainBudgets | null {
  const value = { ...defaultBudgets, ...input };
  if (
    !positiveInteger(value.bytes, ANALYZER_EXPLAIN_LIMITS.maximumBytes) ||
    !positiveInteger(value.records, ANALYZER_EXPLAIN_LIMITS.maximumRecords) ||
    !positiveInteger(value.depth, ANALYZER_EXPLAIN_LIMITS.maximumDepth) ||
    !positiveInteger(value.durationMs, ANALYZER_EXPLAIN_LIMITS.maximumDurationMs) ||
    !positiveInteger(value.children, ANALYZER_EXPLAIN_LIMITS.maximumChildren)
  ) return null;
  return frozen(value);
}

export class AnalyzerExplainCoordinator {
  readonly #authority: () => AnalyzerExplainAuthority;
  #active: Ticket | null = null;

  constructor(authority: () => AnalyzerExplainAuthority) {
    this.#authority = authority;
  }

  invalidate(): void {
    if (this.#active?.state !== "active") return;
    this.#active.state = "stale";
    this.#active.controller.abort(new DOMException("Stale", "AbortError"));
  }

  start(operationId: string, request: AnalyzerExplainRequest): AnalyzerExplainHandle {
    if (this.#active?.state === "active") {
      this.#active.state = "superseded";
      this.#active.controller.abort(new DOMException("Superseded", "AbortError"));
    }
    if (request.detail === "disabled") {
      const controller = new AbortController();
      const identity = explainIdentity(operationId, this.#authority(), frozen([]));
      return frozen({
        operationId,
        signal: controller.signal,
        result: Promise.resolve(frozen({ status: "disabled" as const, identity })),
        cancel: () => undefined,
      });
    }
    const ticket: Ticket = {
      operationId,
      authority: this.#authority(),
      controller: new AbortController(),
      state: "active",
    };
    this.#active = ticket;
    const result = Promise.resolve().then(() => this.#execute(ticket, request));
    return frozen({
      operationId,
      signal: ticket.controller.signal,
      result,
      cancel: () => {
        if (ticket.state !== "active") return;
        ticket.state = "cancelled";
        ticket.controller.abort(new DOMException("Cancelled", "AbortError"));
      },
    });
  }

  async #execute(ticket: Ticket, request: Exclude<AnalyzerExplainRequest, { detail: "disabled" }>): Promise<AnalyzerExplainResult> {
    const requested = requestedFacets(request.requestedFacets);
    const identity = explainIdentity(
      ticket.operationId,
      ticket.authority,
      requested ?? frozen([frozen({ namespace: ROUTE_EXPLAIN_NAMESPACE })]),
    );
    const interrupted = (status: "cancelled" | "superseded" | "stale", code: string): AnalyzerExplainResult => frozen({
      status, identity, code,
      contributions: frozen([]), completeness: "interrupted" as const, interruption: status,
    });
    const terminal = (): AnalyzerExplainResult | null => {
      if (ticket.state === "cancelled") return interrupted("cancelled", "FADENO_ANALYZER_EXPLAIN_CANCELLED");
      if (ticket.state === "stale") return interrupted("stale", "FADENO_ANALYZER_EXPLAIN_STALE");
      if (ticket.state === "superseded" || this.#active !== ticket) {
        return interrupted("superseded", "FADENO_ANALYZER_EXPLAIN_SUPERSEDED");
      }
      if (authorityIdentity(this.#authority()) !== authorityIdentity(ticket.authority)) {
        return interrupted("stale", "FADENO_ANALYZER_EXPLAIN_STALE");
      }
      return null;
    };
    let stopped = terminal();
    if (stopped) return this.#finish(ticket, stopped);
    const publication = ticket.authority.publication;
    if (!publication) return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_PUBLICATION" }));
    if (!requested) return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_REQUEST" }));
    if (request.detail === "deep" && request.activateDeep !== true || request.detail === "semantic" && request.activateDeep === true) {
      return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_ACTIVATION" }));
    }
    const bounded = budgets(request.budgets);
    if (!bounded) return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_BUDGET" }));
    const collectionContext = frozen({
      publication,
      detail: request.detail,
      budgets: bounded,
      signal: ticket.controller.signal,
      requestedFacets: requested,
    });
    const startedAt = performance.now();
    const collected = Promise.resolve().then(() => request.collect(collectionContext)).then(
      (value) => ({ kind: "collected" as const, value }),
      () => ({ kind: "failed" as const }),
    );
    const aborted = new Promise<Readonly<{ kind: "aborted" }>>((resolve) => {
      if (ticket.controller.signal.aborted) resolve({ kind: "aborted" });
      else ticket.controller.signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
    });
    let durationTimer: ReturnType<typeof setTimeout> | undefined;
    const duration = new Promise<Readonly<{ kind: "duration" }>>((resolve) => {
      durationTimer = setTimeout(() => resolve({ kind: "duration" }), bounded.durationMs);
    });
    const outcome = await Promise.race([collected, aborted, duration]);
    if (durationTimer !== undefined) clearTimeout(durationTimer);
    stopped = terminal();
    if (stopped) return this.#finish(ticket, stopped);
    const durationExpired = outcome.kind === "duration" || performance.now() - startedAt >= bounded.durationMs;
    if (durationExpired || outcome.kind !== "collected" || !Array.isArray(outcome.value)) {
      if (durationExpired) {
        ticket.controller.abort(new DOMException("Duration limit", "TimeoutError"));
        return this.#finish(ticket, frozen({
          status: "partial" as const, identity,
          detail: request.detail, budgets: bounded, contributions: frozen([]), completeness: "partial" as const,
          truncation: "duration" as const,
        }));
      }
      return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_COLLECTION" }));
    }
    let truncation: AnalyzerExplainTruncationReason | null = null;
    let contributions: AnalyzerFacetContribution[];
    try {
      if (outcome.value.length !== requested.length) throw new TypeError("FADENO_ANALYZER_EXPLAIN_CONTRIBUTION_COUNT");
      const ordered = [...outcome.value].sort((left, right) =>
        left.namespace < right.namespace ? -1 : left.namespace > right.namespace ? 1 : 0);
      contributions = ordered.flatMap((contribution, index) => {
        const descriptor = explainModule(requested[index]!.namespace);
        if (!descriptor || contribution.namespace !== descriptor.namespace) {
          throw new TypeError("FADENO_ANALYZER_EXPLAIN_CONTRIBUTION_NAMESPACE");
        }
        const processed = descriptor.process(contribution, bounded, request.detail, publication);
        truncation ??= processed.truncation;
        return processed.contribution === null ? [] : [processed.contribution];
      });
    } catch {
      return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_CONTRIBUTION" }));
    }
    if (performance.now() - startedAt >= bounded.durationMs) {
      ticket.controller.abort(new DOMException("Duration limit", "TimeoutError"));
      return this.#finish(ticket, frozen({
        status: "partial" as const, identity, detail: request.detail, budgets: bounded,
        contributions: frozen([]), completeness: "partial" as const, truncation: "duration" as const,
      }));
    }
    const result = frozen({
      status: truncation === null ? "complete" as const : "partial" as const,
      identity,
      detail: request.detail,
      budgets: bounded,
      contributions: frozen(contributions),
      completeness: truncation === null ? "complete" as const : "partial" as const,
      truncation,
    });
    return this.#finish(ticket, result);
  }

  #finish(ticket: Ticket, result: AnalyzerExplainResult): AnalyzerExplainResult {
    if (this.#active === ticket) this.#active = null;
    return result;
  }
}

// Publication identity is already bounded by the 9 MB publication transport;
// this envelope adds requested module evidence and retains room for the maximum
// canonical document-version set while carrying no document text.
const explainSerializationMaximumBytes = 20_000_000;
const analyzerSessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const explainRefusalCodes = new Set([
  "FADENO_ANALYZER_EXPLAIN_PUBLICATION",
  "FADENO_ANALYZER_EXPLAIN_REQUEST",
  "FADENO_ANALYZER_EXPLAIN_ACTIVATION",
  "FADENO_ANALYZER_EXPLAIN_BUDGET",
  "FADENO_ANALYZER_EXPLAIN_COLLECTION",
  "FADENO_ANALYZER_EXPLAIN_CONTRIBUTION",
]);

function serializationRefuse(): never {
  throw new TypeError("FADENO_ANALYZER_EXPLAIN_SERIALIZATION");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) serializationRefuse();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) serializationRefuse();
  return record;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value);
  }
  return value;
}

function validateSerializedIdentity(value: unknown, requested: boolean): AnalyzerExplainIdentity {
  const identity = exactRecord(value, [
    "analyzerVersion", "schemaVersion", "operation", "operationId", "sessionId", "workspaceEpoch", "configurationEpoch",
    "publicationOperationId", "publicationGeneration", "requestedFacets", "documentVersions", "ownership",
  ]);
  if (
    identity["analyzerVersion"] !== 1 || identity["schemaVersion"] !== 1 || identity["operation"] !== "explain" ||
    typeof identity["sessionId"] !== "string" || !analyzerSessionIdPattern.test(identity["sessionId"]) ||
    typeof identity["operationId"] !== "string" ||
    !new RegExp(`^${identity["sessionId"]}:operation-[1-9][0-9]*$`, "u").test(identity["operationId"]) ||
    !nonNegativeInteger(identity["workspaceEpoch"]) || !nonNegativeInteger(identity["configurationEpoch"]) ||
    !Array.isArray(identity["requestedFacets"]) || !Array.isArray(identity["documentVersions"])
  ) serializationRefuse();
  const publicationOperationId = identity["publicationOperationId"];
  const publicationGeneration = identity["publicationGeneration"];
  if (
    publicationOperationId !== null && (
      typeof publicationOperationId !== "string" ||
      !new RegExp(`^${identity["sessionId"]}:operation-[1-9][0-9]*$`, "u").test(publicationOperationId)
    ) ||
    publicationGeneration !== null && (!Number.isSafeInteger(publicationGeneration) || (publicationGeneration as number) < 1) ||
    (publicationOperationId === null) !== (publicationGeneration === null)
  ) serializationRefuse();
  const requestedFacets = identity["requestedFacets"] as unknown[];
  if (requested ? requestedFacets.length === 0 || requestedFacets.length > explainModuleDescriptors.length : requestedFacets.length !== 0) {
    serializationRefuse();
  }
  let priorRequested: string | undefined;
  for (const value of requestedFacets) {
    const facet = exactRecord(value, ["namespace"]);
    const namespace = facet["namespace"];
    if (
      typeof namespace !== "string" || !explainModule(namespace) ||
      priorRequested !== undefined && priorRequested >= namespace
    ) serializationRefuse();
    priorRequested = namespace;
  }
  const ownership = exactRecord(identity["ownership"], ["mode", "root", "configurationFingerprint"]);
  if (
    ownership["mode"] !== "single-root" || typeof ownership["root"] !== "string" ||
    !ownership["root"].startsWith("file:") || typeof ownership["configurationFingerprint"] !== "string" ||
    !/^[0-9a-f]{64}$/u.test(ownership["configurationFingerprint"])
  ) serializationRefuse();
  let rootPath: string;
  try {
    const rootUrl = new URL(ownership["root"] as string);
    if (rootUrl.protocol !== "file:" || rootUrl.hostname !== "" || rootUrl.search !== "" || rootUrl.hash !== "") serializationRefuse();
    rootPath = fileURLToPath(rootUrl);
    if (pathToFileURL(rootPath).href !== rootUrl.href) serializationRefuse();
  } catch { serializationRefuse(); }
  let priorUri: string | undefined;
  for (const entry of identity["documentVersions"] as unknown[]) {
    const document = exactRecord(entry, ["uri", "version", "lifetime"]);
    if (
      typeof document["uri"] !== "string" || document["uri"].length === 0 ||
      !nonNegativeInteger(document["version"]) || !Number.isSafeInteger(document["lifetime"]) ||
      (document["lifetime"] as number) < 1 || (priorUri !== undefined && priorUri >= document["uri"])
    ) serializationRefuse();
    let documentPath: string;
    try {
      const documentUrl = new URL(document["uri"] as string);
      if (documentUrl.protocol !== "file:" || documentUrl.hostname !== "" || documentUrl.search !== "" || documentUrl.hash !== "") {
        serializationRefuse();
      }
      documentPath = fileURLToPath(documentUrl);
      if (pathToFileURL(documentPath).href !== documentUrl.href) serializationRefuse();
    } catch { serializationRefuse(); }
    const contained = relative(rootPath, documentPath);
    if (contained === "" || contained.startsWith("..") || isAbsolute(contained)) serializationRefuse();
    priorUri = document["uri"];
  }
  return deepFreeze(identity) as unknown as AnalyzerExplainIdentity;
}

function validateSerializedBudgets(value: unknown): AnalyzerExplainBudgets {
  const source = exactRecord(value, ["bytes", "records", "depth", "durationMs", "children"]);
  const validated = budgets(source as Partial<AnalyzerExplainBudgets>);
  if (!validated || JSON.stringify(validated) !== JSON.stringify(source)) serializationRefuse();
  return validated;
}

function validateSerializedResult(value: unknown): AnalyzerExplainResult {
  const statusValue = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)["status"]
    : undefined;
  if (statusValue === "disabled") {
    const source = exactRecord(value, ["status", "identity"]);
    return deepFreeze({ ...source, identity: validateSerializedIdentity(source["identity"], false) }) as unknown as AnalyzerExplainResult;
  }
  if (statusValue === "refused") {
    const source = exactRecord(value, ["status", "identity", "code"]);
    const identity = validateSerializedIdentity(source["identity"], true);
    if (typeof source["code"] !== "string" || !explainRefusalCodes.has(source["code"])) serializationRefuse();
    return deepFreeze({ ...source, identity }) as unknown as AnalyzerExplainResult;
  }
  if (statusValue === "cancelled" || statusValue === "superseded" || statusValue === "stale") {
    const source = exactRecord(value, ["status", "identity", "code", "contributions", "completeness", "interruption"]);
    const identity = validateSerializedIdentity(source["identity"], true);
    const expectedCode = `FADENO_ANALYZER_EXPLAIN_${statusValue.toUpperCase()}`;
    if (
      source["code"] !== expectedCode || source["completeness"] !== "interrupted" || source["interruption"] !== statusValue ||
      !Array.isArray(source["contributions"]) || source["contributions"].length !== 0
    ) serializationRefuse();
    return deepFreeze({ ...source, identity, contributions: [] }) as unknown as AnalyzerExplainResult;
  }
  if (statusValue === "complete" || statusValue === "partial") {
    const source = exactRecord(value, [
      "status", "identity", "detail", "budgets", "contributions", "completeness", "truncation",
    ]);
    const identity = validateSerializedIdentity(source["identity"], true);
    const validatedBudgets = validateSerializedBudgets(source["budgets"]);
    if (source["detail"] !== "semantic" && source["detail"] !== "deep") serializationRefuse();
    const allowedTruncations = ["bytes", "records", "depth", "children", "duration"];
    if (
      source["completeness"] !== statusValue ||
      (statusValue === "complete" ? source["truncation"] !== null : !allowedTruncations.includes(source["truncation"] as string)) ||
      !Array.isArray(source["contributions"])
    ) serializationRefuse();
    const contributionCount = source["contributions"].length;
    if (
      source["truncation"] === "duration" ? contributionCount !== 0 :
        source["truncation"] === "bytes" ? contributionCount !== 0 && contributionCount !== identity.requestedFacets.length :
          contributionCount !== identity.requestedFacets.length
    ) serializationRefuse();
    const processedContributions = (source["contributions"] as unknown[]).map((contribution, index) => {
      const descriptor = explainModule(identity.requestedFacets[index]!.namespace);
      if (!descriptor) serializationRefuse();
      const validated = descriptor.deserialize(descriptor.serialize(contribution as AnalyzerFacetContribution));
      if (validated.namespace !== descriptor.namespace || !descriptor.matches(validated, identity, source["detail"] as "semantic" | "deep")) {
        serializationRefuse();
      }
      const processed = descriptor.process(
        validated,
        validatedBudgets,
        source["detail"] as "semantic" | "deep",
        {
          operationId: identity.publicationOperationId,
          publicationGeneration: identity.publicationGeneration,
        } as AnalyzerPublicationSnapshot,
      );
      if (!processed.contribution || JSON.stringify(processed.contribution) !== JSON.stringify(validated)) serializationRefuse();
      return { contribution: validated, truncation: processed.truncation };
    });
    const contributions = processedContributions.map(({ contribution }) => contribution);
    if (statusValue === "complete") {
      if (processedContributions.some(({ truncation }) => truncation !== null)) serializationRefuse();
    } else if (source["truncation"] === "bytes") {
      if (contributions.length > 0 && !processedContributions.some(({ truncation }) => truncation === "bytes")) serializationRefuse();
    } else if (
      source["truncation"] !== "duration" &&
      !processedContributions.some(({ truncation }) => truncation === source["truncation"])
    ) serializationRefuse();
    return deepFreeze({
      ...source,
      identity,
      budgets: validatedBudgets,
      contributions,
    }) as unknown as AnalyzerExplainResult;
  }
  serializationRefuse();
}

export function serializeAnalyzerExplainResult(result: AnalyzerExplainResult): string {
  try {
    const serialized = JSON.stringify({
      format: "fadeno-private-analyzer-explain",
      serializationVersion: 1,
      result: validateSerializedResult(result),
    });
    if (new TextEncoder().encode(serialized).byteLength > explainSerializationMaximumBytes) serializationRefuse();
    deserializeAnalyzerExplainResult(serialized);
    return serialized;
  } catch {
    serializationRefuse();
  }
}

export function deserializeAnalyzerExplainResult(serialized: string): AnalyzerExplainResult {
  try {
    if (
      typeof serialized !== "string" || serialized.length > explainSerializationMaximumBytes ||
      new TextEncoder().encode(serialized).byteLength > explainSerializationMaximumBytes
    ) {
      serializationRefuse();
    }
    const envelope = exactRecord(JSON.parse(serialized) as unknown, ["format", "serializationVersion", "result"]);
    if (envelope["format"] !== "fadeno-private-analyzer-explain" || envelope["serializationVersion"] !== 1) {
      serializationRefuse();
    }
    return validateSerializedResult(envelope["result"]);
  } catch {
    serializationRefuse();
  }
}
