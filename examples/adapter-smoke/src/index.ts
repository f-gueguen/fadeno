import type { Handler } from "fadeno-framework-internal";
import { listenNodeHttp, nodeHttpCapabilities } from "fadeno-framework-internal/node";

if (nodeHttpCapabilities.runtime !== "node") throw new Error("adapter capability differs");

const handler: Handler = (request) => new Response(`adapter-smoke:${new URL(request.url).pathname}`, {
  headers: { "content-type": "text/plain; charset=utf-8" },
});

const server = await listenNodeHttp({ handler });
try {
  const response = await fetch(`${server.origin}/hello`);
  if (response.status !== 200 || await response.text() !== "adapter-smoke:/hello") {
    throw new Error("adapter smoke response differs");
  }
} finally {
  await server.close();
}

console.log("Fadeno public adapter smoke passed");
