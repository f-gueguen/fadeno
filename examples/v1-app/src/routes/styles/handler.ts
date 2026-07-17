import type { Handler } from "fadeno-framework-internal";
import { applicationStyles } from "../../styles.ts";

const handler: Handler = () => new Response(applicationStyles, {
  headers: {
    "cache-control": "public, max-age=300",
    "content-type": "text/css; charset=utf-8",
  },
});

export default handler;
