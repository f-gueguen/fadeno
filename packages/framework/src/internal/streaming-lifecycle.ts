import { createCspNonce, readCspNonce } from "./rendering-security.ts";

export type StreamPhase = "uncommitted" | "head-published" | "body-started" | "completed" | "terminated" | "cancelled";
export type RootFailureKind = "not-found" | "redirect" | "unexpected" | "timeout";
export type CancellationReason = "disconnect" | "explicit" | "superseded";

export interface StreamHeadPlan {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly executableMarkup?: boolean;
}

export interface PublishedHead {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyAllowed: boolean;
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
  readonly nonceFactory?: () => object;
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
  let platformHeaders: Headers;
  try { platformHeaders = new Headers(headers); } catch { throw new TypeError("FADENO_STREAM_HEADER"); }
  const result = Object.create(null) as Record<string, string>;
  for (const [name, value] of platformHeaders) {
    result[name] = value;
  }
  return Object.freeze(result);
}

function observeFailure(callback: () => void | Promise<void>): void {
  try { void Promise.resolve(callback()).catch(() => undefined); } catch { /* terminal cleanup must continue */ }
}

const claimedNonces = new WeakSet<object>();

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
  #bodyStarted = false;
  #writePending = false;
  #cleanupCalls = 0;
  #cancelTimer: (() => void) | undefined;
  #signal: AbortSignal | undefined;
  #signalListener: (() => void) | undefined;
  readonly #sink: StreamSink;
  readonly #reporter: StreamReporter | undefined;
  readonly #cleanup: (() => void) | undefined;
  readonly #nonceFactory: () => object;
  readonly #workCancellation = new AbortController();

  constructor(options: StreamingLifecycleOptions) {
    this.#sink = options.sink;
    this.#reporter = options.reporter;
    this.#cleanup = options.cleanup;
    this.#nonceFactory = options.nonceFactory ?? createCspNonce;
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
  get bodyStarted(): boolean { return this.#bodyStarted; }
  get signal(): AbortSignal { return this.#workCancellation.signal; }
  get precommitDecision(): FailureDecision | undefined { return this.#precommitDecision; }

  publishHead(plan: StreamHeadPlan): PublishedHead {
    if (this.#phase !== "uncommitted") throw new TypeError("FADENO_STREAM_HEAD_ALREADY_PUBLISHED");
    if (!Number.isInteger(plan.status) || plan.status < 200 || plan.status > 599) throw new TypeError("FADENO_STREAM_STATUS");
    if (this.#precommitDecision?.status !== undefined && this.#precommitDecision.status !== plan.status) {
      throw new TypeError("FADENO_STREAM_PRECOMMIT_OUTCOME");
    }
    const headers = frozenHeaders(plan.headers);
    const bodyAllowed = plan.status !== 204 && plan.status !== 205 && plan.status !== 304;
    let nonce: string | undefined;
    if (plan.executableMarkup === true) {
      if (plan.status >= 300 && plan.status <= 399) throw new TypeError("FADENO_STREAM_NONCE_REDIRECT");
      if (!bodyAllowed) throw new TypeError("FADENO_STREAM_NONCE_BODY");
      const nonceToken = this.#nonceFactory();
      if (claimedNonces.has(nonceToken)) throw new TypeError("FADENO_STREAM_NONCE_REUSE");
      nonce = readCspNonce(nonceToken);
      if (nonce === undefined) throw new TypeError("FADENO_STREAM_NONCE_AUTHORITY");
      claimedNonces.add(nonceToken);
    }
    const head: PublishedHead = Object.freeze({
      status: plan.status,
      headers,
      bodyAllowed,
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
    if (this.#head?.bodyAllowed !== true) throw new TypeError("FADENO_STREAM_NULL_BODY");
    this.#writePending = true;
    try {
      await this.#sink.write(chunk);
      if (this.#phase === "head-published") {
        this.#bodyStarted = true;
        this.#phase = "body-started";
      }
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
      this.#workCancellation.abort(kind);
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
    this.#workCancellation.abort(reason);
    this.#finishCleanup();
    if (committed) observeFailure(() => this.#sink.abort(reason));
    return Object.freeze({ kind: "abandon" });
  }

  async #terminate(code: string): Promise<void> {
    if (this.#phase === "terminated" || this.#phase === "cancelled" || this.#phase === "completed") return;
    this.#phase = "terminated";
    this.#workCancellation.abort(code);
    this.#finishCleanup();
    observeFailure(() => this.#sink.abort(code));
    if (this.#reporter) observeFailure(() => this.#reporter?.report(code));
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

export class InOrderBoundaryCursor {
  #nextPosition = 0;
  #activePosition: number | undefined;

  get nextPosition(): number { return this.#nextPosition; }

  start(position: number): void {
    if (this.#activePosition !== undefined) throw new TypeError("FADENO_STREAM_BOUNDARY_ACTIVE");
    if (!canStartBoundary(position, this.#nextPosition)) throw new TypeError("FADENO_STREAM_BOUNDARY_ORDER");
    this.#activePosition = position;
  }

  complete(position: number): void {
    if (this.#activePosition !== position) throw new TypeError("FADENO_STREAM_BOUNDARY_COMPLETION");
    this.#activePosition = undefined;
    this.#nextPosition += 1;
  }
}

export type BoundaryCancellationReason = CancellationReason | "timeout";

interface BoundaryCancellationState {
  readonly controller: AbortController;
  readonly children: Set<string>;
  readonly parentId?: string;
  active: boolean;
  emitted: boolean;
  deadlineAt?: number;
  cancelDeadline?: () => void;
  reason?: BoundaryCancellationReason;
}

export class BoundaryCancellationTree {
  readonly #states = new Map<string, BoundaryCancellationState>();
  #cleanupCalls = 0;

  constructor(boundaries: readonly BoundaryState[]) {
    if (boundaries.length === 0) throw new TypeError("FADENO_STREAM_BOUNDARY_EMPTY");
    resolveBoundaryFailure(boundaries, boundaries[0]!.id);
    for (const boundary of boundaries) {
      this.#states.set(boundary.id, {
        controller: new AbortController(), children: new Set(), active: boundary.active,
        emitted: boundary.emitted, ...(boundary.parentId === undefined ? {} : { parentId: boundary.parentId }),
      });
    }
    for (const boundary of boundaries) {
      if (boundary.parentId !== undefined) this.#states.get(boundary.parentId)?.children.add(boundary.id);
    }
  }

  get cleanupCalls(): number { return this.#cleanupCalls; }

  signal(id: string): AbortSignal {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    return state.controller.signal;
  }

  reason(id: string): BoundaryCancellationReason | undefined {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    return state.reason;
  }

  markEmitted(id: string): void {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    state.emitted = true;
  }

  deactivate(id: string): void {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    state.active = false;
  }

  scheduleDeadline(
    id: string,
    startedAt: number,
    budgetMilliseconds: number,
    now: () => number,
    timer: TimerScheduler = defaultTimer(),
  ): number {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    if (state.cancelDeadline) throw new TypeError("FADENO_STREAM_BOUNDARY_DEADLINE_ACTIVE");
    const parentDeadlineAt = state.parentId === undefined ? undefined : this.#states.get(state.parentId)?.deadlineAt;
    const deadlineAt = deriveDeadline(parentDeadlineAt, startedAt, budgetMilliseconds);
    state.deadlineAt = deadlineAt;
    state.cancelDeadline = timer.schedule(Math.max(0, deadlineAt - now()), () => {
      this.#clearDeadline(id);
      this.cancel(id, "timeout");
    });
    return deadlineAt;
  }

  complete(id: string): void {
    const state = this.#states.get(id);
    if (!state) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    this.#clearDeadline(id);
    state.active = false;
  }

  resolveFailure(id: string, failedFallbackIds: readonly string[] = []): BoundaryResolution {
    const boundaries = [...this.#states].map(([boundaryId, state]) => ({
      id: boundaryId, active: state.active, emitted: state.emitted,
      ...(state.parentId === undefined ? {} : { parentId: state.parentId }),
    }));
    return resolveBoundaryFailure(boundaries, id, failedFallbackIds);
  }

  cancel(id: string, reason: BoundaryCancellationReason): readonly string[] {
    if (!this.#states.has(id)) throw new TypeError("FADENO_STREAM_BOUNDARY_UNKNOWN");
    const cancelled: string[] = [];
    const pending = [id];
    while (pending.length > 0) {
      const currentId = pending.pop();
      if (!currentId) continue;
      const state = this.#states.get(currentId);
      if (!state) continue;
      pending.push(...[...state.children].reverse());
      if (state.reason !== undefined) continue;
      this.#clearDeadline(currentId);
      state.reason = reason;
      state.controller.abort(reason);
      cancelled.push(currentId);
    }
    return Object.freeze(cancelled);
  }

  releaseAll(): void {
    if (this.#cleanupCalls !== 0) return;
    this.#cleanupCalls = 1;
    for (const id of this.#states.keys()) this.#clearDeadline(id);
    this.#states.clear();
  }

  #clearDeadline(id: string): void {
    const state = this.#states.get(id);
    if (!state?.cancelDeadline) return;
    const cancel = state.cancelDeadline;
    delete state.cancelDeadline;
    delete state.deadlineAt;
    cancel();
  }
}
