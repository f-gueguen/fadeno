import { A0_FIRST_ALPHA_TAG, A0_FIRST_ALPHA_VERSION } from "./a0-release-identity.ts";

type JsonRecord = Record<string, unknown>;

export interface A0ReleaseEventContext {
  readonly event: unknown;
  readonly sourceCommit: string;
  readonly tagCommit: string;
  readonly expectedReleaseNotes: string;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function validAsset(value: unknown, expectedName: string): boolean {
  const asset = record(value);
  if (!asset
    || asset["name"] !== expectedName
    || asset["state"] !== "uploaded"
    || typeof asset["size"] !== "number"
    || !Number.isSafeInteger(asset["size"])
    || asset["size"] < 1
    || asset["size"] > (expectedName.endsWith(".json") ? 1_048_576 : 67_108_864)) return false;
  for (const [key, host] of [["url", "api.github.com"], ["browser_download_url", "github.com"]] as const) {
    const value = asset[key];
    if (typeof value !== "string") return false;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || parsed.hostname !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function a0ReleaseEventAssets(event: unknown): readonly JsonRecord[] {
  const root = record(event);
  const release = root ? record(root["release"]) : undefined;
  const assets = release?.["assets"];
  return Array.isArray(assets)
    ? Object.freeze(assets.flatMap((value) => {
      const asset = record(value);
      return asset ? [asset] : [];
    }))
    : Object.freeze([]);
}

export function validateA0ReleaseEvent(context: A0ReleaseEventContext): readonly string[] {
  const errors: string[] = [];
  const event = record(context.event);
  const repository = event ? record(event["repository"]) : undefined;
  const release = event ? record(event["release"]) : undefined;
  if (!event || event["action"] !== "published") errors.push("FADENO_A0_RELEASE_EVENT_ACTION");
  if (!repository
    || repository["full_name"] !== "f-gueguen/fadeno"
    || repository["private"] !== false) {
    errors.push("FADENO_A0_RELEASE_EVENT_REPOSITORY");
  }
  if (!/^[0-9a-f]{40}$/u.test(context.sourceCommit)
    || context.tagCommit !== context.sourceCommit) {
    errors.push("FADENO_A0_RELEASE_EVENT_TAG");
  }
  if (!release
    || release["tag_name"] !== A0_FIRST_ALPHA_TAG
    || release["prerelease"] !== true
    || release["draft"] !== false) {
    errors.push("FADENO_A0_RELEASE_EVENT_IDENTITY");
  }
  if (!release || String(release["body"] ?? "").trim() !== context.expectedReleaseNotes.trim()) {
    errors.push("FADENO_A0_RELEASE_EVENT_NOTES");
  }
  const filename = `fadeno-docs-${A0_FIRST_ALPHA_VERSION}.tar.gz`;
  const expectedNames = [filename, `${filename}.json`].sort();
  const assets = a0ReleaseEventAssets(event);
  const names = assets.flatMap((asset) => typeof asset["name"] === "string" ? [asset["name"]] : []).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)
    || !assets.every((asset) => validAsset(asset, String(asset["name"])))) {
    errors.push("FADENO_A0_RELEASE_EVENT_ASSETS");
  }
  return Object.freeze(errors);
}
