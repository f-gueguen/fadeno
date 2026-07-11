import { createHash } from "node:crypto";

export function verifyFrozenReference(document: Buffer, golden: string): void {
  if (!/^[a-f0-9]{64}\n$/u.test(golden)) {
    throw new Error("browser reference digest contract differs");
  }
  const actual = createHash("sha256").update(document).digest("hex");
  if (`${actual}\n` !== golden) throw new Error("frozen browser reference document differs");
}
