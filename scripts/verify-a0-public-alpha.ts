import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createA0DocumentationManifest,
  validateA0DocumentationArtifactTree,
  validateA0DocumentationManifest,
  type A0DocumentationManifest,
} from "./lib/a0-docs-artifact.ts";
import {
  A0_DISTRIBUTION_TAG,
  A0_FIRST_ALPHA_TAG,
  A0_FIRST_ALPHA_VERSION,
  A0_PACKAGE_NAME,
} from "./lib/a0-release-identity.ts";
import {
  createA0PackageArtifactIdentity,
  validateA0PackageArtifactIdentity,
} from "./lib/a0-package-artifact.ts";
import { hasVerifiedRegistryAttestation, validateA0PublicAlphaIdentity } from "./lib/a0-public-alpha.ts";

type JsonRecord = Record<string, unknown>;

interface CommandResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunningCommand {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  stdout(): string;
  stderr(): string;
  waitForStdout(value: string): Promise<void>;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function record(value: unknown, code: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(code);
  return value as JsonRecord;
}

function requiredString(value: JsonRecord, key: string, code: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) throw new TypeError(code);
  return result;
}

function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): CommandResult {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return Object.freeze({
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function requireSuccess(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): CommandResult {
  const result = run(command, arguments_, cwd, environment);
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`FADENO_A0_PUBLIC_COMMAND:${command}:${result.status ?? result.signal ?? "unknown"}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function start(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): RunningCommand {
  const child = spawn(command, arguments_, {
    cwd,
    env: { ...process.env, ...environment, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((accept, refuse) => {
    child.once("error", refuse);
    child.once("exit", (code, signal) => accept(Object.freeze({ code, signal })));
  });
  const waitForStdout = async (value: string): Promise<void> => {
    for (let attempt = 0; attempt < 6_000; attempt += 1) {
      if (stdout.includes(value)) return;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise<void>((accept) => setTimeout(accept, 10));
    }
    throw new Error(`FADENO_A0_PUBLIC_WAIT:${value}\n${stdout}${stderr}`);
  };
  return Object.freeze({ child, exit, stdout: () => stdout, stderr: () => stderr, waitForStdout });
}

async function stop(command: RunningCommand): Promise<void> {
  if (command.child.exitCode === null && command.child.signalCode === null) command.child.kill("SIGTERM");
  const result = await Promise.race([
    command.exit,
    new Promise<never>((_accept, refuse) => setTimeout(() => refuse(new Error("FADENO_A0_PUBLIC_SHUTDOWN")), 10_000)),
  ]);
  assert.equal(result.signal, null, `${command.stdout()}${command.stderr()}`);
  assert.equal(result.code, 0, `${command.stdout()}${command.stderr()}`);
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((accept, refuse) => {
    server.once("error", refuse);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new TypeError("FADENO_A0_PUBLIC_PORT");
  await new Promise<void>((accept, refuse) => server.close((error) => error ? refuse(error) : accept()));
  return address.port;
}

async function request(url: string): Promise<Response> {
  const host = new URL(url).hostname;
  const github = host === "api.github.com" || host === "github.com";
  const headers: Record<string, string> = { Accept: github ? "application/vnd.github+json" : "application/json" };
  if (github) {
    headers["User-Agent"] = "fadeno-a0-public-verifier";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
    if (process.env["GITHUB_TOKEN"]) headers["Authorization"] = `Bearer ${process.env["GITHUB_TOKEN"]}`;
  }
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new TypeError(`FADENO_A0_PUBLIC_FETCH:${response.status}:${url}`);
  return response;
}

async function requestJson(url: string): Promise<unknown> {
  return (await request(url)).json() as Promise<unknown>;
}

async function resolveTagCommit(tag: string): Promise<string> {
  const reference = record(await requestJson(`https://api.github.com/repos/f-gueguen/fadeno/git/ref/tags/${encodeURIComponent(tag)}`), "FADENO_A0_PUBLIC_TAG");
  let object = record(reference["object"], "FADENO_A0_PUBLIC_TAG");
  for (let depth = 0; depth < 4; depth += 1) {
    const sha = requiredString(object, "sha", "FADENO_A0_PUBLIC_TAG");
    const type = requiredString(object, "type", "FADENO_A0_PUBLIC_TAG");
    if (type === "commit") return sha;
    if (type !== "tag") throw new TypeError("FADENO_A0_PUBLIC_TAG");
    const tagObject = record(await requestJson(`https://api.github.com/repos/f-gueguen/fadeno/git/tags/${sha}`), "FADENO_A0_PUBLIC_TAG");
    object = record(tagObject["object"], "FADENO_A0_PUBLIC_TAG");
  }
  throw new TypeError("FADENO_A0_PUBLIC_TAG_DEPTH");
}

function treeIdentity(root: string): string {
  const digest = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relative = path.slice(root.length + 1).split("\\").join("/");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) digest.update(relative).update("\0").update(readFileSync(path)).update("\0");
      else throw new TypeError("FADENO_A0_PUBLIC_ARTIFACT_ENTRY");
    }
  };
  visit(root);
  return digest.digest("hex");
}

async function observe(origin: string): Promise<void> {
  const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Your Fadeno application is running/u);
  assert.doesNotMatch(body, /<script(?:\s|>)/u);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const explicitCommit = argument("--source-commit") ?? process.env["FADENO_QUALIFIED_COMMIT"];
const sourceCommit = explicitCommit ?? execFileSync("git", ["rev-parse", `${A0_FIRST_ALPHA_TAG}^{commit}`], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new TypeError("FADENO_A0_PUBLIC_SOURCE_COMMIT");

const encodedPackage = encodeURIComponent(A0_PACKAGE_NAME);
const metadata = record(await requestJson(`https://registry.npmjs.org/${encodedPackage}/${A0_FIRST_ALPHA_VERSION}`), "FADENO_A0_PUBLIC_REGISTRY");
assert.equal(metadata["name"], A0_PACKAGE_NAME);
assert.equal(metadata["version"], A0_FIRST_ALPHA_VERSION);
assert.equal(metadata["gitHead"], sourceCommit);
const repository = record(metadata["repository"], "FADENO_A0_PUBLIC_REPOSITORY");
assert.equal(repository["type"], "git");
assert.equal(repository["directory"], "packages/framework");
assert.ok([
  "https://github.com/f-gueguen/fadeno.git",
  "git+https://github.com/f-gueguen/fadeno.git",
].includes(repository["url"] as string));
const distribution = record(metadata["dist"], "FADENO_A0_PUBLIC_DIST");
const integrity = requiredString(distribution, "integrity", "FADENO_A0_PUBLIC_DIST");
const shasum = requiredString(distribution, "shasum", "FADENO_A0_PUBLIC_DIST");
const tarballUrl = requiredString(distribution, "tarball", "FADENO_A0_PUBLIC_DIST");
const attestationMetadata = record(distribution["attestations"], "FADENO_A0_PUBLIC_PROVENANCE");
const attestations = await requestJson(requiredString(attestationMetadata, "url", "FADENO_A0_PUBLIC_PROVENANCE"));
const tags = record(await requestJson(`https://registry.npmjs.org/-/package/${encodedPackage}/dist-tags`), "FADENO_A0_PUBLIC_DIST_TAG");
assert.equal(tags[A0_DISTRIBUTION_TAG], A0_FIRST_ALPHA_VERSION);

const packageTarball = Buffer.from(await (await request(tarballUrl)).arrayBuffer());
assert.equal(integrity, `sha512-${createHash("sha512").update(packageTarball).digest("base64")}`);
assert.equal(shasum, createHash("sha1").update(packageTarball).digest("hex"));
const tagCommit = await resolveTagCommit(A0_FIRST_ALPHA_TAG);
assert.equal(tagCommit, sourceCommit);

const release = record(await requestJson(`https://api.github.com/repos/f-gueguen/fadeno/releases/tags/${A0_FIRST_ALPHA_TAG}`), "FADENO_A0_PUBLIC_RELEASE");
assert.equal(release["tag_name"], A0_FIRST_ALPHA_TAG);
assert.equal(release["prerelease"], true);
assert.equal(release["draft"], false);
const expectedReleaseNotes = execFileSync("git", ["show", `${sourceCommit}:docs/releases/${A0_FIRST_ALPHA_VERSION}.md`], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(String(release["body"] ?? "").trim(), expectedReleaseNotes);
const assets = release["assets"];
if (!Array.isArray(assets)) throw new TypeError("FADENO_A0_PUBLIC_ASSETS");
const assetByName = (name: string): JsonRecord => {
  const asset = assets.find((value) => typeof value === "object" && value !== null && (value as JsonRecord)["name"] === name);
  return record(asset, "FADENO_A0_PUBLIC_ASSETS");
};
const docsFilename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
const docsAsset = assetByName(docsFilename);
const receiptAsset = assetByName(`${docsFilename}.json`);
const docsBytes = Buffer.from(await (await request(requiredString(docsAsset, "browser_download_url", "FADENO_A0_PUBLIC_ASSETS"))).arrayBuffer());
const receipt = record(await (await request(requiredString(receiptAsset, "browser_download_url", "FADENO_A0_PUBLIC_ASSETS"))).json(), "FADENO_A0_PUBLIC_DOCS_RECEIPT");
assert.equal(receipt["sourceCommit"], sourceCommit);
assert.equal(receipt["sourceTag"], A0_FIRST_ALPHA_TAG);
assert.equal(receipt["packageVersion"], A0_FIRST_ALPHA_VERSION);
assert.equal(receipt["artifactFilename"], docsFilename);
assert.equal(receipt["artifactSha256"], createHash("sha256").update(docsBytes).digest("hex"));

const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), "fadeno-a0-public-alpha-")));
let running: RunningCommand | null = null;
try {
  const publishedPackageArchive = join(temporary, "published-package.tgz");
  const publishedPackageOutput = join(temporary, "published-package");
  writeFileSync(publishedPackageArchive, packageTarball);
  mkdirSync(publishedPackageOutput);
  requireSuccess("tar", ["-xzf", publishedPackageArchive, "-C", publishedPackageOutput], root);

  const sourceArchive = join(temporary, "source.tar");
  const sourceRoot = join(temporary, "source");
  requireSuccess("git", ["archive", "--format=tar", `--output=${sourceArchive}`, sourceCommit], root);
  mkdirSync(sourceRoot);
  requireSuccess("tar", ["-xf", sourceArchive, "-C", sourceRoot], root);
  requireSuccess("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], sourceRoot);
  requireSuccess("pnpm", ["--filter", A0_PACKAGE_NAME, "build"], sourceRoot);
  const expectedTarballs = join(temporary, "expected-tarballs");
  mkdirSync(expectedTarballs);
  requireSuccess("npm", [
    "pack", "./packages/framework", "--ignore-scripts", "--pack-destination", expectedTarballs,
  ], sourceRoot);
  const expectedTarballNames = readdirSync(expectedTarballs).filter((name) => name.endsWith(".tgz"));
  if (expectedTarballNames.length !== 1 || !expectedTarballNames[0]) {
    throw new TypeError("FADENO_A0_PUBLIC_PACKAGE_RECONSTRUCTION");
  }
  const expectedPackageOutput = join(temporary, "expected-package");
  mkdirSync(expectedPackageOutput);
  requireSuccess("tar", [
    "-xzf", join(expectedTarballs, expectedTarballNames[0]), "-C", expectedPackageOutput,
  ], sourceRoot);
  const packageIdentityErrors = validateA0PackageArtifactIdentity(
    createA0PackageArtifactIdentity(join(publishedPackageOutput, "package")),
    createA0PackageArtifactIdentity(join(expectedPackageOutput, "package")),
  );
  if (packageIdentityErrors.length > 0) throw new Error(packageIdentityErrors.join("\n"));

  const manifest = JSON.parse(execFileSync("git", ["show", `${sourceCommit}:evidence/a0/release/docs-manifest.json`], {
    cwd: root,
    encoding: "utf8",
  })) as A0DocumentationManifest;
  const identityErrors = validateA0PublicAlphaIdentity({
    sourceCommit,
    metadata,
    attestations,
    distributionTags: tags,
    tagCommit,
    release,
    expectedReleaseNotes,
    receipt,
    packageIntegrity: `sha512-${createHash("sha512").update(packageTarball).digest("base64")}`,
    packageShasum: createHash("sha1").update(packageTarball).digest("hex"),
    packageSha512: createHash("sha512").update(packageTarball).digest("hex"),
    documentationSha256: createHash("sha256").update(docsBytes).digest("hex"),
    documentationManifest: manifest,
  });
  if (identityErrors.length > 0) throw new Error(identityErrors.join("\n"));
  assert.equal(receipt["documentationAggregateSha256"], manifest.aggregateSha256);
  assert.equal(receipt["fileCount"], manifest.files.length);
  const archive = join(temporary, docsFilename);
  writeFileSync(archive, docsBytes);
  const extracted = join(temporary, "documentation");
  mkdirSync(extracted);
  requireSuccess("tar", ["-xzf", archive, "-C", extracted], root);
  const extractedRoot = join(extracted, `fadeno-docs-${A0_FIRST_ALPHA_VERSION}`);
  const reconstructed = createA0DocumentationManifest(extractedRoot, new Set(manifest.files.map(({ path }) => path)));
  assert.deepEqual(validateA0DocumentationArtifactTree(extractedRoot, manifest), []);
  assert.deepEqual(validateA0DocumentationManifest(manifest, reconstructed), []);

  const runner = join(temporary, "runner");
  mkdirSync(runner);
  writeFileSync(join(runner, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: { [A0_PACKAGE_NAME]: A0_FIRST_ALPHA_VERSION },
  }, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--ignore-scripts"], runner, { npm_config_registry: "https://registry.npmjs.org/" });
  const installedManifest = JSON.parse(readFileSync(join(runner, "node_modules/@fadeno/framework/package.json"), "utf8")) as JsonRecord;
  assert.equal(installedManifest["version"], A0_FIRST_ALPHA_VERSION);
  const executable = join(runner, "node_modules/.bin/fadeno");
  assert.equal(existsSync(executable), true);

  const provenanceRoot = join(temporary, "provenance");
  mkdirSync(provenanceRoot);
  writeFileSync(join(provenanceRoot, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: { [A0_PACKAGE_NAME]: A0_FIRST_ALPHA_VERSION },
  }, null, 2)}\n`);
  requireSuccess("npm", ["install", "--ignore-scripts"], provenanceRoot, { npm_config_registry: "https://registry.npmjs.org/" });
  const provenanceAudit = requireSuccess("npm", ["audit", "signatures"], provenanceRoot, {
    npm_config_registry: "https://registry.npmjs.org/",
  });
  assert.equal(hasVerifiedRegistryAttestation(provenanceAudit.stdout), true);

  const project = join(temporary, "public-alpha-app");
  requireSuccess(executable, ["create", "--project-root", project], runner);
  requireSuccess("pnpm", ["install", "--ignore-scripts"], project, { npm_config_registry: "https://registry.npmjs.org/" });
  const projectManifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as JsonRecord;
  assert.equal(record(projectManifest["dependencies"], "FADENO_A0_PUBLIC_PROJECT")[A0_PACKAGE_NAME], A0_FIRST_ALPHA_VERSION);
  requireSuccess("pnpm", ["test"], project);
  requireSuccess("pnpm", ["check"], project);
  requireSuccess("pnpm", ["build"], project);

  const developmentPort = await reservePort();
  running = start(executable, ["dev", "--project-root", project, "--port", String(developmentPort)], project);
  await running.waitForStdout(`Fadeno development server ready at http://127.0.0.1:${developmentPort}.`);
  await observe(`http://127.0.0.1:${developmentPort}`);
  await stop(running);
  running = null;

  const productionPort = await reservePort();
  running = start("pnpm", ["start"], project, {
    FADENO_PORT: String(productionPort),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: `active:${Buffer.alloc(32, 41).toString("base64url")}`,
  });
  await running.waitForStdout(`Fadeno production server ready at http://127.0.0.1:${productionPort}.`);
  await observe(`http://127.0.0.1:${productionPort}`);
  await stop(running);
  running = null;

  const release1 = join(temporary, "release-1");
  const release2 = join(temporary, "release-2");
  requireSuccess(executable, ["deploy", "--project-root", project, "--output", release1], project);
  const priorIdentity = treeIdentity(release1);
  requireSuccess(executable, ["deploy", "--project-root", project, "--output", release2], project);
  appendFileSync(join(release2, "dist/server/bootstrap.js"), "\n// public verification corruption\n");
  const refused = run("node", ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], release2, {
    FADENO_PORT: String(await reservePort()),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: `active:${Buffer.alloc(32, 41).toString("base64url")}`,
  });
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr.trim(), "FADENO_BUILD_RUNTIME_IDENTITY");

  const rollbackPort = await reservePort();
  running = start("node", ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], release1, {
    FADENO_PORT: String(rollbackPort),
    FADENO_ORIGIN: "https://app.example",
    FADENO_SESSION_KEYS: `active:${Buffer.alloc(32, 41).toString("base64url")}`,
  });
  await running.waitForStdout(`Fadeno production server ready at http://127.0.0.1:${rollbackPort}.`);
  await observe(`http://127.0.0.1:${rollbackPort}`);
  await stop(running);
  running = null;
  assert.equal(treeIdentity(release1), priorIdentity);

  const evidence = Object.freeze({
    schemaVersion: 1,
    milestone: "A0-10",
    status: "verified-public-alpha",
    package: A0_PACKAGE_NAME,
    version: A0_FIRST_ALPHA_VERSION,
    sourceTag: A0_FIRST_ALPHA_TAG,
    sourceCommit,
    distributionTag: A0_DISTRIBUTION_TAG,
    provenancePresent: true,
    packageTarballIntegrityVerified: true,
    packageSourceContentVerified: true,
    documentationArtifactVerified: true,
    publicWorkflows: Object.freeze(["install", "create", "test", "check", "build", "development", "start", "deploy", "rollback"]),
    corruptedCandidateRefused: true,
    priorReleasePreserved: true,
  });
  const output = argument("--output");
  if (output) {
    const destination = resolve(output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  console.log(`A0 public alpha passed (${A0_PACKAGE_NAME}@${A0_FIRST_ALPHA_VERSION}, ${sourceCommit}, create/test/check/build/dev/start/deploy/rollback)`);
} finally {
  if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGKILL");
  rmSync(temporary, { recursive: true, force: true });
}
