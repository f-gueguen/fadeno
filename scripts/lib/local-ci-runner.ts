import {
  assertStableLocalCiSnapshot,
  LOCAL_CI_STEPS,
  type LocalCiStep,
} from "./local-ci-contract.ts";

export type LocalCiAdapter = Readonly<{
  gitHead: () => string;
  gitStatus: () => string;
  runStep: (step: LocalCiStep) => void;
  report: (message: string) => void;
}>;

export function runLocalCi(adapter: LocalCiAdapter, args: readonly string[]): string {
  if (args.length !== 0) throw new Error(`FADENO_LOCAL_CI_USAGE:${args.join(" ")}`);
  const startHead = adapter.gitHead();
  assertStableLocalCiSnapshot(startHead, startHead, adapter.gitStatus(), "start");
  for (const step of LOCAL_CI_STEPS) {
    adapter.runStep(step);
    assertStableLocalCiSnapshot(startHead, adapter.gitHead(), adapter.gitStatus(), step.name);
  }
  adapter.report(`local CI passed at ${startHead}`);
  return startHead;
}
