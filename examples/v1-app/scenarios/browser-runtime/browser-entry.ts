import { startBrowserEnhancement } from "@fadeno/framework/browser";

const first = startBrowserEnhancement();
const repeated = startBrowserEnhancement();
first.close();
const restarted = startBrowserEnhancement();

Reflect.set(globalThis, Symbol.for("fadeno.example.browser-runtime"), Object.freeze({
  state: restarted.state(),
  idempotent: first === repeated,
  restarted: restarted !== first,
}));
