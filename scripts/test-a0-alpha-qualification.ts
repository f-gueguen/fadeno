import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  loadA0AlphaQualificationContext,
  trackedA0QualificationFiles,
  validateA0AlphaQualification,
  type A0AlphaQualificationContext,
} from "./lib/a0-alpha-qualification.ts";

const root = process.cwd();
const tracked = trackedA0QualificationFiles(root);
const source = loadA0AlphaQualificationContext(root, tracked);

const untrackedDirectory = mkdtempSync(join(root, ".a0-qualification-untracked-"));
try {
  writeFileSync(join(untrackedDirectory, "evidence.json"), "{}\n");
  const current = trackedA0QualificationFiles(root);
  if ([...current].some((path) => path.startsWith(`${basename(untrackedDirectory)}/`))) {
    throw new Error("A0 alpha qualification admitted untracked evidence");
  }
} finally {
  rmSync(untrackedDirectory, { recursive: true, force: true });
}

function cloneDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(source.document)) as Record<string, unknown>;
}

function expectMutation(
  expected: string,
  mutate: (context: A0AlphaQualificationContext) => A0AlphaQualificationContext,
): void {
  const errors = validateA0AlphaQualification(mutate(source));
  if (!errors.includes(expected)) {
    throw new Error(`A0 alpha qualification mutation was not refused: ${expected}\n${errors.join("\n")}`);
  }
}

const validErrors = validateA0AlphaQualification(source);
if (validErrors.length > 0) throw new Error(`valid A0 alpha qualification refused:\n${validErrors.join("\n")}`);

expectMutation("A0 alpha unsupported claim drifted: packagePublished", (context) => {
  const document = cloneDocument();
  (document["claims"] as Record<string, unknown>)["packagePublished"] = true;
  return Object.freeze({ ...context, document });
});
expectMutation("A0 alpha audit gates drifted: security", (context) => {
  const document = cloneDocument();
  const security = (document["audits"] as Record<string, unknown>[])[0]!;
  security["gates"] = (security["gates"] as string[]).filter((gate) => gate !== "check:a0-decoder-fuzz");
  return Object.freeze({ ...context, document });
});
expectMutation("A0 alpha audit evidence drifted: security", (context) => {
  const document = cloneDocument();
  const security = (document["audits"] as Record<string, unknown>[])[0]!;
  security["evidence"] = ["README.md"];
  return Object.freeze({ ...context, document });
});
expectMutation("A0 alpha audit evidence path is unsafe: ../outside.json", (context) => {
  const document = cloneDocument();
  ((document["audits"] as Record<string, unknown>[])[0]!["evidence"] as string[])[0] = "../outside.json";
  return Object.freeze({ ...context, document });
});
expectMutation("A0 alpha audit evidence is not tracked: evidence/a0/qualification/missing.json", (context) => {
  const document = cloneDocument();
  ((document["audits"] as Record<string, unknown>[])[0]!["evidence"] as string[])[0] = "evidence/a0/qualification/missing.json";
  return Object.freeze({ ...context, document });
});
expectMutation("A0 alpha qualification changed the unpublished seed", (context) => Object.freeze({
  ...context,
  packageManifest: { ...(context.packageManifest as Record<string, unknown>), version: "0.1.0-alpha.0" },
}));
expectMutation("A0 alpha qualification introduced a public tooling surface", (context) => Object.freeze({
  ...context,
  packageManifest: {
    ...(context.packageManifest as Record<string, unknown>),
    exports: {
      ...((context.packageManifest as { exports: Record<string, unknown> }).exports),
      "./analyzer": "./dist/analyzer.js",
    },
  },
}));
expectMutation("package README is missing Independent newcomer usability", (context) => Object.freeze({
  ...context,
  packageReadme: context.packageReadme.replace("Independent newcomer usability", "Onboarding"),
}));
expectMutation("A0-09 roadmap validation drifted", (context) => Object.freeze({
  ...context,
  roadmap: context.roadmap.replace("`pnpm check:a0-decoder-fuzz`; ", ""),
}));

console.log("A0 alpha qualification mutation tests passed (claims, gates, evidence, seed, exports, disclosure, roadmap)");
