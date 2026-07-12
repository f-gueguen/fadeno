import type { Handler } from "fadeno-framework-internal";

const handler: Handler = (request) => new Response(`raw:${new URL(request.url).pathname}`, {
  headers: { "content-type": "text/plain; charset=utf-8" },
});

export default handler;
