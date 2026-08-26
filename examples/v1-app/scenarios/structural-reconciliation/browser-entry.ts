import { startBrowserEnhancement } from "@fadeno/framework/browser";

document.addEventListener("mousedown", (event) => {
  if (event.target instanceof Element
    && event.target.closest(
      "#reconciliation-link, #modal-reconciliation-link, #reconciliation-submit",
    )) {
    event.preventDefault();
  }
}, { capture: true });

Reflect.set(globalThis, "__fadenoExampleEnhancement", startBrowserEnhancement());
