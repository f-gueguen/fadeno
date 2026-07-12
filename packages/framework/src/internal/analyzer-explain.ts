import type { AnalyzerFacetContribution } from "./analyzer-facets.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";
import { processRouteExplainContribution, type RouteExplainTruncationReason } from "./analyzer-route-explain.ts";

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
  | Readonly<{ status: "disabled"; operationId: string }>
  | Readonly<{
    status: "complete" | "partial";
    operationId: string;
    publicationOperationId: string;
    publicationGeneration: number;
    detail: "semantic" | "deep";
    budgets: AnalyzerExplainBudgets;
    contributions: readonly AnalyzerFacetContribution[];
    completeness: "complete" | "partial";
    truncation: RouteExplainTruncationReason | "duration" | null;
  }>
  | Readonly<{
    status: "cancelled" | "superseded" | "stale";
    operationId: string;
    code: string;
    publicationOperationId: string | null;
    publicationGeneration: number | null;
    contributions: readonly AnalyzerFacetContribution[];
    completeness: "interrupted";
    interruption: "cancelled" | "superseded" | "stale";
  }>
  | Readonly<{
    status: "refused";
    operationId: string;
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
      return frozen({
        operationId,
        signal: controller.signal,
        result: Promise.resolve(frozen({ status: "disabled" as const, operationId })),
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
    const interrupted = (status: "cancelled" | "superseded" | "stale", code: string): AnalyzerExplainResult => frozen({
      status, operationId: ticket.operationId, code,
      publicationOperationId: ticket.authority.publication?.operationId ?? null,
      publicationGeneration: ticket.authority.publication?.publicationGeneration ?? null,
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
    if (stopped) return stopped;
    const publication = ticket.authority.publication;
    if (!publication) return this.#finish(ticket, frozen({ status: "refused" as const, operationId: ticket.operationId, code: "FADENO_ANALYZER_EXPLAIN_PUBLICATION" }));
    if (request.detail === "deep" && request.activateDeep !== true || request.detail === "semantic" && request.activateDeep === true) {
      return this.#finish(ticket, frozen({ status: "refused" as const, operationId: ticket.operationId, code: "FADENO_ANALYZER_EXPLAIN_ACTIVATION" }));
    }
    const bounded = budgets(request.budgets);
    if (!bounded) return this.#finish(ticket, frozen({ status: "refused" as const, operationId: ticket.operationId, code: "FADENO_ANALYZER_EXPLAIN_BUDGET" }));
    const collected = Promise.resolve(request.collect(frozen({
      publication,
      detail: request.detail,
      budgets: bounded,
      signal: ticket.controller.signal,
    }))).then(
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
    if (stopped) return stopped;
    if (outcome.kind !== "collected" || !Array.isArray(outcome.value)) {
      if (outcome.kind === "duration") {
        return this.#finish(ticket, frozen({
          status: "partial" as const, operationId: ticket.operationId,
          publicationOperationId: publication.operationId, publicationGeneration: publication.publicationGeneration,
          detail: request.detail, budgets: bounded, contributions: frozen([]), completeness: "partial" as const,
          truncation: "duration" as const,
        }));
      }
      return this.#finish(ticket, frozen({ status: "refused" as const, operationId: ticket.operationId, code: "FADENO_ANALYZER_EXPLAIN_COLLECTION" }));
    }
    let truncation: RouteExplainTruncationReason | null = null;
    let contributions: AnalyzerFacetContribution[];
    try {
      contributions = outcome.value.map((contribution) => {
        const processed = processRouteExplainContribution(contribution, bounded, request.detail);
        truncation ??= processed.truncation;
        return processed.contribution;
      });
    } catch {
      return this.#finish(ticket, frozen({ status: "refused" as const, operationId: ticket.operationId, code: "FADENO_ANALYZER_EXPLAIN_CONTRIBUTION" }));
    }
    const result = frozen({
      status: truncation === null ? "complete" as const : "partial" as const,
      operationId: ticket.operationId,
      publicationOperationId: publication.operationId,
      publicationGeneration: publication.publicationGeneration,
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
