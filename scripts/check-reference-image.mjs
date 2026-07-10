import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseJsonBuffer } from "./lib/experiment-contract.mjs";
import { loadReferenceEnvironment } from "./lib/experiment-validation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = loadReferenceEnvironment(root);
const { registry, repository, tag, indexDigest, platformDigest, configDigest } =
  reference.container;
const base = `https://${registry}/v2/${repository}`;
const signal = AbortSignal.timeout(20_000);

async function fetchJson(url, accept) {
  const response = await fetch(url, { headers: { accept }, signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const body = parseJsonBuffer(Buffer.from(await response.arrayBuffer()), url);
  return { response, body };
}

const index = await fetchJson(
  `${base}/manifests/${tag}`,
  "application/vnd.docker.distribution.manifest.list.v2+json",
);
const observedIndexDigest = index.response.headers.get("docker-content-digest");
if (observedIndexDigest !== indexDigest) {
  throw new Error(`reference image index drift: ${observedIndexDigest}`);
}

const platform = index.body.manifests.find(
  (entry) => entry.platform?.os === "linux" && entry.platform?.architecture === "amd64",
);
if (platform?.digest !== platformDigest) {
  throw new Error(`reference image platform drift: ${platform?.digest ?? "missing"}`);
}

const manifest = await fetchJson(
  `${base}/manifests/${platformDigest}`,
  "application/vnd.docker.distribution.manifest.v2+json",
);
if (manifest.body.config?.digest !== configDigest) {
  throw new Error(`reference image config drift: ${manifest.body.config?.digest ?? "missing"}`);
}

const config = await fetchJson(`${base}/blobs/${configDigest}`, "application/json");
if (config.body.os !== "linux" || config.body.architecture !== "amd64") {
  throw new Error(
    `reference image platform mismatch: ${config.body.os}/${config.body.architecture}`,
  );
}
if (config.body.created !== reference.container.createdAt) {
  throw new Error(`reference image creation time drift: ${config.body.created}`);
}

console.log(`reference image verified (${platformDigest})`);
