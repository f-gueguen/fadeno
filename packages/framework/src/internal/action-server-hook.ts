import type { FrameworkFailureObserver } from "./failure-observer.ts";

export interface InstalledActionServerRuntime {
  serve(
    request: Request,
    invoke: (request: Request) => Promise<Response>,
    failureObserver?: FrameworkFailureObserver,
  ): Promise<Response>;
}

export type ActionServerRuntimeFactory = (options: Readonly<{
  canonicalOrigin?: string;
  applicationGeneration?: string;
  sessionKeys?: string;
}>) => InstalledActionServerRuntime | null;

let installedFactory: ActionServerRuntimeFactory = () => null;

export function installActionServerRuntimeFactory(factory: ActionServerRuntimeFactory): void {
  installedFactory = factory;
}

export function createInstalledActionServerRuntime(
  options: Parameters<ActionServerRuntimeFactory>[0],
): InstalledActionServerRuntime | null {
  return installedFactory(options);
}
