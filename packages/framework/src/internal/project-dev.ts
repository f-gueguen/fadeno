import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { formatAnalyzerDiagnosticBatchHuman } from "./analyzer-diagnostics.ts";
import type { PrivateAnalyzerOperationHandle } from "./analyzer-coordinator.ts";
import { PrivateAnalyzerOperationInterrupted } from "./analyzer-coordinator.ts";
import { PrivateCompilerValidationError } from "./analyzer-compiler.ts";
import {
  PrivateProjectAnalyzer,
  PrivateProjectDiagnosticError,
  type PrivateProjectRefresh,
} from "./analyzer-project.ts";
import {
  PrivateFilesystemInvalidationAdapter,
  type PrivateFilesystemRefreshTarget,
} from "./analyzer-watcher.ts";
import { AnalyzerRootError } from "./analyzer-session.ts";
import {
  parsePrivateBuildDevArguments,
  PrivateDevelopmentDecisionModel,
  type PrivateEnvironmentSnapshot,
} from "./build-dev-decision.ts";
import { FadenoDiagnosticError, formatDiagnosticHuman } from "./diagnostic.ts";
import {
  formatPrivateProjectRootFailure,
  PrivateProjectGenerationDiagnosticError,
  PrivateProjectGenerationOwner,
  type PrivateStagedProjectGeneration,
} from "./project-build.ts";

const usage = "FADENO_DEV_USAGE: fadeno dev --project-root <path> --port <1..65535>\n";
const gracefulDeadlineMs = 5_000;
const childStartupDeadlineMs = 15_000;
const maximumChildOutputBytes = 8 * 1024 * 1024;
const maximumChildLineBytes = 1024 * 1024;

export interface ProjectDevCommandResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProjectDevCommandContext {
  readonly cwd: string;
  readonly processEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly createIncidentId?: () => string;
  readonly writeStdout?: (value: string) => void;
  readonly writeStderr?: (value: string) => void;
}

type DevelopmentRefresh = Readonly<{ generation: number }>;
type ActiveDevelopmentRefresh = {
  readonly controller: AbortController;
  analyzer: PrivateAnalyzerOperationHandle<PrivateProjectRefresh> | null;
  result: Promise<DevelopmentRefresh> | null;
};

class PrivateDevelopmentStartupError extends TypeError {
  constructor() {
    super("FADENO_DEV_STARTUP");
    this.name = "PrivateDevelopmentStartupError";
  }
}

function isInterruption(error: unknown): boolean {
  return error instanceof PrivateAnalyzerOperationInterrupted ||
    (error instanceof DOMException && error.name === "AbortError");
}

function expectedFailure(error: unknown): string | null {
  if (error instanceof PrivateProjectDiagnosticError) return formatAnalyzerDiagnosticBatchHuman(error.diagnostics);
  if (error instanceof PrivateProjectGenerationDiagnosticError) return error.human;
  if (error instanceof FadenoDiagnosticError) return formatDiagnosticHuman(error);
  if (error instanceof AnalyzerRootError) return formatPrivateProjectRootFailure(error);
  if (error instanceof PrivateDevelopmentStartupError) {
    return "FADENO_DEV_STARTUP: The development server could not start or take ownership of its address.\n";
  }
  if (error instanceof PrivateCompilerValidationError) return `${error.code}\n`;
  if (error instanceof TypeError && /^FADENO_(?:ANALYZER|BUILD|DEV)_[A-Z0-9_:.-]+$/u.test(error.message)) {
    return `${error.message}\n`;
  }
  return null;
}

class PrivateDevelopmentChild {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  readonly #writeStdout: (value: string) => void;
  readonly #writeStderr: (value: string) => void;
  #intentional = false;
  #ready = false;
  readonly #stdoutDecoder = new StringDecoder("utf8");
  readonly #stderrDecoder = new StringDecoder("utf8");
  #stdoutFragments: string[] = [];
  #stdoutFragmentBytes = 0;
  #startupOutputBytes = 0;
  #outputFailed = false;

  private constructor(
    projectRoot: string,
    port: number,
    environment: PrivateEnvironmentSnapshot,
    developmentSessionKeys: string,
    writeStdout: (value: string) => void,
    writeStderr: (value: string) => void,
  ) {
    this.#writeStdout = writeStdout;
    this.#writeStderr = writeStderr;
    this.#child = spawn(process.execPath, [
      "--import",
      join(projectRoot, "dist", ".fadeno", "routes", "loader.js"),
      join(projectRoot, "dist", "server", "bootstrap.js"),
    ], {
      cwd: projectRoot,
      env: {
        ...environment.values,
        FADENO_PORT: String(port),
        FADENO_ORIGIN: environment.values["FADENO_ORIGIN"] ?? `https://127.0.0.1:${port}`,
        FADENO_SESSION_KEYS: environment.values["FADENO_SESSION_KEYS"] ?? developmentSessionKeys,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdin.end();
    this.#exit = new Promise((accept, refuse) => {
      this.#child.once("error", refuse);
      this.#child.once("exit", (code, signal) => accept(Object.freeze({ code, signal })));
    });
  }

  static async start(
    projectRoot: string,
    port: number,
    environment: PrivateEnvironmentSnapshot,
    developmentSessionKeys: string,
    writeStdout: (value: string) => void,
    writeStderr: (value: string) => void,
    signal: AbortSignal,
  ): Promise<PrivateDevelopmentChild> {
    signal.throwIfAborted();
    const instance = new PrivateDevelopmentChild(
      projectRoot,
      port,
      environment,
      developmentSessionKeys,
      writeStdout,
      writeStderr,
    );
    await instance.#waitForReady(port, signal);
    return instance;
  }

  monitorUnexpectedExit(callback: (error: unknown) => void): void {
    void this.#exit.then(({ code, signal }) => {
      if (!this.#intentional) callback(new TypeError(`FADENO_DEV_CHILD_EXIT:${code ?? signal ?? "unknown"}`));
    }, callback);
  }

  async stop(deadlineMs = gracefulDeadlineMs): Promise<void> {
    if (this.#intentional && (this.#child.exitCode !== null || this.#child.signalCode !== null)) return;
    this.#intentional = true;
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.#exit,
        new Promise<never>((_accept, refuse) => {
          timer = setTimeout(() => refuse(new TypeError("FADENO_DEV_CHILD_DRAIN")), deadlineMs);
        }),
      ]);
    } catch (error) {
      this.force();
      try { await this.#exit; } catch { /* the bounded drain failure remains primary */ }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  force(): void {
    this.#intentional = true;
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill("SIGKILL");
  }

  async #waitForReady(port: number, signal: AbortSignal): Promise<void> {
    const expected = `Fadeno production server ready at http://127.0.0.1:${port}.`;
    let acceptReady!: () => void;
    let refuseReady!: (error: unknown) => void;
    const ready = new Promise<void>((accept, refuse) => { acceptReady = accept; refuseReady = refuse; });
    const failOutput = (): void => {
      if (this.#outputFailed) return;
      this.#outputFailed = true;
      if (this.#ready) {
        if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill("SIGKILL");
      } else {
        refuseReady(new PrivateDevelopmentStartupError());
        this.force();
      }
    };
    const consume = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (!this.#ready) {
        this.#startupOutputBytes += chunk.byteLength;
        if (this.#startupOutputBytes > maximumChildOutputBytes) {
          failOutput();
          return;
        }
      }
      if (target === "stderr") {
        const text = this.#stderrDecoder.write(chunk);
        if (this.#ready && text !== "") this.#writeStderr(text);
        return;
      }
      const text = this.#stdoutDecoder.write(chunk);
      let start = 0;
      for (;;) {
        const newline = text.indexOf("\n", start);
        if (newline < 0) break;
        const fragment = text.slice(start, newline);
        const fragmentBytes = Buffer.byteLength(fragment);
        if (this.#stdoutFragmentBytes > maximumChildLineBytes - fragmentBytes) {
          failOutput();
          return;
        }
        const line = this.#stdoutFragments.length === 0
          ? fragment
          : `${this.#stdoutFragments.join("")}${fragment}`;
        this.#stdoutFragments = [];
        this.#stdoutFragmentBytes = 0;
        if (!this.#ready && line === expected) {
          this.#ready = true;
          acceptReady();
        } else if (this.#ready) {
          this.#writeStdout(`${line}\n`);
        }
        start = newline + 1;
      }
      if (start < text.length) {
        const fragment = text.slice(start);
        const fragmentBytes = Buffer.byteLength(fragment);
        if (this.#stdoutFragmentBytes > maximumChildLineBytes - fragmentBytes) {
          failOutput();
          return;
        }
        this.#stdoutFragments.push(fragment);
        this.#stdoutFragmentBytes += fragmentBytes;
      }
    };
    this.#child.stdout.on("data", (chunk: Buffer) => consume("stdout", chunk));
    this.#child.stderr.on("data", (chunk: Buffer) => consume("stderr", chunk));
    const abort = (): void => {
      refuseReady(signal.reason);
      this.force();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      refuseReady(new PrivateDevelopmentStartupError());
      this.force();
    }, childStartupDeadlineMs);
    try {
      await Promise.race([
        ready,
        this.#exit.then(() => { throw new PrivateDevelopmentStartupError(); }),
      ]);
      signal.throwIfAborted();
    } catch (error) {
      this.force();
      try { await this.#exit; } catch { /* the startup failure remains primary */ }
      if (isInterruption(error)) throw error;
      throw new PrivateDevelopmentStartupError();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}

class PrivateDevelopmentTarget implements PrivateFilesystemRefreshTarget<DevelopmentRefresh> {
  readonly #root: string;
  readonly #port: number;
  readonly #analyzer: PrivateProjectAnalyzer;
  readonly #generationOwner: PrivateProjectGenerationOwner;
  readonly #decision: PrivateDevelopmentDecisionModel;
  readonly #writeStdout: (value: string) => void;
  readonly #writeStderr: (value: string) => void;
  readonly #internalFailure: (summary: string) => string;
  readonly #fatal: (error: unknown) => void;
  readonly #children = new Set<PrivateDevelopmentChild>();
  readonly #developmentSessionKeys = `development:${randomBytes(32).toString("base64url")}`;
  #active: ActiveDevelopmentRefresh | null = null;
  #current: Readonly<{ child: PrivateDevelopmentChild; environment: PrivateEnvironmentSnapshot }> | null = null;
  #sequence = 0;
  #closed = false;

  constructor(
    projectRoot: string,
    port: number,
    processEnvironment: Readonly<Record<string, string | undefined>>,
    writeStdout: (value: string) => void,
    writeStderr: (value: string) => void,
    internalFailure: (summary: string) => string,
    fatal: (error: unknown) => void,
  ) {
    this.#root = resolve(projectRoot);
    this.#port = port;
    this.#writeStdout = writeStdout;
    this.#writeStderr = writeStderr;
    this.#internalFailure = internalFailure;
    this.#fatal = fatal;
    this.#analyzer = new PrivateProjectAnalyzer(this.#root);
    this.#generationOwner = new PrivateProjectGenerationOwner(this.#root, processEnvironment);
    this.#decision = new PrivateDevelopmentDecisionModel(gracefulDeadlineMs, port);
  }

  ownsProject(projectRoot: string): boolean { return resolve(projectRoot) === this.#root; }

  refresh(): PrivateAnalyzerOperationHandle<DevelopmentRefresh> {
    if (this.#closed || this.#active) throw new TypeError("FADENO_DEV_STATE");
    const controller = new AbortController();
    const sequence = ++this.#sequence;
    const active: ActiveDevelopmentRefresh = { controller, analyzer: null, result: null };
    this.#active = active;
    const result = this.#refresh(controller, (handle) => {
      active.analyzer = handle;
    }).finally(() => {
      if (this.#active?.controller === controller) this.#active = null;
    });
    active.result = result;
    return Object.freeze({
      requestId: `development-${sequence}-${randomUUID()}`,
      sequence,
      kind: "analysis" as const,
      result,
      cancel: () => {
        controller.abort(new DOMException("Superseded", "AbortError"));
        active.analyzer?.cancel();
      },
    });
  }

  supersedeCurrent(): void {
    this.#active?.controller.abort(new DOMException("Superseded", "AbortError"));
    this.#active?.analyzer?.cancel();
  }

  observeFailure(error: unknown): void {
    const state = this.#decision.snapshot().state;
    if (state === "starting") return;
    if (state === "preparing" || state === "switching") {
      const transition = this.#decision.refuseCandidate();
      if (!isInterruption(error)) this.#writeStdout(transition.output);
    }
    if (!isInterruption(error)) {
      const human = expectedFailure(error);
      this.#writeStderr(human ?? this.#internalFailure("Development refresh failed."));
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.supersedeCurrent();
    const active = this.#active;
    if (active) {
      try { await active.result; } catch { /* closing owns the terminal state */ }
    }
    let failure: unknown = null;
    if (this.#current) {
      try { await this.#current.child.stop(); } catch (error) { failure = error; }
      this.#current = null;
    }
    try { await this.#analyzer.close(); } catch (error) { failure ??= error; }
    try { this.#generationOwner.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }

  force(): void {
    this.supersedeCurrent();
    for (const child of this.#children) child.force();
  }

  signal(now: number): string { return this.#decision.signal(now).output; }
  tick(now: number): string { return this.#decision.tick(now).output; }
  drained(): string { return this.#decision.drained().output; }

  async #refresh(
    controller: AbortController,
    retainAnalyzer: (handle: PrivateAnalyzerOperationHandle<PrivateProjectRefresh>) => void,
  ): Promise<DevelopmentRefresh> {
    const signal = controller.signal;
    const current = this.#current;
    let staged: PrivateStagedProjectGeneration | null = null;
    let compilerFailure: PrivateProjectGenerationDiagnosticError | null = null;
    if (current) this.#decision.prepare(this.#sequence);
    try {
      const analyzerHandle = this.#analyzer.refresh({
        onCompilerDiagnostic: async () => { compilerFailure = await this.#generationOwner.compilerDiagnostics(signal); },
      });
      retainAnalyzer(analyzerHandle);
      let refresh: PrivateProjectRefresh;
      try {
        refresh = await analyzerHandle.result;
      } catch (error) {
        if (compilerFailure) throw compilerFailure;
        throw error;
      }
      signal.throwIfAborted();
      staged = await this.#generationOwner.prepare(refresh, signal);
      signal.throwIfAborted();
      await this.#switch(staged, refresh.generation, signal);
      staged = null;
      return Object.freeze({ generation: refresh.generation });
    } catch (error) {
      staged?.discard();
      throw error;
    }
  }

  async #switch(staged: PrivateStagedProjectGeneration, generation: number, signal: AbortSignal): Promise<void> {
    const previous = this.#current;
    let output: Awaited<ReturnType<PrivateStagedProjectGeneration["accept"]>> | null = null;
    let candidate: PrivateDevelopmentChild | null = null;
    if (previous) {
      await previous.child.stop();
      this.#children.delete(previous.child);
      this.#current = null;
      this.#decision.candidateReady();
    }
    try {
      signal.throwIfAborted();
      output = await staged.accept(signal);
      candidate = await PrivateDevelopmentChild.start(
        this.#root,
        this.#port,
        output.environment,
        this.#developmentSessionKeys,
        this.#writeStdout,
        this.#writeStderr,
        signal,
      );
      this.#children.add(candidate);
      this.#current = Object.freeze({ child: candidate, environment: output.environment });
      candidate.monitorUnexpectedExit((error) => {
        if (this.#current?.child === candidate && !this.#closed) this.#fatal(error);
      });
      output.commit();
      output = null;
      if (previous) this.#writeStdout(this.#decision.acceptCandidate().output);
      else this.#writeStdout(this.#decision.ready(generation).output);
    } catch (error) {
      candidate?.force();
      if (candidate) this.#children.delete(candidate);
      output?.rollback();
      output = null;
      if (previous && !this.#closed) {
        try {
          const restored = await PrivateDevelopmentChild.start(
            this.#root,
            this.#port,
            previous.environment,
            this.#developmentSessionKeys,
            this.#writeStdout,
            this.#writeStderr,
            new AbortController().signal,
          );
          this.#children.add(restored);
          this.#current = Object.freeze({ child: restored, environment: previous.environment });
          restored.monitorUnexpectedExit((failure) => {
            if (this.#current?.child === restored && !this.#closed) this.#fatal(failure);
          });
        } catch (restartError) {
          throw new TypeError("FADENO_DEV_ROLLBACK", { cause: restartError });
        }
      }
      throw error;
    }
  }
}

export async function runProjectDevCommand(
  arguments_: readonly string[],
  context: ProjectDevCommandContext,
): Promise<ProjectDevCommandResult> {
  const parsed = parsePrivateBuildDevArguments(arguments_, context.cwd);
  if (!parsed || parsed.command !== "dev") return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });
  const writeStdout = context.writeStdout ?? (() => undefined);
  const writeStderr = context.writeStderr ?? (() => undefined);
  const internalFailure = (summary: string): string =>
    `FADENO_DEV_INTERNAL: ${summary}\n  incident: ${context.createIncidentId?.() ?? randomUUID()}\n`;
  let target: PrivateDevelopmentTarget | null = null;
  let adapter: PrivateFilesystemInvalidationAdapter<DevelopmentRefresh> | null = null;
  let watcher: FSWatcher | null = null;
  let shuttingDown = false;
  let forced = false;
  let terminalResolve!: (exitCode: 0 | 3) => void;
  const terminal = new Promise<0 | 3>((accept) => { terminalResolve = accept; });
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const force = (message: string): void => {
    forced = true;
    if (message !== "") writeStdout(message);
    target?.force();
    terminalResolve(3);
  };
  const beginShutdown = (forcedByFailure = false): void => {
    if (shuttingDown) {
      force(target?.signal(Date.now()) ?? "Fadeno development shutdown forced.\n");
      return;
    }
    shuttingDown = true;
    const output = target?.signal(Date.now()) ?? "";
    if (output !== "") writeStdout(output);
    watcher?.close();
    shutdownTimer = setTimeout(() => {
      force(target?.tick(Date.now()) ?? "Fadeno development shutdown deadline exceeded.\n");
    }, gracefulDeadlineMs);
    void (adapter?.close() ?? Promise.resolve()).then(() => {
      if (shutdownTimer) clearTimeout(shutdownTimer);
      shutdownTimer = null;
      if (forcedByFailure || forced) terminalResolve(3);
      else {
        const drained = target?.drained() ?? "";
        if (drained !== "") writeStdout(drained);
        terminalResolve(0);
      }
    }, (error) => {
      writeStderr(expectedFailure(error) ?? internalFailure("Development shutdown failed."));
      force("Fadeno development shutdown forced.\n");
    });
  };
  const onSignal = (): void => beginShutdown(false);

  try {
    target = new PrivateDevelopmentTarget(
      parsed.projectRoot,
      parsed.port,
      context.processEnvironment ?? process.env,
      writeStdout,
      writeStderr,
      internalFailure,
      (error) => {
        writeStderr(expectedFailure(error) ?? internalFailure("Development server could not continue."));
        beginShutdown(true);
      },
    );
    adapter = new PrivateFilesystemInvalidationAdapter(parsed.projectRoot, target, {
      onFailure: (_batch, error) => target?.observeFailure(error),
    });
    watcher = watch(parsed.projectRoot, { recursive: true, encoding: "utf8" }, (eventType, filename) => {
      if (shuttingDown) return;
      try {
        const admission = adapter?.notify({
          kind: eventType === "rename" ? "rename" : "change",
          path: typeof filename === "string" ? filename : null,
        });
        if (admission?.status === "accepted") target?.supersedeCurrent();
      } catch (error) {
        writeStderr(expectedFailure(error) ?? internalFailure("Development watcher failed."));
        beginShutdown(true);
      }
    });
    watcher.on("error", (error) => {
      writeStderr(expectedFailure(error) ?? internalFailure("Development watcher failed."));
      beginShutdown(true);
    });
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      await adapter.flush();
    } catch (error) {
      if (shuttingDown) return Object.freeze({ exitCode: await terminal, stdout: "", stderr: "" });
      const human = expectedFailure(error);
      return Object.freeze({
        exitCode: human === null ? 3 as const : 1 as const,
        stdout: "",
        stderr: human ?? internalFailure("Development server could not start."),
      });
    }
    return Object.freeze({ exitCode: await terminal, stdout: "", stderr: "" });
  } catch (error) {
    const human = expectedFailure(error);
    return Object.freeze({
      exitCode: human === null ? 3 as const : 1 as const,
      stdout: "",
      stderr: human ?? internalFailure("Development server could not start."),
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    watcher?.close();
    if (shutdownTimer) clearTimeout(shutdownTimer);
    if (!shuttingDown) {
      try { await adapter?.close(); } catch { /* the returned failure already owns public reporting */ }
    }
  }
}
