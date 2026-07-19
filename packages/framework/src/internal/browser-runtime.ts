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
  let state: BrowserRuntimeState = "active";
  const navigation = startPrivateLinkNavigation();
  const handle = Object.freeze({
    state: () => state,
    close() {
      if (state === "closed") return;
      state = "closed";
      navigation?.close();
      if (current === handle) current = undefined;
    },
  });
  current = handle;
  return handle;
}
import { startPrivateLinkNavigation } from "./browser-navigation.ts";
