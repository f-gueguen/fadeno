import { createHash } from "node:crypto";

import type { V2PatchProtocolFixture } from "./v2-patch-protocol.ts";

export const V2_PATCH_PROTOCOL_CASES_SHA256 = "2627585034bb6184512c399df8f94adbe5a973e45a769e81f13d5e9f4f3b0881";

export function v2PatchProtocolCasesDigest(cases: readonly V2PatchProtocolFixture[]): string {
  return createHash("sha256").update(JSON.stringify(cases)).digest("hex");
}

export function assertV2PatchProtocolCaseSemantics(cases: readonly V2PatchProtocolFixture[]): void {
  const digest = v2PatchProtocolCasesDigest(cases);
  if (digest !== V2_PATCH_PROTOCOL_CASES_SHA256) {
    throw new Error(`FADENO_V2_FIXTURE_SEMANTICS: expected ${V2_PATCH_PROTOCOL_CASES_SHA256}, received ${digest}`);
  }
}
