import { readCspNonce } from "./rendering-security.ts";

export type StreamPhase = "uncommitted" | "head-published" | "body-started" | "completed" | "terminated" | "cancelled";
export type RootFailureKind = "not-found" | "redirect" | "unexpected" | "timeout";
export type CancellationReason = "disconnect" | "explicit" | "superseded";

export interface StreamHeadPlan {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly executableMarkup?: boolean;
  readonly headerNonce?: object;
  readonly markupNonce?: object;
}

export interface PublishedHead {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly nonce?: string;
}

export interface StreamSink {
  write(chunk: Uint8Array): void | Promise<void>;
  close(): void | Promise<void>;
  abort(reason: string): void | Promise<void>;
}

export interface StreamReporter {
  report(code: string): void | Promise<void>;
}

export interface TimerScheduler {
  schedule(delayMilliseconds: number, callback: () => void): () => void;
}

export interface StreamingLifecycleOptions {
  readonly sink: StreamSink;
  readonly reporter?: StreamReporter;
  readonly cleanup?: () => void;
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
  readonly now?: () => number;
  readonly timer?: TimerScheduler;
}

export interface FailureDecision {
  readonly kind: "replace" | "abandon" | "terminate";
  readonly status?: number;
}

function defaultTimer(): TimerScheduler {
  return {
    schedule(delayMilliseconds, callback) {
      const handle = setTimeout(callback, delayMilliseconds);
      return () => clearTimeout(handle);
    },
  };
}

function frozenHeaders(headers: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  const result = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name !== name.toLowerCase() || !/^[a-z0-9-]+$/u.test(name) || typeof value !== "string") {
      throw new TypeError("FADENO_STREAM_HEADER");
    }
    result[name] = value;
  }
  return Object.freeze(result);
}

async function ignoreFailure(callback: () => void | Promise<void>): Promise<void> {
  try { await callback(); } catch { /* terminal cleanup must continue */ }
}

export function deriveDeadline(parentDeadlineAt: number | undefined, startedAt: number, budgetMilliseconds: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(budgetMilliseconds) || budgetMilliseconds <= 0) {
    throw new TypeError("FADENO_STREAM_DEADLINE");
  }
  const candidate = startedAt + budgetMilliseconds;
  return parentDeadlineAt === undefined ? candidate : Math.min(parentDeadlineAt, candidate);
}

export class StreamingLifecycle {
  #phase: StreamPhase = "uncommitted";
  #head: PublishedHead | undefined;
  #precommitDecision: FailureDecision | undefined;
  #writePending = false;
  #cleanupCalls = 0;
  #cancelTimer: (() => void) | undefined;
  #signal: AbortSignal | undefined;
  #signalListener: (() => void) | undefined;
  readonly #sink: StreamSink;
  readonly #reporter: StreamReporter | undefined;
  readonly #cleanup: (() => void) | undefined;

  constructor(options: StreamingLifecycleOptions) {
    this.#sink = options.sink;
    this.#reporter = options.reporter;
    this.#cleanup = options.cleanup;
    if (options.deadlineAt !== undefined) {
      const delay = Math.max(0, options.deadlineAt - (options.now?.() ?? Date.now()));
      this.#cancelTimer = (options.timer ?? defaultTimer()).schedule(delay, () => { void this.fail("timeout"); });
    }
    if (options.signal) {
      this.#signal = options.signal;
      this.#signalListener = () => { void this.cancel("disconnect"); };
      options.signal.addEventListener("abort", this.#signalListener, { once: true });
      if (options.signal.aborted) void this.cancel("disconnect");
    }
  }

  get phase(): StreamPhase { return this.#phase; }
  get head(): PublishedHead | undefined { return this.#head; }
  get writePending(): boolean { return this.#writePending; }
  get cleanupCalls(): number { return this.#cleanupCalls; }
  get precommitDecision(): FailureDecision | undefined { return this.#precommitDecision; }

  publishHead(plan: StreamHeadPlan): PublishedHead {
    if (this.#phase !== "uncommitted") throw new TypeError("FADENO_STREAM_HEAD_ALREADY_PUBLISHED");
    if (!Number.isInteger(plan.status) || plan.status < 100 || plan.status > 599) throw new TypeError("FADENO_STREAM_STATUS");
    if (this.#precommitDecision?.status !== undefined && this.#precommitDecision.status !== plan.status) {
      throw new TypeError("FADENO_STREAM_PRECOMMIT_OUTCOME");
    }
    let nonce: string | undefined;
    if (plan.executableMarkup === true) {
      if (plan.headerNonce !== plan.markupNonce) throw new TypeError("FADENO_STREAM_NONCE_CORRELATION");
      nonce = readCspNonce(plan.headerNonce);
      if (nonce === undefined) throw new TypeError("FADENO_STREAM_NONCE_AUTHORITY");
    } else if (plan.headerNonce !== undefined || plan.markupNonce !== undefined) {
      throw new TypeError("FADENO_STREAM_NONCE_UNUSED");
    }
    const head: PublishedHead = Object.freeze({
      status: plan.status,
      headers: frozenHeaders(plan.headers),
      ...(nonce === undefined ? {} : { nonce }),
    });
    this.#head = head;
    this.#phase = "head-published";
    return head;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!(chunk instanceof Uint8Array)) throw new TypeError("FADENO_STREAM_CHUNK");
    if (chunk.byteLength === 0) return;
    if (this.#phase !== "head-published" && this.#phase !== "body-started") throw new TypeError("FADENO_STREAM_WRITE_PHASE");
    if (this.#writePending) throw new TypeError("FADENO_STREAM_BACKPRESSURE");
    this.#writePending = true;
    try {
      await this.#sink.write(chunk);
      if (this.#phase === "head-published") this.#phase = "body-started";
    } catch {
      await this.#terminate("write-failure");
      throw new TypeError("FADENO_STREAM_WRITE_FAILURE");
    } finally {
      this.#writePending = false;
    }
  }

  async complete(): Promise<void> {
    if (this.#writePending) throw new TypeError("FADENO_STREAM_BACKPRESSURE");
    if (this.#phase !== "head-published" && this.#phase !== "body-started") throw new TypeError("FADENO_STREAM_COMPLETE_PHASE");
    const completingPhase = this.#phase;
    try {
      await this.#sink.close();
      if (this.#phase !== completingPhase) return;
      this.#phase = "completed";
    } catch {
      await this.#terminate("close-failure");
      throw new TypeError("FADENO_STREAM_CLOSE_FAILURE");
    }
    this.#finishCleanup();
  }

  async fail(kind: RootFailureKind): Promise<FailureDecision> {
    if (this.#phase === "uncommitted") {
      if (this.#precommitDecision) return this.#precommitDecision;
      const status = kind === "not-found" ? 404 : kind === "redirect" ? 303 : kind === "unexpected" ? 500 : 504;
      this.#precommitDecision = Object.freeze({ kind: "replace", status });
      return this.#precommitDecision;
    }
    if (this.#phase === "head-published" || this.#phase === "body-started") {
      await this.#terminate(`late-${kind}`);
      return Object.freeze({ kind: "terminate" });
    }
    return Object.freeze({ kind: "abandon" });
  }

  async cancel(reason: CancellationReason): Promise<FailureDecision> {
    if (this.#phase === "completed" || this.#phase === "terminated" || this.#phase === "cancelled") {
      return Object.freeze({ kind: "abandon" });
    }
    const committed = this.#phase !== "uncommitted";
    this.#phase = "cancelled";
    if (committed) await ignoreFailure(() => this.#sink.abort(reason));
    this.#finishCleanup();
    return Object.freeze({ kind: "abandon" });
  }

  async #terminate(code: string): Promise<void> {
    if (this.#phase === "terminated" || this.#phase === "cancelled" || this.#phase === "completed") return;
    this.#phase = "terminated";
    await ignoreFailure(() => this.#sink.abort(code));
    if (this.#reporter) await ignoreFailure(() => this.#reporter?.report(code));
    this.#finishCleanup();
  }

  #finishCleanup(): void {
    if (this.#cleanupCalls !== 0) return;
    this.#cleanupCalls = 1;
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    if (this.#signal && this.#signalListener) this.#signal.removeEventListener("abort", this.#signalListener);
    this.#signal = undefined;
    this.#signalListener = undefined;
    try { this.#cleanup?.(); } catch { /* cleanup ownership is already released */ }
  }
}

export interface BoundaryState {
  readonly id: string;
  readonly parentId?: string;
  readonly active: boolean;
  readonly emitted: boolean;
}

export type BoundaryResolution = Readonly<{ kind: "fallback"; ownerId: string }> | Readonly<{ kind: "terminate" }>;

export function resolveBoundaryFailure(
  boundaries: readonly BoundaryState[],
  failedBoundaryId: string,
  failedFallbackIds: readonly string[] = [],
): BoundaryResolution {
  const byId = new Map(boundaries.map((boundary) => [boundary.id, boundary]));
  if (byId.size !== boundaries.length) throw new TypeError("FADENO_STREAM_BOUNDARY_DUPLICATE");
  for (const boundary of boundaries) {
    const ancestry = new Set<string>();
    let candidate: BoundaryState | undefined = boundary;
    while (candidate) {
      if (ancestry.has(candidate.id)) throw new TypeError("FADENO_STREAM_BOUNDARY_CYCLE");
      ancestry.add(candidate.id);
      if (candidate.parentId === undefined) break;
      candidate = byId.get(candidate.parentId);
      if (!candidate) throw new TypeError("FADENO_STREAM_BOUNDARY_PARENT");
    }
  }
  const failedFallbacks = new Set(failedFallbackIds);
  const visited = new Set<string>();
  let current = byId.get(failedBoundaryId);
  if (!current) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
  while (current) {
    if (visited.has(current.id)) throw new TypeError("FADENO_STREAM_BOUNDARY_CYCLE");
    visited.add(current.id);
    if (current.emitted) return Object.freeze({ kind: "terminate" });
    if (current.active && !failedFallbacks.has(current.id)) return Object.freeze({ kind: "fallback", ownerId: current.id });
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return Object.freeze({ kind: "terminate" });
}

export function canStartBoundary(position: number, nextPosition: number): boolean {
  return Number.isInteger(position) && Number.isInteger(nextPosition) && position === nextPosition;
}
