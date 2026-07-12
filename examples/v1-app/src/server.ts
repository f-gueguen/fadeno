import { handler } from "../.fadeno/routes/app.ts";
import { listenNodeHttp } from "fadeno-framework-internal/node";

const server = await listenNodeHttp({ handler });
console.log(JSON.stringify({ event: "listening", origin: server.origin }));

async function stop(): Promise<void> {
  await server.close();
  process.exitCode = 0;
}

process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
