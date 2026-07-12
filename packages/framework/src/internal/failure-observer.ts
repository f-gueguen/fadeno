import { projectDiagnosticSource } from "./rendering-security.ts";

export interface FrameworkFailureReport {
  readonly incidentId: string;
  readonly phase: "pre-publication" | "post-publication";
  readonly code: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly cause: unknown;
}

export type FrameworkFailureObserver = (report: FrameworkFailureReport) => void | Promise<void>;

const requestObservers = new WeakMap<Request, FrameworkFailureObserver>();

export function bindRequestFailureObserver(request: Request, observer: FrameworkFailureObserver | undefined): () => void {
  if (!observer) return () => undefined;
  requestObservers.set(request, observer);
  return () => requestObservers.delete(request);
}

export function captureRequestFailureObserver(request: Request): FrameworkFailureObserver | undefined {
  return requestObservers.get(request);
}

export function reportFrameworkFailure(
  observer: FrameworkFailureObserver | undefined,
  request: Request,
  incidentId: string,
  phase: FrameworkFailureReport["phase"],
  code: string,
  cause: unknown,
): void {
  if (!observer) return;
  try {
    void Promise.resolve(observer(Object.freeze({
      incidentId,
      phase,
      code,
      projection: projectDiagnosticSource({ method: request.method, request: { url: request.url }, error: cause }),
      cause,
    }))).catch(() => undefined);
  } catch { /* reporting cannot change response ownership */ }
}
