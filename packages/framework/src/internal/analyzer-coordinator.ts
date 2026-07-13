import { randomUUID } from "node:crypto";

export type PrivateAnalyzerOperationKind = "analysis" | "explanation";
export type PrivateAnalyzerCoordinatorState = "accepting" | "closing" | "closed";

export interface PrivateAnalyzerOperationHandle<T> {
  readonly requestId: string;
  readonly sequence: number;
  readonly kind: PrivateAnalyzerOperationKind;
  readonly result: Promise<T>;
}

export class PrivateAnalyzerOperationCoordinator {
  readonly #coordinatorId = randomUUID();
  #sequence = 0;
  #state: PrivateAnalyzerCoordinatorState = "accepting";
  #tail: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | null = null;

  get state(): PrivateAnalyzerCoordinatorState {
    return this.#state;
  }

  start<T>(
    kind: PrivateAnalyzerOperationKind,
    operation: (requestId: string) => T | Promise<T>,
  ): PrivateAnalyzerOperationHandle<T> {
    if (this.#state !== "accepting") {
      throw new TypeError("FADENO_ANALYZER_PROJECT_CLOSED");
    }
    const sequence = ++this.#sequence;
    const requestId = `${this.#coordinatorId}:request-${sequence}`;
    const result = this.#tail.then(() => operation(requestId));
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return Object.freeze({ requestId, sequence, kind, result });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = "closing";
    this.#closePromise = this.#tail.then(() => {
      this.#state = "closed";
    });
    return this.#closePromise;
  }
}
