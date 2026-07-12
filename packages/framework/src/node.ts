import type { Handler } from "./index.js";
import { nodeHttpCapabilities as internalNodeHttpCapabilities } from "./internal/node-http-capabilities.ts";
import { listenNodeHttp as listenNodeHttpInternal } from "./internal/node-http.ts";

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
}

export const nodeHttpCapabilities: NodeHttpCapabilities = internalNodeHttpCapabilities;

export function listenNodeHttp(options: ListenNodeHttpOptions): Promise<NodeHttpServer> {
  return listenNodeHttpInternal(options);
}
