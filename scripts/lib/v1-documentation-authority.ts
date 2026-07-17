import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const evidenceKinds = ["success", "failure", "correction", "flow", "recovery", "staleRemoval"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function files(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".fadeno" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

function safeFile(root: string, path: string, errors: string[]): string | undefined {
  if (!path || path.startsWith("/") || path.split(/[\\/]/u).includes("..")) {
    errors.push(`unsafe documentation authority path: ${path}`);
    return undefined;
  }
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    errors.push(`documentation authority path escapes its root: ${path}`);
    return undefined;
  }
  if (!existsSync(target) || !lstatSync(target).isFile()) {
    errors.push(`documentation authority file is missing: ${path}`);
    return undefined;
  }
  if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(`${realpathSync(root)}${sep}`)) {
    errors.push(`documentation authority file must be a contained regular file: ${path}`);
    return undefined;
  }
  return target;
}

export function checkV1DocumentationAuthority(repositoryRoot: string, trackedPaths: ReadonlySet<string>): readonly string[] {
  const errors: string[] = [];
  const examplesRoot = join(repositoryRoot, "examples");
  const authorityPath = join(examplesRoot, "authority.json");
  const authority = JSON.parse(readFileSync(authorityPath, "utf8")) as unknown;
  if (!object(authority) || authority.schemaVersion !== 1 || typeof authority.canonicalApplication !== "string") {
    return ["examples/authority.json: unsupported authority contract"];
  }

  const supporting = Array.isArray(authority.supportingExamples) ? authority.supportingExamples : [];
  const declared = new Set<string>([authority.canonicalApplication]);
  for (const value of supporting) {
    if (!object(value) || typeof value.path !== "string" || value.role !== "package-adapter-smoke") {
      errors.push("examples/authority.json: supporting examples must declare the narrow package-adapter-smoke role");
      continue;
    }
    declared.add(value.path);
  }
  const packagedExamples = readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(examplesRoot, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify([...declared].sort()) !== JSON.stringify(packagedExamples)) {
    errors.push("examples/authority.json: every packaged example must have exactly one declared role");
  }
  if (authority.canonicalApplication !== "v1-app") {
    errors.push("examples/authority.json: v1-app must remain the sole canonical V1 application");
  }

  const appRoot = join(examplesRoot, authority.canonicalApplication);
  const manifestPath = join(appRoot, "documentation-source.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (!object(manifest) || manifest.schemaVersion !== 1 || !object(manifest.evidence)) {
    return [...errors, "examples/v1-app/documentation-source.json: unsupported source contract"];
  }

  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  for (const gate of strings(manifest.verificationGates)) {
    if (!rootPackage.scripts?.[gate]) errors.push(`documentation authority references unknown verification gate: ${gate}`);
  }
  if (strings(manifest.verificationGates).length === 0) errors.push("documentation authority requires verification gates");

  for (const rootPath of strings(manifest.applicationRoots)) {
    const target = resolve(appRoot, rootPath);
    if (!existsSync(target)) {
      errors.push(`documentation application root is missing: ${rootPath}`);
      continue;
    }
    const owned = lstatSync(target).isDirectory() ? files(target) : [target];
    for (const file of owned) {
      const repositoryPath = relative(repositoryRoot, file);
      if (!trackedPaths.has(repositoryPath)) errors.push(`documentation application source is not tracked: ${repositoryPath}`);
    }
  }

  const categorized = new Set<string>();
  for (const kind of evidenceKinds) {
    const entries = strings(manifest.evidence[kind]);
    if (entries.length === 0) errors.push(`documentation evidence category is empty: ${kind}`);
    for (const path of entries) {
      const file = safeFile(appRoot, path, errors);
      if (!file) continue;
      const repositoryPath = relative(repositoryRoot, file);
      if (!trackedPaths.has(repositoryPath)) errors.push(`documentation evidence is not tracked: ${repositoryPath}`);
      categorized.add(path);
    }
  }

  const scenarioRoot = typeof manifest.scenarioRoot === "string" ? resolve(appRoot, manifest.scenarioRoot) : "";
  const evidenceFiles = [...files(join(appRoot, "expected")), ...files(scenarioRoot)]
    .filter((file) => file.startsWith(join(appRoot, "expected")) || file.includes(`${sep}expected${sep}`))
    .map((file) => relative(appRoot, file));
  for (const path of evidenceFiles) {
    if (!categorized.has(path)) errors.push(`verified example evidence has no documentation category: ${path}`);
  }
  for (const path of categorized) {
    if (!evidenceFiles.includes(path)) errors.push(`documentation category does not reference verified evidence: ${path}`);
  }

  for (const required of ["examples/authority.json", "examples/v1-app/documentation-source.json"]) {
    if (!trackedPaths.has(required)) errors.push(`documentation authority contract is not tracked: ${required}`);
  }
  return errors;
}
