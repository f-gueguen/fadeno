import {
  loadA0AlphaQualificationContext,
  trackedA0QualificationFiles,
  validateA0AlphaQualification,
} from "./lib/a0-alpha-qualification.ts";

const root = process.cwd();
const tracked = trackedA0QualificationFiles(root);
const errors = validateA0AlphaQualification(loadA0AlphaQualificationContext(root, tracked));
if (errors.length > 0) throw new Error(errors.join("\n"));

console.log("A0 alpha qualification passed (9 fail-closed audits, packed workflows, caveats retained, immutable seed source bound)");
