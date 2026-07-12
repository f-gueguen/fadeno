import type { AnalyzerFacetContribution } from "./analyzer-facets.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";
import {
  deserializeRouteExplainContribution,
  processRouteExplainContribution,
  ROUTE_EXPLAIN_NAMESPACE,
  serializeRouteExplainContribution,
  type RouteExplainTruncationReason,
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

export interface AnalyzerExplainAuthority {
  readonly publication: AnalyzerPublicationSnapshot | null;
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly configurationFingerprint: string;
}

export interface AnalyzerExplainCollectionContext {
  readonly publication: AnalyzerPublicationSnapshot;
  readonly detail: "semantic" | "deep";
  readonly budgets: AnalyzerExplainBudgets;
  readonly signal: AbortSignal;
}

export interface AnalyzerExplainIdentity {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 1;
  readonly operation: "explain";
  readonly operationId: string;
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly publicationOperationId: string | null;
  readonly publicationGeneration: number | null;
  readonly requestedFacets: readonly Readonly<{ namespace: typeof ROUTE_EXPLAIN_NAMESPACE }>[];
  readonly documentVersions: AnalyzerPublicationSnapshot["documentVersions"];
}

export type AnalyzerExplainRequest =
  | Readonly<{ detail: "disabled" }>
  | Readonly<{
    detail: "semantic" | "deep";
    activateDeep?: boolean;
    budgets?: Partial<AnalyzerExplainBudgets>;
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
    truncation: RouteExplainTruncationReason | "duration" | null;
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
  requested: boolean,
): AnalyzerExplainIdentity {
  return frozen({
    analyzerVersion: 1 as const,
    schemaVersion: 1 as const,
    operation: "explain" as const,
    operationId,
    workspaceEpoch: authority.workspaceEpoch,
    configurationEpoch: authority.configurationEpoch,
    publicationOperationId: authority.publication?.operationId ?? null,
    publicationGeneration: authority.publication?.publicationGeneration ?? null,
    requestedFacets: requested ? frozen([frozen({ namespace: ROUTE_EXPLAIN_NAMESPACE })]) : frozen([]),
    documentVersions: frozen([...(authority.publication?.documentVersions ?? [])]),
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
    if (request.detail === "disabled") {
      const controller = new AbortController();
      const identity = explainIdentity(operationId, this.#authority(), false);
      return frozen({
        operationId,
        signal: controller.signal,
        result: Promise.resolve(frozen({ status: "disabled" as const, identity })),
        cancel: () => undefined,
      });
    }
    if (this.#active?.state === "active") {
      this.#active.state = "superseded";
      this.#active.controller.abort(new DOMException("Superseded", "AbortError"));
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
    const identity = explainIdentity(ticket.operationId, ticket.authority, true);
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
    let truncation: RouteExplainTruncationReason | null = null;
    let contributions: AnalyzerFacetContribution[];
    try {
      if (outcome.value.length !== 1) throw new TypeError("FADENO_ANALYZER_EXPLAIN_CONTRIBUTION_COUNT");
      contributions = outcome.value.map((contribution) => {
        const processed = processRouteExplainContribution(contribution, bounded, request.detail);
        truncation ??= processed.truncation;
        return processed.contribution;
      });
    } catch {
      return this.#finish(ticket, frozen({ status: "refused" as const, identity, code: "FADENO_ANALYZER_EXPLAIN_CONTRIBUTION" }));
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

const explainSerializationMaximumBytes = 300_000;

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

function validateSerializedIdentity(value: unknown, requested: boolean): AnalyzerExplainIdentity {
  const identity = exactRecord(value, [
    "analyzerVersion", "schemaVersion", "operation", "operationId", "workspaceEpoch", "configurationEpoch",
    "publicationOperationId", "publicationGeneration", "requestedFacets", "documentVersions",
  ]);
  if (
    identity["analyzerVersion"] !== 1 || identity["schemaVersion"] !== 1 || identity["operation"] !== "explain" ||
    typeof identity["operationId"] !== "string" || identity["operationId"].length === 0 ||
    !nonNegativeInteger(identity["workspaceEpoch"]) || !nonNegativeInteger(identity["configurationEpoch"]) ||
    !Array.isArray(identity["requestedFacets"]) || !Array.isArray(identity["documentVersions"])
  ) serializationRefuse();
  const publicationOperationId = identity["publicationOperationId"];
  const publicationGeneration = identity["publicationGeneration"];
  if (
    publicationOperationId !== null && typeof publicationOperationId !== "string" ||
    publicationGeneration !== null && (!Number.isSafeInteger(publicationGeneration) || (publicationGeneration as number) < 1) ||
    (publicationOperationId === null) !== (publicationGeneration === null)
  ) serializationRefuse();
  const requestedFacets = identity["requestedFacets"] as unknown[];
  if (requestedFacets.length !== (requested ? 1 : 0)) serializationRefuse();
  if (requested) {
    const facet = exactRecord(requestedFacets[0], ["namespace"]);
    if (facet["namespace"] !== ROUTE_EXPLAIN_NAMESPACE) serializationRefuse();
  }
  let priorUri: string | undefined;
  for (const entry of identity["documentVersions"] as unknown[]) {
    const document = exactRecord(entry, ["uri", "version", "lifetime"]);
    if (
      typeof document["uri"] !== "string" || document["uri"].length === 0 ||
      !nonNegativeInteger(document["version"]) || !Number.isSafeInteger(document["lifetime"]) ||
      (document["lifetime"] as number) < 0 || (priorUri !== undefined && priorUri >= document["uri"])
    ) serializationRefuse();
    priorUri = document["uri"];
  }
  return Object.freeze(identity) as unknown as AnalyzerExplainIdentity;
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
    return Object.freeze({ ...source, identity: validateSerializedIdentity(source["identity"], false) }) as unknown as AnalyzerExplainResult;
  }
  if (statusValue === "refused") {
    const source = exactRecord(value, ["status", "identity", "code"]);
    const identity = validateSerializedIdentity(source["identity"], true);
    if (typeof source["code"] !== "string" || !/^FADENO_ANALYZER_EXPLAIN_[A-Z_]+$/u.test(source["code"])) serializationRefuse();
    return Object.freeze({ ...source, identity }) as unknown as AnalyzerExplainResult;
  }
  if (statusValue === "cancelled" || statusValue === "superseded" || statusValue === "stale") {
    const source = exactRecord(value, ["status", "identity", "code", "contributions", "completeness", "interruption"]);
    const identity = validateSerializedIdentity(source["identity"], true);
    const expectedCode = `FADENO_ANALYZER_EXPLAIN_${statusValue.toUpperCase()}`;
    if (
      source["code"] !== expectedCode || source["completeness"] !== "interrupted" || source["interruption"] !== statusValue ||
      !Array.isArray(source["contributions"]) || source["contributions"].length !== 0
    ) serializationRefuse();
    return Object.freeze({ ...source, identity, contributions: Object.freeze([]) }) as unknown as AnalyzerExplainResult;
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
    const expectedContributionCount = source["truncation"] === "duration" ? 0 : 1;
    if (source["contributions"].length !== expectedContributionCount) serializationRefuse();
    const contributions = (source["contributions"] as unknown[]).map((contribution) =>
      deserializeRouteExplainContribution(serializeRouteExplainContribution(contribution as AnalyzerFacetContribution)));
    if (contributions.length === 1) {
      const route = contributions[0]!.value as unknown as Readonly<{
        publicationOperationId: string;
        publicationGeneration: number;
        detail: "semantic" | "deep";
      }>;
      if (
        route.publicationOperationId !== identity.publicationOperationId ||
        route.publicationGeneration !== identity.publicationGeneration || route.detail !== source["detail"]
      ) serializationRefuse();
    }
    return Object.freeze({
      ...source,
      identity,
      budgets: validatedBudgets,
      contributions: Object.freeze(contributions),
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
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > explainSerializationMaximumBytes) {
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
