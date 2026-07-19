import {
  validateA0ReleaseEvent,
  type A0ReleaseEventContext,
} from "./lib/a0-release-event.ts";

const sourceCommit = "1".repeat(40);
const filename = "fadeno-docs-0.1.0-alpha.1.tar.gz";
const asset = (name: string, id: number): Record<string, unknown> => ({
  id,
  name,
  state: "uploaded",
  size: 100,
  url: `https://api.github.com/repos/f-gueguen/fadeno/releases/assets/${id}`,
  browser_download_url: `https://github.com/f-gueguen/fadeno/releases/download/v0.1.0-alpha.1/${name}`,
});
const context = Object.freeze({
  event: {
    action: "published",
    repository: { full_name: "f-gueguen/fadeno", private: false },
    release: {
      tag_name: "v0.1.0-alpha.1",
      target_commitish: "main",
      prerelease: true,
      draft: false,
      body: "release notes\n",
      assets: [asset(filename, 1), asset(`${filename}.json`, 2)],
    },
  },
  sourceCommit,
  tagCommit: sourceCommit,
  expectedReleaseNotes: "release notes",
}) satisfies A0ReleaseEventContext;

function mutation(expected: string, change: Partial<A0ReleaseEventContext>): void {
  const errors = validateA0ReleaseEvent({ ...context, ...change });
  if (!errors.includes(expected)) throw new Error(`release-event mutation was not refused: ${expected}\n${errors.join("\n")}`);
}

const valid = validateA0ReleaseEvent(context);
if (valid.length > 0) throw new Error(`valid release event refused:\n${valid.join("\n")}`);
mutation("FADENO_A0_RELEASE_EVENT_ACTION", {
  event: { ...(context.event as Record<string, unknown>), action: "created" },
});
mutation("FADENO_A0_RELEASE_EVENT_REPOSITORY", {
  event: { ...(context.event as Record<string, unknown>), repository: { full_name: "f-gueguen/fadeno", private: true } },
});
mutation("FADENO_A0_RELEASE_EVENT_TAG", { tagCommit: "2".repeat(40) });
mutation("FADENO_A0_RELEASE_EVENT_NOTES", { expectedReleaseNotes: "different notes" });
mutation("FADENO_A0_RELEASE_EVENT_ASSETS", {
  event: {
    ...(context.event as Record<string, unknown>),
    release: { ...((context.event as Record<string, unknown>)["release"] as Record<string, unknown>), assets: [asset(filename, 1)] },
  },
});

console.log("A0 release-event mutation tests passed (public source, tag authority, notes, exact assets)");
