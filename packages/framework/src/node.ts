import type { Handler } from "./index.js";
import { nodeHttpCapabilities as internalNodeHttpCapabilities } from "./internal/node-http-capabilities.ts";
import { listenNodeHttp as listenNodeHttpInternal } from "./internal/node-http.ts";

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
  readonly failureObserver?: FrameworkFailureObserver;
}

export const nodeHttpCapabilities: NodeHttpCapabilities = internalNodeHttpCapabilities;

export function listenNodeHttp(options: ListenNodeHttpOptions): Promise<NodeHttpServer> {
  return listenNodeHttpInternal(options);
}
