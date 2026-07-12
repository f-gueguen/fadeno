import { inspectPackageBoundaries } from "./lib/package-boundaries.ts";

const violations = inspectPackageBoundaries(process.cwd());
if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.code}: ${violation.file} ${violation.kind} ${violation.specifier}`);
  }
  process.exit(1);
}

console.log("package boundary check passed (no cross-package relative imports)");
