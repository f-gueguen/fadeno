import { startBrowserEnhancement } from "@fadeno/framework/browser";

Reflect.set(globalThis, "__fadenoExampleEnhancement", startBrowserEnhancement());
