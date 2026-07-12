import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type QualificationPolicy = Readonly<{
  corpus: Readonly<{ outputA: string; outputB: string }>;
  measurement: Readonly<{ warmups: 5; samples: 20 }>;
  stockTypeScript: Readonly<{ compilerArguments: readonly string[]; languageServerArguments: readonly string[] }>;
}>;

const root = dirname(fileURLToPath(import.meta.url));
export const QUALIFICATION_POLICY = JSON.parse(
  readFileSync(join(root, "qualification-contract.json"), "utf8"),
) as QualificationPolicy;
