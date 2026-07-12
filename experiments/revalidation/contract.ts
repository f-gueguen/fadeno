import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REVALIDATION_RESOURCE_IDS = ["activity", "notifications", "permissions", "profile", "projects", "tasks"] as const;
export type RevalidationResourceId = typeof REVALIDATION_RESOURCE_IDS[number];
export type RevalidationWorkload = Readonly<{
  schemaVersion: 1;
  visibility: "private-harness-control";
  seed: string;
  authentication: Readonly<{ principalId: string; tenantId: string; secretCanary: string }>;
  dataset: Readonly<{ rowCount: 10000; generator: "deterministic-row-v1" }>;
  resources: readonly RevalidationResourceId[];
  pageReads: readonly RevalidationResourceId[];
  mutation: Readonly<{ id: "complete-task"; affectedResource: "tasks"; rowId: 4242 }>;
  paths: readonly ["success", "expected-error"];
  comparison: Readonly<{ strategy: "canonical-tagged-json-v1"; handles: readonly string[]; refuses: readonly ["non-cacheable"] }>;
  unsafeKeeps: readonly Readonly<{ id: string; class: "value" | "expected-error" | "ordering" | "non-cacheable"; declaredResource: RevalidationResourceId }>[];
}>;

const root = dirname(fileURLToPath(import.meta.url));
export function loadRevalidationWorkload(): RevalidationWorkload {
  return JSON.parse(readFileSync(join(root, "workload.json"), "utf8")) as RevalidationWorkload;
}

export function stableRevalidationContract(): string {
  const files = ["workload.json", "workload.schema.json"];
  const workload = loadRevalidationWorkload();
  return `${JSON.stringify({
    schemaVersion: 1,
    visibility: "private-harness-contract",
    hypothesis: "H4",
    workload: {
      ...workload,
      authentication: { ...workload.authentication, secretCanary: "[redacted]" },
    },
    sources: files.map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex"),
    })),
  })}\n`;
}
