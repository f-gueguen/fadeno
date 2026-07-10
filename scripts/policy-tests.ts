import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function copyRepository() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-policy-"));
  const copy = join(temporaryRoot, "repository");
  cpSync(root, copy, {
    recursive: true,
    filter(source) {
      const name = basename(source);
      const path = relative(root, source);
      return name !== ".git" && name !== "node_modules" && !path.startsWith("node_modules/");
    },
  });
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "dir");
  return { copy, temporaryRoot };
}

function expectPolicyFailure(name, script, expectedDiagnostic, mutate) {
  const { copy, temporaryRoot } = copyRepository();
  try {
    mutate(copy);
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", `scripts/${script}`],
      {
      cwd: copy,
      encoding: "utf8",
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0) {
      failures.push(`${name}: policy script unexpectedly passed`);
    } else if (!output.includes(expectedDiagnostic)) {
      failures.push(`${name}: missing expected diagnostic ${expectedDiagnostic}`);
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

expectPolicyFailure("broken Markdown anchor", "check-docs.ts", "section-that-does-not-exist", (copy) => {
  appendFileSync(join(copy, "README.md"), "\n[Broken anchor](#section-that-does-not-exist)\n");
});

expectPolicyFailure("missing project license", "check-docs.ts", "LICENSE", (copy) => {
  rmSync(join(copy, "LICENSE"));
});

expectPolicyFailure("invented traceability authority", "check-project-model.ts", "no linked decision authority", (copy) => {
  const path = join(copy, "docs/traceability.md");
  const content = readFileSync(path, "utf8").replace(
    /^\| GOV-01 \|.*$/m,
    "| GOV-01 | Invented authority | Invented specification | Invented evidence | F0 | Invented proof |",
  );
  writeFileSync(path, content);
});

expectPolicyFailure("missing K0 dependency", "check-project-model.ts", "K0-99", (copy) => {
  const path = join(copy, "docs/roadmap/k0.md");
  const content = readFileSync(path, "utf8").replace(/^\| K0-02 \|.*$/m, (line) => {
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    cells[4] = "K0-99";
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(path, content);
});

expectPolicyFailure("unknown root feature", "check-project-model.ts", "UNKNOWN-99", (copy) => {
  appendFileSync(join(copy, "AGENTS.md"), "\nImplement UNKNOWN-99.\n");
});

expectPolicyFailure("swapped experiment mapping", "check-project-model.ts", "mapping differs from K0 plan", (copy) => {
  const path = join(copy, "experiments/registry.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  const morph = registry.experiments.find((entry) => entry.id === "morph");
  const extraction = registry.experiments.find((entry) => entry.id === "extraction");
  for (const field of ["hypothesis", "harnessSlice", "qualificationSlice"]) {
    [morph[field], extraction[field]] = [extraction[field], morph[field]];
  }
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
});

expectPolicyFailure("duplicate experiment hypothesis", "check-project-model.ts", "duplicate hypothesis H2", (copy) => {
  const path = join(copy, "experiments/registry.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  registry.experiments.find((entry) => entry.id === "morph").hypothesis = "H2";
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("policy mutation tests passed (7 expected failures detected)");
