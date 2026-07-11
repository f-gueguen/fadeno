import { spawnSync } from "node:child_process";

export class ExperimentSourceError extends Error {
  readonly code: "git" | "dirty" | "commit" | "changed";

  constructor(code: ExperimentSourceError["code"], message: string) {
    super(message);
    this.name = "ExperimentSourceError";
    this.code = code;
  }
}

function runGit(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new ExperimentSourceError(
      "git",
      `git ${args.join(" ")} failed: ${result.stderr || result.error?.message || result.signal}`,
    );
  }
  return result.stdout.trim();
}

export function inspectExperimentSource(
  repositoryRoot: string,
  options: Readonly<{ requireClean?: boolean; expectedCommit?: string }> = {},
): Readonly<{ commit: string; dirty: boolean }> {
  const status = runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const dirty = status !== "";
  if (options.requireClean && dirty) {
    throw new ExperimentSourceError(
      "dirty",
      "qualification requires a clean tracked and untracked working tree",
    );
  }
  const commit = runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new ExperimentSourceError("commit", "source commit is invalid");
  }
  if (options.expectedCommit && commit !== options.expectedCommit) {
    throw new ExperimentSourceError(
      "changed",
      "qualification source commit changed during execution",
    );
  }
  return { commit, dirty };
}
