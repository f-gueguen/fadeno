export const nodeHttpAdapterCapabilities = {
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
} as const;

export type NodeHttpAdapterCapabilities = typeof nodeHttpAdapterCapabilities;
