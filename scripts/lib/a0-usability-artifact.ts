import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import { verifyA0UsabilityPacket } from "./a0-usability-contract.ts";

type RecordValue = Record<string, unknown>;

export interface A0UsabilityParticipantBundleIdentity {
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly packageSha256: string;
  readonly packageFilename: string;
}

const bundleReadme = `# Independent Fadeno workflow bundle

Use the literal source commit, package filename, and package SHA-256 from
cover-sheet.json wherever the task packet shows placeholders. Verify the
package digest before starting. Use only this bundle, the created application's
README, and public repository documentation. Private facilitator guidance is
not allowed; record every started attempt and any intervention.
`;
const commitPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command: string, arguments_: readonly string[], cwd: string): Buffer {
  const result = spawnSync(command, arguments_, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new TypeError(`FADENO_A0_USABILITY_ARTIFACT_COMMAND:${command}`);
  return result.stdout;
}

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], code: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new TypeError(code);
}

function assertOrdinaryDirectoryChain(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split("/").filter(Boolean)) {
    current = join(current, segment);
    const status = lstatSync(current);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new TypeError("FADENO_A0_USABILITY_BUNDLE_PARENT");
  }
}

function packageManifestVersion(repositoryRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, "packages/framework/package.json"), "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== "@fadeno/framework" || typeof manifest.version !== "string") {
    throw new TypeError("FADENO_A0_USABILITY_ARTIFACT_PACKAGE");
  }
  return manifest.version;
}

function packedTarball(directory: string): string {
  const names = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
  if (names.length !== 1) throw new TypeError("FADENO_A0_USABILITY_ARTIFACT_TARBALL");
  return join(directory, names[0]!);
}

export function reconstructA0UsabilityPackage(repositoryRoot: string, sourceCommit: string): A0UsabilityParticipantBundleIdentity {
  if (!commitPattern.test(sourceCommit)) throw new TypeError("FADENO_A0_USABILITY_ARTIFACT_COMMIT");
  run("git", ["merge-base", "--is-ancestor", sourceCommit, "HEAD"], repositoryRoot);
  const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-usability-reconstruct-"));
  try {
    const archive = join(temporary, "source.tar");
    run("git", ["archive", "--format=tar", "-o", archive, sourceCommit], repositoryRoot);
    const source = join(temporary, "source");
    mkdirSync(source);
    run("tar", ["-xf", archive, "-C", source], temporary);
    run("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], source);
    run("pnpm", ["--filter", "@fadeno/framework", "build"], source);
    const tarballs = join(temporary, "tarballs");
    mkdirSync(tarballs);
    run("pnpm", ["pack", "--pack-destination", tarballs], join(source, "packages/framework"));
    const tarball = packedTarball(tarballs);
    return Object.freeze({
      sourceCommit,
      packageVersion: packageManifestVersion(source),
      packageSha256: sha256(readFileSync(tarball)),
      packageFilename: basename(tarball),
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyA0UsabilityParticipantBundle(directory: string, expectedDisposition: "participant-artifact" | "synthetic-not-user-evidence"): A0UsabilityParticipantBundleIdentity {
  const code = "FADENO_A0_USABILITY_BUNDLE";
  const names = readdirSync(directory).sort();
  const coverPath = join(directory, "cover-sheet.json");
  const cover = record(JSON.parse(readFileSync(coverPath, "utf8")) as unknown, code);
  exactKeys(cover, ["schema", "version", "disposition", "sourceCommit", "package", "packet", "guidance"], code);
  if (
    cover["schema"] !== "fadeno.a0.independent-usability-participant-bundle" || cover["version"] !== 1 ||
    cover["disposition"] !== expectedDisposition || typeof cover["sourceCommit"] !== "string" ||
    !commitPattern.test(cover["sourceCommit"])
  ) throw new TypeError(code);
  const packageRecord = record(cover["package"], code);
  exactKeys(packageRecord, ["name", "version", "filename", "sha256"], code);
  if (
    packageRecord["name"] !== "@fadeno/framework" || typeof packageRecord["version"] !== "string" ||
    typeof packageRecord["filename"] !== "string" || basename(packageRecord["filename"]) !== packageRecord["filename"] ||
    !packageRecord["filename"].endsWith(".tgz") || typeof packageRecord["sha256"] !== "string" ||
    !digestPattern.test(packageRecord["sha256"])
  ) throw new TypeError(code);
  const expectedNames = ["README.md", "cover-sheet.json", packageRecord["filename"], "task-packet.json", "task-packet.md"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new TypeError(code);
  for (const name of names) {
    const status = lstatSync(join(directory, name));
    if (!status.isFile() || status.isSymbolicLink()) throw new TypeError(code);
  }
  const tarballPath = join(directory, packageRecord["filename"]);
  const tarballStatus = lstatSync(tarballPath);
  if (!tarballStatus.isFile() || tarballStatus.isSymbolicLink() || tarballStatus.size < 1 || tarballStatus.size > 20 * 1024 * 1024) {
    throw new TypeError(code);
  }
  if (sha256(readFileSync(tarballPath)) !== packageRecord["sha256"]) throw new TypeError(code);
  const packetRecord = record(cover["packet"], code);
  exactKeys(packetRecord, ["packetId", "instructionSha256", "jsonSha256", "markdownSha256"], code);
  const packetJson = readFileSync(join(directory, "task-packet.json"));
  const packetMarkdown = readFileSync(join(directory, "task-packet.md"));
  const packet = verifyA0UsabilityPacket(JSON.parse(packetJson.toString("utf8")) as unknown);
  if (
    packetRecord["packetId"] !== packet.packetId || packetRecord["instructionSha256"] !== packet.instructionSha256 ||
    packetRecord["jsonSha256"] !== sha256(packetJson) || packetRecord["markdownSha256"] !== sha256(packetMarkdown) ||
    packet.instructionSha256 !== sha256(packetMarkdown)
  ) throw new TypeError(code);
  const guidance = record(cover["guidance"], code);
  exactKeys(guidance, ["privateGuidanceAllowed", "readmeSha256"], code);
  if (guidance["privateGuidanceAllowed"] !== false || guidance["readmeSha256"] !== sha256(readFileSync(join(directory, "README.md")))) {
    throw new TypeError(code);
  }
  if (expectedDisposition === "participant-artifact" && (
    cover["sourceCommit"] === "0".repeat(40) || packageRecord["sha256"] === "0".repeat(64) ||
    readFileSync(join(directory, "README.md"), "utf8") !== bundleReadme
  )) throw new TypeError(code);
  return Object.freeze({
    sourceCommit: cover["sourceCommit"],
    packageVersion: packageRecord["version"],
    packageSha256: packageRecord["sha256"],
    packageFilename: packageRecord["filename"],
  });
}

export function prepareA0UsabilityParticipantBundle(repositoryRoot: string, requestedOutput: string): A0UsabilityParticipantBundleIdentity {
  if (requestedOutput.length === 0) throw new TypeError("FADENO_A0_USABILITY_BUNDLE_USAGE");
  const output = isAbsolute(requestedOutput) ? resolve(requestedOutput) : resolve(repositoryRoot, requestedOutput);
  const parent = dirname(output);
  const repositoryContainment = relative(repositoryRoot, output);
  if (repositoryContainment.length === 0 || !repositoryContainment.startsWith("..")) {
    throw new TypeError("FADENO_A0_USABILITY_BUNDLE_OUTPUT");
  }
  assertOrdinaryDirectoryChain(parent);
  if (existsSync(output)) throw new TypeError("FADENO_A0_USABILITY_BUNDLE_EXISTS");
  if (run("git", ["status", "--porcelain"], repositoryRoot).toString("utf8").trim().length !== 0) {
    throw new TypeError("FADENO_A0_USABILITY_BUNDLE_DIRTY");
  }
  const sourceCommit = run("git", ["rev-parse", "HEAD"], repositoryRoot).toString("utf8").trim();
  if (!commitPattern.test(sourceCommit)) throw new TypeError("FADENO_A0_USABILITY_ARTIFACT_COMMIT");
  mkdirSync(output);
  try {
    run("pnpm", ["--filter", "@fadeno/framework", "build"], repositoryRoot);
    run("pnpm", ["pack", "--pack-destination", output], join(repositoryRoot, "packages/framework"));
    const tarball = packedTarball(output);
    const currentIdentity = Object.freeze({
      sourceCommit,
      packageVersion: packageManifestVersion(repositoryRoot),
      packageSha256: sha256(readFileSync(tarball)),
      packageFilename: basename(tarball),
    });
    const reconstructed = reconstructA0UsabilityPackage(repositoryRoot, sourceCommit);
    if (JSON.stringify(currentIdentity) !== JSON.stringify(reconstructed)) {
      throw new TypeError("FADENO_A0_USABILITY_ARTIFACT_RECONSTRUCTION");
    }
    const packetJsonSource = join(repositoryRoot, "evidence/a0/independent-usability/task-packet.json");
    const packetMarkdownSource = join(repositoryRoot, "evidence/a0/independent-usability/task-packet.md");
    cpSync(packetJsonSource, join(output, "task-packet.json"));
    cpSync(packetMarkdownSource, join(output, "task-packet.md"));
    writeFileSync(join(output, "README.md"), bundleReadme);
    const packetJson = readFileSync(packetJsonSource);
    const packetMarkdown = readFileSync(packetMarkdownSource);
    const packet = verifyA0UsabilityPacket(JSON.parse(packetJson.toString("utf8")) as unknown);
    writeFileSync(join(output, "cover-sheet.json"), `${JSON.stringify({
      schema: "fadeno.a0.independent-usability-participant-bundle",
      version: 1,
      disposition: "participant-artifact",
      sourceCommit,
      package: {
        name: "@fadeno/framework",
        version: currentIdentity.packageVersion,
        filename: currentIdentity.packageFilename,
        sha256: currentIdentity.packageSha256,
      },
      packet: {
        packetId: packet.packetId,
        instructionSha256: packet.instructionSha256,
        jsonSha256: sha256(packetJson),
        markdownSha256: sha256(packetMarkdown),
      },
      guidance: { privateGuidanceAllowed: false, readmeSha256: sha256(bundleReadme) },
    }, null, 2)}\n`);
    return verifyA0UsabilityParticipantBundle(output, "participant-artifact");
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
