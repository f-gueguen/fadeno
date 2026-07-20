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
  const handle = Object.freeze({
    state: (): BrowserRuntimeState => navigation && navigation.state() !== "closed" ? "active" : "closed",
    close() {
      navigation?.close();
    },
  });
  current = handle.state() === "active" ? handle : undefined;
  return handle;
}
import { startPrivateLinkNavigation } from "./browser-navigation.ts";
