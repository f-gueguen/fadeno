export const EXTRACTION_ORIGIN = "https://extraction.invalid";

export const DOCUMENT_HTML = `<!doctype html>
<html><body><button id="increment" type="button">Increment</button><output id="value">0</output>
<script type="module" src="/document.js"></script></body></html>`;

export const DOCUMENT_MODULE = `
const button = document.querySelector("#increment");
button.addEventListener("click", async () => {
  const module = await import("/handler.js");
  module.increment(document.querySelector("#value"));
});
`;

export const HANDLER_MODULE = `
import { step } from "/shared.js";
export const handlerBoundarySentinel = "fadeno-handler-only-sentinel";
export function increment(output) { output.value = String(Number(output.value) + step); }
`;

export const SHARED_MODULE = `export const step = 1;`;

export const RUNTIME_RESPONSES = new Map<string, Readonly<{ body: string; contentType: string }>>([
  ["/", { body: DOCUMENT_HTML, contentType: "text/html" }],
  ["/document.js", { body: DOCUMENT_MODULE, contentType: "text/javascript" }],
  ["/handler.js", { body: HANDLER_MODULE, contentType: "text/javascript" }],
  ["/shared.js", { body: SHARED_MODULE, contentType: "text/javascript" }],
]);
