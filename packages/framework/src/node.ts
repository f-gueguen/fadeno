import type { Handler } from "./index.js";
import { registerActionServerRuntime } from "./internal/action-server.ts";
import { nodeHttpCapabilities as internalNodeHttpCapabilities } from "./internal/node-http-capabilities.ts";
import { listenNodeHttp as listenNodeHttpInternal } from "./internal/node-http.ts";

registerActionServerRuntime();

export interface FrameworkFailureReport {
  readonly incidentId: string;
  readonly phase: "pre-publication" | "post-publication";
  readonly code: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly cause: unknown;
}

export type FrameworkFailureObserver = (report: FrameworkFailureReport) => void | Promise<void>;

export interface NodeHttpCapabilities {
  readonly runtime: "node";
  readonly minimumVersion: string;
  readonly webRequestResponse: true;
  readonly requestBodyStreaming: true;
  readonly responseBodyStreaming: true;
  readonly responseBackpressure: true;
  readonly disconnectCancellation: true;
  readonly responseTrailers: false;
  readonly requestSizeEnforcement: "none";
  readonly trustedProxyHeaders: false;
  readonly gracefulShutdown: "drain";
}

export interface NodeHttpServer {
  readonly origin: string;
  close(): Promise<void>;
}

export interface ListenNodeHttpOptions {
  readonly handler: Handler;
  readonly hostname?: string;
  /** Fixed listener port; omit or pass zero for an ephemeral port. */
  readonly port?: number;
  /** Exact external HTTPS origin used for generated action endpoints and origin checks. */
  readonly canonicalOrigin?: string;
  /** Exact generated application identity; required when the application declares actions. */
  readonly applicationGeneration?: string;
  readonly failureObserver?: FrameworkFailureObserver;
}

export const nodeHttpCapabilities: NodeHttpCapabilities = internalNodeHttpCapabilities;

export function listenNodeHttp(options: ListenNodeHttpOptions): Promise<NodeHttpServer> {
  return listenNodeHttpInternal(options);
}
