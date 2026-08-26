import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default function teardown(): void {
  rmSync(join(repositoryRoot, "output/v2-reconciliation"), {
    recursive: true,
    force: true,
  });
}
