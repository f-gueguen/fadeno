import { randomUUID } from "node:crypto";

export type PrivateAnalyzerOperationKind = "analysis" | "explanation";
export type PrivateAnalyzerCoordinatorState = "accepting" | "closing" | "closed";
export type PrivateAnalyzerInterruptionCode =
  | "FADENO_ANALYZER_PROJECT_CANCELLED"
  | "FADENO_ANALYZER_PROJECT_SUPERSEDED";

export interface PrivateAnalyzerOperationContext {
  readonly signal: AbortSignal;
  readonly generation: number;
  readonly batch: Readonly<{
    firstRequestId: string;
    latestRequestId: string;
    size: number;
  }>;
}

export interface PrivateAnalyzerOperationHandle<T> {
  readonly requestId: string;
  readonly sequence: number;
  readonly kind: PrivateAnalyzerOperationKind;
  readonly result: Promise<T>;
  cancel(): void;
}

export class PrivateAnalyzerOperationInterrupted extends TypeError {
  readonly code: PrivateAnalyzerInterruptionCode;
  readonly requestId: string;

  constructor(code: PrivateAnalyzerInterruptionCode, requestId: string) {
    super(code);
    this.name = "PrivateAnalyzerOperationInterrupted";
    this.code = code;
    this.requestId = requestId;
  }
}

type OperationState = "pending" | "active" | "completed" | "cancelled" | "superseded";

interface QueuedOperation<T> {
  readonly requestId: string;
  readonly sequence: number;
  readonly kind: PrivateAnalyzerOperationKind;
  readonly generation: number;
  readonly batch: PrivateAnalyzerOperationContext["batch"];
  readonly controller: AbortController;
  readonly operation: (requestId: string, context: PrivateAnalyzerOperationContext) => T | Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason: unknown) => void;
  state: OperationState;
  settled: boolean;
}

function interruption(item: QueuedOperation<unknown>): PrivateAnalyzerOperationInterrupted {
  return new PrivateAnalyzerOperationInterrupted(
    item.state === "cancelled" ? "FADENO_ANALYZER_PROJECT_CANCELLED" : "FADENO_ANALYZER_PROJECT_SUPERSEDED",
    item.requestId,
  );
}

export class PrivateAnalyzerOperationCoordinator {
  readonly #coordinatorId = randomUUID();
  #sequence = 0;
  #analysisGeneration = 0;
  #state: PrivateAnalyzerCoordinatorState = "accepting";
  readonly #queue: QueuedOperation<unknown>[] = [];
  #active: QueuedOperation<unknown> | null = null;
  #pendingAnalysis: QueuedOperation<unknown> | null = null;
  #drainPromise: Promise<void> | null = null;
  #closePromise: Promise<void> | null = null;

  get state(): PrivateAnalyzerCoordinatorState {
    return this.#state;
  }

  start<T>(
    kind: PrivateAnalyzerOperationKind,
    operation: (requestId: string, context: PrivateAnalyzerOperationContext) => T | Promise<T>,
  ): PrivateAnalyzerOperationHandle<T> {
    if (this.#state !== "accepting") {
      throw new TypeError("FADENO_ANALYZER_PROJECT_CLOSED");
    }
    const sequence = ++this.#sequence;
    const requestId = `${this.#coordinatorId}:request-${sequence}`;
    const pendingAnalysis = kind === "analysis" && this.#pendingAnalysis?.state === "pending"
      ? this.#pendingAnalysis
      : null;
    const generation = kind === "analysis" ? ++this.#analysisGeneration : this.#analysisGeneration;
    const batch = Object.freeze({
      firstRequestId: pendingAnalysis?.batch.firstRequestId ?? requestId,
      latestRequestId: requestId,
      size: (pendingAnalysis?.batch.size ?? 0) + 1,
    });
    const controller = new AbortController();
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((accept, refuse) => {
      resolve = accept;
      reject = refuse;
    });
    const item: QueuedOperation<T> = {
      requestId,
      sequence,
      kind,
      generation,
      batch,
      controller,
      operation,
      resolve,
      reject,
      state: "pending",
      settled: false,
    };

    if (kind === "analysis") {
      if (this.#active?.kind === "analysis" && this.#active.state === "active") {
        this.#interrupt(this.#active, "superseded");
      }
      if (pendingAnalysis) {
        this.#interrupt(pendingAnalysis, "superseded");
      }
      this.#pendingAnalysis = item as QueuedOperation<unknown>;
      this.#queue.push(item as QueuedOperation<unknown>);
    } else {
      this.#queue.push(item as QueuedOperation<unknown>);
    }
    this.#ensureDrain();

    return Object.freeze({
      requestId,
      sequence,
      kind,
      result,
      cancel: () => this.#interrupt(item as QueuedOperation<unknown>, "cancelled"),
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = "closing";
    this.#closePromise = this.#waitForIdle().then(() => {
      this.#state = "closed";
    });
    return this.#closePromise;
  }

  #interrupt(item: QueuedOperation<unknown>, state: "cancelled" | "superseded"): void {
    if (item.state === "completed" || item.state === "cancelled" || item.state === "superseded") return;
    const wasPending = item.state === "pending";
    item.state = state;
    item.controller.abort(new DOMException(state === "cancelled" ? "Cancelled" : "Superseded", "AbortError"));
    if (wasPending) {
      if (this.#pendingAnalysis === item) this.#pendingAnalysis = null;
      this.#settleInterrupted(item);
    }
  }

  #ensureDrain(): void {
    if (this.#drainPromise) return;
    const draining = Promise.resolve().then(() => this.#drain());
    this.#drainPromise = draining.then(() => {
      this.#drainPromise = null;
      if (this.#queue.length > 0) this.#ensureDrain();
    });
  }

  async #waitForIdle(): Promise<void> {
    for (;;) {
      if (this.#queue.length > 0 && !this.#drainPromise) this.#ensureDrain();
      const drain = this.#drainPromise;
      if (!drain) return;
      await drain;
    }
  }

  async #drain(): Promise<void> {
    for (;;) {
      while (this.#queue.length > 0) {
        const item = this.#queue.shift()!;
        if (item.state === "cancelled" || item.state === "superseded") continue;
        if (this.#pendingAnalysis === item) this.#pendingAnalysis = null;
        this.#active = item;
        item.state = "active";
        try {
          const value = await item.operation(item.requestId, Object.freeze({
            signal: item.controller.signal,
            generation: item.generation,
            batch: item.batch,
          }));
          if (item.state === "active") {
            item.state = "completed";
            this.#settle(item, () => item.resolve(value));
          } else {
            this.#settleInterrupted(item);
          }
        } catch (error) {
          if (this.#isInterrupted(item)) {
            this.#settleInterrupted(item);
          } else {
            item.state = "completed";
            this.#settle(item, () => item.reject(error));
          }
        } finally {
          this.#active = null;
        }
      }
      // Result continuations can admit derived work while this worker still
      // owns the drain promise. Give that handoff one deterministic checkpoint
      // before declaring the coordinator idle.
      await Promise.resolve();
      if (this.#queue.length === 0) return;
    }
  }

  #settleInterrupted(item: QueuedOperation<unknown>): void {
    this.#settle(item, () => item.reject(interruption(item)));
  }

  #isInterrupted(item: QueuedOperation<unknown>): boolean {
    return item.state === "cancelled" || item.state === "superseded";
  }

  #settle(item: QueuedOperation<unknown>, settle: () => void): void {
    if (item.settled) return;
    item.settled = true;
    settle();
  }
}
