export type BrowserRuntimeState = "active" | "closed";

export interface BrowserRuntimeHandle {
  readonly state: () => BrowserRuntimeState;
  readonly close: () => void;
}

let current: BrowserRuntimeHandle | undefined;

export function startPrivateBrowserRuntime(): BrowserRuntimeHandle {
  if (typeof document !== "object" || typeof location !== "object") {
    throw new TypeError("FADENO_BROWSER_ENVIRONMENT");
  }
  if (current?.state() === "active") return current;
  const navigation = startPrivateLinkNavigation();
  let passiveState: BrowserRuntimeState = "active";
  const pagehide = (event: PageTransitionEvent): void => {
    if (navigation || event.persisted) return;
    passiveState = "closed";
    globalThis.removeEventListener("pagehide", pagehide);
  };
  if (!navigation) globalThis.addEventListener("pagehide", pagehide);
  const handle = Object.freeze({
    state: (): BrowserRuntimeState => navigation
      ? navigation.state() !== "closed" ? "active" : "closed"
      : passiveState,
    close() {
      if (navigation) navigation.close();
      else {
        passiveState = "closed";
        globalThis.removeEventListener("pagehide", pagehide);
      }
    },
  });
  current = handle;
  return handle;
}
import { startPrivateLinkNavigation } from "./browser-navigation.ts";
