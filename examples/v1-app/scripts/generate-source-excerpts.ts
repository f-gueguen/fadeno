import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const applicationRoot = fileURLToPath(new URL("../", import.meta.url));
const output = join(applicationRoot, "src/generated/demo-source-excerpts.ts");
const check = process.argv.includes("--check");

const sources = [
  { key: "overview", path: "src/routes/page.tsx", marker: "overview" },
  { key: "routing", path: "src/routes/hello/[name]/page.tsx", marker: "routing" },
  { key: "resources", path: "src/routes/resources/page.tsx", marker: "resources" },
  { key: "signIn", path: "src/projects.ts", marker: "sign-in" },
  { key: "createProject", path: "src/projects.ts", marker: "create-project" },
  { key: "recovery", path: "src/routes/resource-recovery/page.tsx", marker: "recovery" },
] as const;

function excerpt(path: string, marker: string): string {
  const lines = readFileSync(join(applicationRoot, path), "utf8").replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `// fadeno-demo-source:start ${marker}`);
  const end = lines.findIndex((line, index) =>
    index > start && line.trim() === `// fadeno-demo-source:end ${marker}`);
  if (start === -1 || end === -1) throw new Error(`FADENO_DEMO_SOURCE_MARKER:${path}:${marker}`);
  if (lines.findIndex((line, index) =>
    index > start && index < end && line.trim().startsWith("// fadeno-demo-source:")) !== -1) {
    throw new Error(`FADENO_DEMO_SOURCE_NESTING:${path}:${marker}`);
  }
  const selected = lines.slice(start + 1, end);
  const indent = Math.min(...selected.filter((line) => line.trim().length > 0).map((line) => /^\s*/u.exec(line)?.[0].length ?? 0));
  const value = selected.map((line) => line.slice(indent)).join("\n").trimEnd();
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > 8_192) {
    throw new Error(`FADENO_DEMO_SOURCE_BOUNDS:${path}:${marker}`);
  }
  return value;
}

const excerpts = Object.fromEntries(sources.map(({ key, path, marker }) => [key, excerpt(path, marker)]));
const generated = [
  "// Generated from marked executable application source. Do not edit.",
  `export const demoSourceExcerpts = Object.freeze(${JSON.stringify(excerpts, null, 2)} as const);`,
  "export type DemoSourceExcerpt = keyof typeof demoSourceExcerpts;",
  "",
].join("\n");

if (check) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== generated) {
    throw new Error("FADENO_DEMO_SOURCE_EXCERPTS_STALE");
  }
  console.log("Fadeno demo source excerpts match executable application files");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generated);
  console.log("Fadeno demo source excerpts generated from executable application files");
}
