import { startBrowserEnhancement } from "@fadeno/framework/browser";

const enhancement = startBrowserEnhancement();
const documentIdentity = globalThis.crypto.randomUUID();

function presentState(): void {
  const status = document.querySelector<HTMLElement>("#demo-enhancement-status");
  if (status) {
    const message = enhancement.state() === "active"
      ? "Active for eligible links and forms."
      : "Native behavior owns this document.";
    if (status.textContent !== message) status.textContent = message;
  }
}

presentState();
new MutationObserver(presentState).observe(document, { childList: true, subtree: true });

Reflect.set(globalThis, "__fadenoDemoEnhancement", enhancement);
Reflect.set(globalThis, "__fadenoDemoDocumentIdentity", documentIdentity);
