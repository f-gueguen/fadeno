import { startPrivateBrowserRuntime } from "./internal/browser-runtime.ts";

export type BrowserEnhancementState = "active" | "closed";

export interface BrowserEnhancement {
  state(): BrowserEnhancementState;
  close(): void;
}

/** Starts Fadeno's optional document enhancement runtime. */
export function startBrowserEnhancement(): BrowserEnhancement {
  return startPrivateBrowserRuntime();
}
