import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { assertPrivateDeploymentArtifact, runProjectBuildCommand } from "./project-build.ts";

export interface ProjectDeployCommandResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProjectDeployCommandContext {
  readonly cwd: string;
  readonly processEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly packageManagerPath?: string;
  readonly createIncidentId?: () => string;
  readonly beforeInstall?: (artifactRoot: string) => void;
}

type PackageDocument = Readonly<Record<string, unknown>>;

const usage = "FADENO_DEPLOY_USAGE: fadeno deploy --project-root <path> --output <missing-path>\n";
const packageManagerVersion = "11.7.0";
const maximumManifestBytes = 1024 * 1024;
const maximumPackageManagerOutputBytes = 8 * 1024 * 1024;
const startCommand = "node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js";

function refusal(code: string, message: string): ProjectDeployCommandResult {
  return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: `${code}: ${message}\n` });
}

function contained(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

function outputEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

function isOrdinarySymlinkFreeDirectory(path: string): boolean {
  const root = parse(path).root;
  let current = root;
  const rootEntry = lstatSync(current);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return false;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  }
  return true;
}

function readStableDocument(path: string, code: string): PackageDocument {
  try {
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile() || before.size > maximumManifestBytes || realpathSync(path) !== path) {
      throw new TypeError(code);
    }
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (
      after.isSymbolicLink() || !after.isFile() || bytes.byteLength !== before.size || after.dev !== before.dev ||
      after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs || realpathSync(path) !== path
    ) throw new TypeError(code);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
    return value as PackageDocument;
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    throw new TypeError(code);
  }
}

function objectField(document: PackageDocument, name: string): Readonly<Record<string, unknown>> | undefined {
  const value = document[name];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("FADENO_DEPLOY_MANIFEST");
  return value as Readonly<Record<string, unknown>>;
}

function runtimeManifest(document: PackageDocument): PackageDocument {
  const name = document["name"];
  const version = document["version"];
  if (
    typeof name !== "string" || name.length === 0 || name.length > 214 ||
    typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
    document["type"] !== "module" || document["packageManager"] !== `pnpm@${packageManagerVersion}`
  ) throw new TypeError("FADENO_DEPLOY_MANIFEST");
  const dependencies = objectField(document, "dependencies");
  if (!dependencies || Object.keys(dependencies).length === 0) throw new TypeError("FADENO_DEPLOY_MANIFEST");
  return Object.freeze({
    name,
    version,
    private: true,
    type: "module",
    scripts: { start: startCommand },
  });
}

function packageManager(
  path: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const result = spawnSync(path, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...environment, CI: "true" },
    maxBuffer: maximumPackageManagerOutputBytes,
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

export function parseProjectDeployArguments(
  arguments_: readonly string[],
  cwd: string,
): Readonly<{ projectRoot: string; output: string }> | null {
  if (
    !Array.isArray(arguments_) || arguments_.length !== 5 || arguments_[0] !== "deploy" ||
    arguments_[1] !== "--project-root" || !arguments_[2] || arguments_[3] !== "--output" || !arguments_[4] ||
    typeof cwd !== "string"
  ) return null;
  return Object.freeze({ projectRoot: arguments_[2], output: arguments_[4] });
}

export async function runProjectDeployCommand(
  arguments_: readonly string[],
  context: ProjectDeployCommandContext,
): Promise<ProjectDeployCommandResult> {
  const parsed = parseProjectDeployArguments(arguments_, context.cwd);
  if (parsed === null) return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });

  let projectRoot: string;
  let output: string;
  try {
    projectRoot = realpathSync(resolve(context.cwd, parsed.projectRoot));
    output = resolve(realpathSync(context.cwd), parsed.output);
  } catch {
    return refusal("FADENO_DEPLOY_ROOT", "Project root and output parent must be ordinary existing directories.");
  }
  if (contained(projectRoot, output)) {
    return refusal("FADENO_DEPLOY_OUTPUT_BOUNDARY", "Deployment output must be outside the project root.");
  }
  const parent = dirname(output);
  try {
    if (!isOrdinarySymlinkFreeDirectory(parent)) {
      return refusal("FADENO_DEPLOY_OUTPUT_PARENT", "Deployment output parent and ancestors must be ordinary non-symlink directories.");
    }
  } catch {
    return refusal("FADENO_DEPLOY_OUTPUT_PARENT", "Deployment output parent and ancestors must be ordinary non-symlink directories.");
  }
  if (outputEntryExists(output)) return refusal("FADENO_DEPLOY_TARGET_EXISTS", "Deployment output must not already exist.");

  const build = await runProjectBuildCommand(["build", "--project-root", projectRoot], {
    cwd: context.cwd,
    ...(context.processEnvironment === undefined ? {} : { processEnvironment: context.processEnvironment }),
    ...(context.createIncidentId === undefined ? {} : { createIncidentId: context.createIncidentId }),
  });
  if (build.exitCode !== 0) return build;

  let claimed = false;
  try {
    if (outputEntryExists(output)) return refusal("FADENO_DEPLOY_TARGET_EXISTS", "Deployment output must not already exist.");
    const sourceManifestPath = join(projectRoot, "package.json");
    const sourceLockPath = join(projectRoot, "pnpm-lock.yaml");
    const sourceManifest = readStableDocument(sourceManifestPath, "FADENO_DEPLOY_MANIFEST");
    const acceptedManifest = runtimeManifest(sourceManifest);
    let validLock = false;
    try {
      const lockEntry = lstatSync(sourceLockPath);
      validLock = !lockEntry.isSymbolicLink() && lockEntry.isFile() &&
        lockEntry.size <= maximumPackageManagerOutputBytes && realpathSync(sourceLockPath) === sourceLockPath;
    } catch {
      validLock = false;
    }
    if (!validLock) {
      throw new TypeError("FADENO_DEPLOY_LOCKFILE");
    }

    const managerPath = context.packageManagerPath ?? "pnpm";
    const environment = context.processEnvironment ?? process.env;
    const version = packageManager(managerPath, ["--version"], projectRoot, environment);
    if (version.status !== 0 || version.stderr !== "" || version.stdout.trim() !== packageManagerVersion) {
      throw new TypeError("FADENO_DEPLOY_PACKAGE_MANAGER");
    }

    mkdirSync(output);
    claimed = true;
    cpSync(join(projectRoot, "dist"), join(output, "dist"), { recursive: true, errorOnExist: true, force: false });
    cpSync(sourceManifestPath, join(output, "package.json"), { errorOnExist: true, force: false });
    cpSync(sourceLockPath, join(output, "pnpm-lock.yaml"), { errorOnExist: true, force: false });
    context.beforeInstall?.(output);
    const install = packageManager(
      managerPath,
      ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
      output,
      environment,
    );
    if (install.status !== 0) throw new TypeError("FADENO_DEPLOY_INSTALL");
    writeFileSync(join(output, "package.json"), `${JSON.stringify(acceptedManifest, null, 2)}\n`, { encoding: "utf8" });
    unlinkSync(join(output, "pnpm-lock.yaml"));
    await assertPrivateDeploymentArtifact(output);
    return Object.freeze({
      exitCode: 0 as const,
      stdout: `${build.stdout}Fadeno deployment artifact completed at ${output}.\n`,
      stderr: "",
    });
  } catch (error) {
    if (claimed) {
      try {
        rmSync(output, { recursive: true, force: true });
      } catch {
        const incident = context.createIncidentId?.() ?? randomUUID();
        return Object.freeze({
          exitCode: 3 as const,
          stdout: "",
          stderr: `FADENO_DEPLOY_INTERNAL: Deployment cleanup did not complete.\n  incident: ${incident}\n`,
        });
      }
    }
    if (error instanceof TypeError) {
      const messages: Readonly<Record<string, string>> = Object.freeze({
        FADENO_DEPLOY_MANIFEST: "Project package metadata is not deployable.",
        FADENO_DEPLOY_LOCKFILE: "A current ordinary pnpm lockfile is required.",
        FADENO_DEPLOY_PACKAGE_MANAGER: `Deployment requires pnpm ${packageManagerVersion}.`,
        FADENO_DEPLOY_INSTALL: "Production dependency installation failed.",
        FADENO_DEPLOY_ARTIFACT: "The production artifact does not match its accepted build and runtime closure.",
      });
      const message = messages[error.message];
      if (message) return refusal(error.message, message);
    }
    const incident = context.createIncidentId?.() ?? randomUUID();
    return Object.freeze({
      exitCode: 3 as const,
      stdout: "",
      stderr: `FADENO_DEPLOY_INTERNAL: Deployment could not complete.\n  incident: ${incident}\n`,
    });
  }
}
