import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { PrivateAnalyzerOperationHandle } from "./analyzer-coordinator.ts";
import type { PrivateProjectRefresh, PrivateProjectRefreshHandle } from "./analyzer-project.ts";

const defaultDebounceMs = 25;
const defaultMaximumDelayMs = 100;
const defaultMaximumPendingHints = 256;

export type PrivateFilesystemNotificationKind = "change" | "rename";

export type PrivateFilesystemNotification = Readonly<{
  kind: PrivateFilesystemNotificationKind;
  path: string | null;
}>;

export type PrivateFilesystemAdmission = Readonly<{
  sequence: number;
  status: "accepted" | "excluded" | "refused";
  reason:
    | "contained-change"
    | "duplicate-change"
    | "duplicate-alias-rescan"
    | "rename-rescan"
    | "missing-name-rescan"
    | "overflow-rescan"
    | "owned-output"
    | "repository-metadata"
    | "external-path"
    | "invalid-path"
    | "symlink-path";
}>;

export type PrivateFilesystemInvalidationBatch = Readonly<{
  firstSequence: number;
  latestSequence: number;
  size: number;
  fullWorkspace: boolean;
  hints: readonly string[];
  reasons: readonly PrivateFilesystemAdmission["reason"][];
}>;

export type PrivateFilesystemRefreshCycle = Readonly<{
  sequence: number;
  batch: PrivateFilesystemInvalidationBatch;
  refresh: PrivateProjectRefresh;
}>;

export interface PrivateFilesystemRefreshTarget {
  ownsProject(projectRoot: string): boolean;
  refresh(): PrivateProjectRefreshHandle;
  close(): Promise<void>;
}

export interface PrivateFilesystemInvalidationScheduler {
  now(): number;
  set(delayMs: number, callback: () => void): unknown;
  clear(timer: unknown): void;
}

export interface PrivateFilesystemInvalidationOptions {
  readonly debounceMs?: number;
  readonly maximumDelayMs?: number;
  readonly maximumPendingHints?: number;
  readonly scheduler?: PrivateFilesystemInvalidationScheduler;
  readonly onCycle?: (cycle: PrivateFilesystemRefreshCycle) => void;
  readonly onFailure?: (batch: PrivateFilesystemInvalidationBatch, error: unknown) => void;
}

type CycleWaiter = Readonly<{
  targetSequence: number;
  resolve(cycle: PrivateFilesystemRefreshCycle): void;
  reject(error: unknown): void;
}>;

const realScheduler: PrivateFilesystemInvalidationScheduler = Object.freeze({
  now: () => Date.now(),
  set: (delayMs: number, callback: () => void) => setTimeout(callback, delayMs),
  clear: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedInteger(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(code);
  return value;
}

function isContained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function hasSymlinkComponent(root: string, path: string): boolean {
  const difference = relative(root, path);
  if (difference === "") return false;
  let current = root;
  for (const component of difference.split(sep)) {
    current = resolve(current, component);
    if (!existsSync(current)) return false;
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return existsSync(current);
    }
  }
  return false;
}

function interruption(code: string): TypeError {
  return new TypeError(code);
}

export class PrivateFilesystemInvalidationAdapter {
  readonly #root: string;
  readonly #target: PrivateFilesystemRefreshTarget;
  readonly #scheduler: PrivateFilesystemInvalidationScheduler;
  readonly #debounceMs: number;
  readonly #maximumDelayMs: number;
  readonly #maximumPendingHints: number;
  readonly #onCycle?: PrivateFilesystemInvalidationOptions["onCycle"];
  readonly #onFailure?: PrivateFilesystemInvalidationOptions["onFailure"];
  readonly #hints = new Set<string>();
  readonly #rawAliases = new Map<string, string>();
  readonly #reasons = new Set<PrivateFilesystemAdmission["reason"]>();
  readonly #waiters: CycleWaiter[] = [];
  #state: "accepting" | "closing" | "closed" = "accepting";
  #lastNow = Number.NEGATIVE_INFINITY;
  #notificationSequence = 0;
  #admissionSequence = 0;
  #cycleSequence = 0;
  #firstPendingSequence = 0;
  #pendingSize = 0;
  #firstPendingAt = 0;
  #latestPendingAt = 0;
  #fullWorkspace = false;
  #timer: unknown = null;
  #active: PrivateAnalyzerOperationHandle<PrivateProjectRefresh> | null = null;
  #lastCycle: PrivateFilesystemRefreshCycle | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(
    projectRoot: string,
    target: PrivateFilesystemRefreshTarget,
    options: PrivateFilesystemInvalidationOptions = {},
  ) {
    const requestedRoot = resolve(projectRoot);
    if (!existsSync(requestedRoot) || lstatSync(requestedRoot).isSymbolicLink() || !lstatSync(requestedRoot).isDirectory()) {
      throw new TypeError("FADENO_ANALYZER_WATCH_ROOT");
    }
    this.#root = requestedRoot;
    if (!target.ownsProject(this.#root)) throw new TypeError("FADENO_ANALYZER_WATCH_ROOT");
    this.#target = target;
    this.#debounceMs = boundedInteger(options.debounceMs ?? defaultDebounceMs, 0, 10_000, "FADENO_ANALYZER_WATCH_CONFIG");
    this.#maximumDelayMs = boundedInteger(options.maximumDelayMs ?? defaultMaximumDelayMs, 1, 60_000, "FADENO_ANALYZER_WATCH_CONFIG");
    if (this.#maximumDelayMs < this.#debounceMs) throw new TypeError("FADENO_ANALYZER_WATCH_CONFIG");
    this.#maximumPendingHints = boundedInteger(
      options.maximumPendingHints ?? defaultMaximumPendingHints,
      1,
      4_096,
      "FADENO_ANALYZER_WATCH_CONFIG",
    );
    this.#scheduler = options.scheduler ?? realScheduler;
    this.#onCycle = options.onCycle;
    this.#onFailure = options.onFailure;
  }

  notify(notification: PrivateFilesystemNotification): PrivateFilesystemAdmission {
    if (this.#state !== "accepting") throw interruption("FADENO_ANALYZER_WATCH_CLOSED");
    if (this.#notificationSequence >= Number.MAX_SAFE_INTEGER) throw interruption("FADENO_ANALYZER_WATCH_OVERFLOW");
    const sequence = ++this.#notificationSequence;
    if (notification.kind !== "change" && notification.kind !== "rename") {
      return Object.freeze({ sequence, status: "refused", reason: "invalid-path" });
    }
    if (notification.path === null) {
      return this.#accept(sequence, "missing-name-rescan", null, null, true);
    }
    if (notification.path.length === 0 || notification.path.includes("\0")) {
      return Object.freeze({ sequence, status: "refused", reason: "invalid-path" });
    }
    const absolute = resolve(this.#root, notification.path);
    if (!isContained(this.#root, absolute)) {
      return Object.freeze({ sequence, status: "refused", reason: "external-path" });
    }
    if (hasSymlinkComponent(this.#root, absolute)) {
      return Object.freeze({ sequence, status: "refused", reason: "symlink-path" });
    }
    const hint = relative(this.#root, absolute).split(sep).join("/") || ".";
    if (hint === ".fadeno" || hint.startsWith(".fadeno/")) {
      return Object.freeze({ sequence, status: "excluded", reason: "owned-output" });
    }
    if (hint === ".git" || hint.startsWith(".git/")) {
      return Object.freeze({ sequence, status: "excluded", reason: "repository-metadata" });
    }
    if (notification.kind === "rename") return this.#accept(sequence, "rename-rescan", hint, notification.path, true);
    const priorRaw = this.#rawAliases.get(hint);
    if (priorRaw !== undefined && priorRaw !== notification.path) {
      return this.#accept(sequence, "duplicate-alias-rescan", hint, notification.path, true);
    }
    if (this.#hints.has(hint)) return this.#accept(sequence, "duplicate-change", hint, notification.path, false);
    if (!this.#fullWorkspace && this.#hints.size >= this.#maximumPendingHints) {
      return this.#accept(sequence, "overflow-rescan", null, null, true);
    }
    return this.#accept(sequence, "contained-change", hint, notification.path, false);
  }

  flush(): Promise<PrivateFilesystemRefreshCycle> {
    if (this.#state !== "accepting") return Promise.reject(interruption("FADENO_ANALYZER_WATCH_CLOSED"));
    if (this.#admissionSequence === 0 || (!this.#hasPending() && !this.#active)) {
      if (this.#notificationSequence >= Number.MAX_SAFE_INTEGER) {
        return Promise.reject(interruption("FADENO_ANALYZER_WATCH_OVERFLOW"));
      }
      this.#accept(++this.#notificationSequence, "missing-name-rescan", null, null, true);
    }
    const targetSequence = this.#admissionSequence;
    if (this.#lastCycle && this.#lastCycle.batch.latestSequence >= targetSequence) return Promise.resolve(this.#lastCycle);
    const result = new Promise<PrivateFilesystemRefreshCycle>((resolveCycle, rejectCycle) => {
      if (this.#waiters.length >= this.#maximumPendingHints) {
        rejectCycle(interruption("FADENO_ANALYZER_WATCH_OVERFLOW"));
        return;
      }
      this.#waiters.push(Object.freeze({ targetSequence, resolve: resolveCycle, reject: rejectCycle }));
    });
    if (!this.#active && this.#hasPending()) {
      this.#clearTimer();
      this.#startCycle();
    }
    return result;
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = "closing";
    this.#clearTimer();
    this.#clearPending();
    const error = interruption("FADENO_ANALYZER_WATCH_CLOSED");
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
    const active = this.#active;
    active?.cancel();
    this.#closePromise = (async () => {
      if (active) {
        try { await active.result; } catch { /* target close drains retained terminal state */ }
      }
      await this.#target.close();
      this.#state = "closed";
    })();
    return this.#closePromise;
  }

  #accept(
    notificationSequence: number,
    reason: PrivateFilesystemAdmission["reason"],
    hint: string | null,
    rawPath: string | null,
    fullWorkspace: boolean,
  ): PrivateFilesystemAdmission {
    if (this.#admissionSequence >= Number.MAX_SAFE_INTEGER) throw interruption("FADENO_ANALYZER_WATCH_OVERFLOW");
    const sequence = ++this.#admissionSequence;
    const now = this.#now();
    if (!this.#hasPending()) {
      this.#firstPendingSequence = sequence;
      this.#firstPendingAt = now;
    }
    this.#latestPendingAt = now;
    this.#pendingSize = Math.min(this.#pendingSize + 1, this.#maximumPendingHints + 1);
    this.#reasons.add(reason);
    if (fullWorkspace) {
      this.#fullWorkspace = true;
      this.#hints.clear();
      this.#rawAliases.clear();
    } else if (!this.#fullWorkspace && hint !== null) {
      this.#hints.add(hint);
      this.#rawAliases.set(hint, this.#rawAliases.get(hint) ?? rawPath ?? hint);
    }
    if (!this.#active) this.#schedule();
    return Object.freeze({ sequence: notificationSequence, status: "accepted", reason });
  }

  #hasPending(): boolean {
    return this.#pendingSize > 0;
  }

  #schedule(): void {
    if (!this.#hasPending() || this.#active || this.#state !== "accepting") return;
    this.#clearTimer();
    const now = this.#now();
    const debounceAt = this.#latestPendingAt + this.#debounceMs;
    const maximumAt = this.#firstPendingAt + this.#maximumDelayMs;
    const delay = Math.max(0, Math.min(debounceAt, maximumAt) - now);
    this.#timer = this.#scheduler.set(delay, () => {
      this.#timer = null;
      this.#startCycle();
    });
  }

  #startCycle(): void {
    if (this.#active || !this.#hasPending() || this.#state !== "accepting") return;
    const batch = Object.freeze({
      firstSequence: this.#firstPendingSequence,
      latestSequence: this.#admissionSequence,
      size: this.#pendingSize,
      fullWorkspace: this.#fullWorkspace,
      hints: Object.freeze([...this.#hints].sort(compareText)),
      reasons: Object.freeze([...this.#reasons].sort(compareText)),
    });
    this.#clearPending();
    let handle: PrivateProjectRefreshHandle;
    try {
      handle = this.#target.refresh();
    } catch (error) {
      try { this.#onFailure?.(batch, error); } catch { /* observation cannot control scheduling ownership */ }
      this.#settleWaiters(batch.latestSequence, null, error);
      return;
    }
    this.#active = handle;
    void handle.result.then(
      (refresh) => {
        this.#finishCycle(handle);
        const cycle = Object.freeze({ sequence: ++this.#cycleSequence, batch, refresh });
        this.#lastCycle = cycle;
        try { this.#onCycle?.(cycle); } catch { /* observation cannot control scheduling ownership */ }
        this.#settleWaiters(batch.latestSequence, cycle, null);
      },
      (error: unknown) => {
        this.#finishCycle(handle);
        try { this.#onFailure?.(batch, error); } catch { /* observation cannot control scheduling ownership */ }
        this.#settleWaiters(batch.latestSequence, null, error);
      },
    );
  }

  #finishCycle(handle: PrivateProjectRefreshHandle): void {
    if (this.#active === handle) this.#active = null;
    if (this.#state === "accepting" && this.#hasPending()) this.#schedule();
  }

  #settleWaiters(
    throughSequence: number,
    cycle: PrivateFilesystemRefreshCycle | null,
    error: unknown,
  ): void {
    for (let index = this.#waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.#waiters[index]!;
      if (waiter.targetSequence > throughSequence) continue;
      this.#waiters.splice(index, 1);
      if (cycle) waiter.resolve(cycle);
      else waiter.reject(error);
    }
  }

  #clearPending(): void {
    this.#firstPendingSequence = 0;
    this.#pendingSize = 0;
    this.#firstPendingAt = 0;
    this.#latestPendingAt = 0;
    this.#fullWorkspace = false;
    this.#hints.clear();
    this.#rawAliases.clear();
    this.#reasons.clear();
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  #now(): number {
    const now = this.#scheduler.now();
    if (!Number.isFinite(now) || now < this.#lastNow) throw new TypeError("FADENO_ANALYZER_WATCH_SCHEDULER");
    this.#lastNow = now;
    return now;
  }
}
