import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalCiProjection, validateLocalCiProjection } from "./lib/local-ci-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = validateLocalCiProjection(loadLocalCiProjection(root));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("local CI contract passed (clean commit, frozen install, repository check, non-reference)");
