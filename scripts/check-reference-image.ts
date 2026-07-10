import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { parseJsonBuffer } from "./lib/experiment-contract.ts";
import { loadReferenceEnvironment } from "./lib/experiment-validation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = loadReferenceEnvironment(root);
const { registry, repository, tag, indexDigest, platformDigest, configDigest } =
  reference.container;
const [platformOs, platformArchitecture] = reference.container.platform.split("/");
const base = `https://${registry}/v2/${repository}`;
const signal = AbortSignal.timeout(20_000);

async function fetchJson(url, accept) {
  const response = await fetch(url, { headers: { accept }, signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const body = parseJsonBuffer(bytes, url);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return { response, body, digest };
}

const index = await fetchJson(
  `${base}/manifests/${tag}`,
  "application/vnd.docker.distribution.manifest.list.v2+json",
);
const observedIndexDigest = index.response.headers.get("docker-content-digest");
if (observedIndexDigest !== indexDigest) {
  throw new Error(`reference image index drift: ${observedIndexDigest}`);
}
if (index.digest !== indexDigest) {
  throw new Error(`reference image index content mismatch: ${index.digest}`);
}

const platform = index.body.manifests.find(
  (entry) =>
    entry.platform?.os === platformOs &&
    entry.platform?.architecture === platformArchitecture,
);
if (platform?.digest !== platformDigest) {
  throw new Error(`reference image platform drift: ${platform?.digest ?? "missing"}`);
}

const manifest = await fetchJson(
  `${base}/manifests/${platformDigest}`,
  "application/vnd.docker.distribution.manifest.v2+json",
);
const observedPlatformDigest = manifest.response.headers.get("docker-content-digest");
if (observedPlatformDigest !== platformDigest || manifest.digest !== platformDigest) {
  throw new Error(
    `reference image platform content mismatch: ${observedPlatformDigest}/${manifest.digest}`,
  );
}
if (manifest.body.config?.digest !== configDigest) {
  throw new Error(`reference image config drift: ${manifest.body.config?.digest ?? "missing"}`);
}

const config = await fetchJson(`${base}/blobs/${configDigest}`, "application/json");
if (config.digest !== configDigest) {
  throw new Error(`reference image config content mismatch: ${config.digest}`);
}
if (config.body.os !== platformOs || config.body.architecture !== platformArchitecture) {
  throw new Error(
    `reference image platform mismatch: ${config.body.os}/${config.body.architecture}`,
  );
}
if (config.body.created !== reference.container.createdAt) {
  throw new Error(`reference image creation time drift: ${config.body.created}`);
}

console.log(`reference image verified (${platformDigest})`);
