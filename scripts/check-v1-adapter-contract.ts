import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { nodeHttpAdapterCapabilities } from "../prototypes/v1/adapter/capabilities.ts";
import { listenNodeHttpAdapter } from "../prototypes/v1/adapter/node-http.ts";

interface HttpResult {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly status: number | undefined;
}

function exchange(origin: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: readonly string[] } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${path}`, { method: options.method, headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        status: response.statusCode,
      }));
    });
    request.once("error", reject);
    for (const chunk of options.body ?? []) request.write(chunk);
    request.end();
  });
}

const expectedCapabilities = {
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
if (JSON.stringify(nodeHttpAdapterCapabilities) !== JSON.stringify(expectedCapabilities)) {
  throw new Error("FADENO_ADAPTER_CAPABILITIES");
}
if (process.argv.includes("--require-minimum") && process.versions.node !== nodeHttpAdapterCapabilities.minimumVersion) {
  throw new Error(`FADENO_ADAPTER_MINIMUM_RUNTIME: expected ${nodeHttpAdapterCapabilities.minimumVersion}, received ${process.versions.node}`);
}

let observed: Request | undefined;
const adapter = await listenNodeHttpAdapter({
  handler: async (request) => {
    observed = request;
    const body = request.body ? await request.text() : "";
    const headers = new Headers({ "content-type": "text/plain", "x-adapter": "node-http" });
    headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    headers.append("set-cookie", "second=2; Path=/; SameSite=Lax");
    return new Response(`${request.method} ${request.url} ${request.headers.get("x-test")} ${body}`, { status: 201, headers });
  },
});
try {
  const result = await exchange(adapter.origin, "/items?mode=test", {
    method: "POST",
    headers: { host: "attacker.invalid", "x-forwarded-host": "forwarded.invalid", "x-test": "preserved" },
    body: ["first-", "second"],
  });
  if (!observed || result.status !== 201 || result.headers["x-adapter"] !== "node-http") throw new Error("FADENO_ADAPTER_RESPONSE");
  if (result.body !== `POST ${adapter.origin}/items?mode=test preserved first-second`) throw new Error("FADENO_ADAPTER_REQUEST");
  const cookieHeaders = result.rawHeaders.filter((_value, index, all) => index > 0 && all[index - 1]?.toLowerCase() === "set-cookie");
  if (cookieHeaders.length !== 2) throw new Error("FADENO_ADAPTER_SET_COOKIE");
} finally {
  await adapter.close();
}

console.log(`V1 Node adapter contract passed (${process.versions.node}; Request/Response, authority, streamed body, headers, cookies)`);
