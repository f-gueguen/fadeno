import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { formatAnalyzerDiagnosticBatchHuman } from "./analyzer-diagnostics.ts";
import { PrivateProjectAnalyzer, type PrivateProjectAnalysis } from "./analyzer-project.ts";
import { formatRouteExplainHuman } from "./analyzer-route-explain.ts";
import { AnalyzerRootError } from "./analyzer-session.ts";
import { FadenoDiagnosticError, formatDiagnosticHuman } from "./diagnostic.ts";

export interface ProjectCheckCommandResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProjectCheckCommandContext {
  readonly cwd: string;
  readonly analyzeProject?: (root: string) => Promise<PrivateProjectAnalysis>;
  readonly createIncidentId?: () => string;
}

type ParsedProjectCheck = Readonly<{ root: string; explain: boolean }>;

const usage = "FADENO_CHECK_USAGE: fadeno check --project-root <path> [--explain]\n";

export function parseProjectCheckArguments(arguments_: readonly string[], cwd: string): ParsedProjectCheck | null {
  if (!Array.isArray(arguments_) || arguments_[0] !== "check" || typeof cwd !== "string") return null;
  let root: string | null = null;
  let explain = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--project-root") {
      const value = arguments_[++index];
      if (root !== null || !value) return null;
      root = resolve(cwd, value);
    } else if (argument === "--explain") {
      if (explain) return null;
      explain = true;
    } else {
      return null;
    }
  }
  return root === null ? null : Object.freeze({ root, explain });
}

async function semanticFlow(analysis: PrivateProjectAnalysis): Promise<string> {
  const result = await analysis.explain("semantic");
  if (result.status !== "complete" || result.contributions.length !== 1) {
    throw new TypeError("FADENO_CHECK_EXPLAIN");
  }
  return formatRouteExplainHuman(result.contributions[0]!);
}

export async function runProjectCheckCommand(
  arguments_: readonly string[],
  context: ProjectCheckCommandContext,
): Promise<ProjectCheckCommandResult> {
  const parsed = parseProjectCheckArguments(arguments_, context.cwd);
  if (!parsed) return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });
  try {
    const analyzeProject = context.analyzeProject ?? (async (root: string) => new PrivateProjectAnalyzer(root).analyze().result);
    const analysis = await analyzeProject(parsed.root);
    const flow = parsed.explain ? await semanticFlow(analysis) : "";
    if (analysis.diagnostics.diagnostics.length > 0) {
      return Object.freeze({
        exitCode: 1 as const,
        stdout: "",
        stderr: `${formatAnalyzerDiagnosticBatchHuman(analysis.diagnostics)}${flow}`,
      });
    }
    const routes = analysis.routePlan?.manifest.routes.length ?? 0;
    const report = `Fadeno framework route analysis completed: ${routes} routes, ${analysis.publication.artifacts.length} artifacts planned, no files written.\n`;
    return Object.freeze({ exitCode: 0 as const, stdout: `${report}${flow}`, stderr: "" });
  } catch (error) {
    if (error instanceof FadenoDiagnosticError) {
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: formatDiagnosticHuman(error) });
    }
    if (error instanceof AnalyzerRootError) {
      const summary = error.code === "FADENO_ANALYZER_ROOT_MISSING"
        ? "Project root does not exist."
        : error.code === "FADENO_ANALYZER_ROOT_OWNERSHIP"
          ? "Project root must be one owned, non-symlink directory."
          : "Project root must be an absolute path.";
      return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: `${error.code}: ${summary}\n` });
    }
    const incidentId = context.createIncidentId?.() ?? randomUUID();
    const stderr = `FADENO_CHECK_INTERNAL: Framework route analysis could not complete.\n  incident: ${incidentId}\n`;
    return Object.freeze({ exitCode: 3 as const, stdout: "", stderr });
  }
}
