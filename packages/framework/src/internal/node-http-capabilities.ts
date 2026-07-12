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

export const nodeHttpCapabilities: NodeHttpCapabilities = {
  runtime: "node",
  minimumVersion: "22.17.0",
  webRequestResponse: true,
  requestBodyStreaming: true,
  responseBodyStreaming: true,
  responseBackpressure: true,
  disconnectCancellation: true,
  responseTrailers: false,
  requestSizeEnforcement: "none",
  trustedProxyHeaders: false,
  gracefulShutdown: "drain",
};
