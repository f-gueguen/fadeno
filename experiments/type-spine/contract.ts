import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TYPE_SPINE_CANDIDATE_ABI = "generated/candidate-types.ts";

export type TypeSpineScalar = "boolean" | "number" | "string";
export type TypeSpineEntry = Readonly<{ key: string; type: TypeSpineScalar }>;
export type TypeSpineInput = Readonly<{
  schemaVersion: 1;
  visibility: "private-harness-control";
  routes: readonly Readonly<{ id: string; parameters: readonly TypeSpineEntry[] }>[];
  forms: readonly Readonly<{ id: string; fields: readonly TypeSpineEntry[] }>[];
  context: readonly TypeSpineEntry[];
}>;

export const TYPE_SPINE_INPUT = Object.freeze({
  schemaVersion: 1,
  visibility: "private-harness-control",
  routes: [
    { id: "home", parameters: [] },
    { id: "account", parameters: [{ key: "accountId", type: "string" }] },
  ],
  forms: [{
    id: "profile-action",
    fields: [
      { key: "displayName", type: "string" },
      { key: "notificationCount", type: "number" },
    ],
  }],
  context: [
    { key: "actorId", type: "string" },
    { key: "csrfToken", type: "string" },
  ],
} as const satisfies TypeSpineInput);

export const TYPE_SPINE_VALID_FIXTURES = [
  "valid/action-fields.ts",
  "valid/context.ts",
  "valid/link.ts",
  "valid/link-union.ts",
  "valid/route-params.ts",
] as const;

export const TYPE_SPINE_INVALID_FIXTURES = Object.freeze({
  "invalid/action-fields.ts": { code: 2353, line: 5, anchor: "unknownField" },
  "invalid/context.ts": { code: 2339, line: 4, anchor: "tenantId" },
  "invalid/link.ts": { code: 2344, line: 3, anchor: '"missing"' },
  "invalid/link-union.ts": { code: 2322, line: 3, anchor: "link" },
  "invalid/route-params.ts": { code: 2741, line: 3, anchor: "parameters" },
});

const root = dirname(fileURLToPath(import.meta.url));

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function stableTypeSpineContract(): string {
  const sources = [
    ...TYPE_SPINE_VALID_FIXTURES,
    ...Object.keys(TYPE_SPINE_INVALID_FIXTURES),
  ].sort();
  return `${JSON.stringify({
    schemaVersion: 1,
    visibility: "private-harness-contract",
    candidateAbi: TYPE_SPINE_CANDIDATE_ABI,
    input: TYPE_SPINE_INPUT,
    validFixtures: TYPE_SPINE_VALID_FIXTURES,
    invalidFixtures: TYPE_SPINE_INVALID_FIXTURES,
    sources: sources.map((path) => ({
      path,
      sha256: sha256(join(root, "fixtures", path)),
    })),
  })}\n`;
}
