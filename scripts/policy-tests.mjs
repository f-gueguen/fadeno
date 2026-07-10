import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  return { copy, temporaryRoot };
}

function expectPolicyFailure(name, script, mutate) {
  const { copy, temporaryRoot } = copyRepository();
  try {
    mutate(copy);
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: copy,
      encoding: "utf8",
    });
    if (result.status === 0) {
      failures.push(`${name}: policy script unexpectedly passed`);
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

expectPolicyFailure("broken Markdown anchor", "check-docs.mjs", (copy) => {
  appendFileSync(join(copy, "README.md"), "\n[Broken anchor](#section-that-does-not-exist)\n");
});

expectPolicyFailure("missing project license", "check-docs.mjs", (copy) => {
  rmSync(join(copy, "LICENSE"));
});

expectPolicyFailure("invented traceability authority", "check-project-model.mjs", (copy) => {
  const path = join(copy, "docs/traceability.md");
  const content = readFileSync(path, "utf8").replace(
    /^\| GOV-01 \|.*$/m,
    "| GOV-01 | Invented authority | Invented specification | Invented evidence | F0 | Invented proof |",
  );
  writeFileSync(path, content);
});

expectPolicyFailure("missing K0 dependency", "check-project-model.mjs", (copy) => {
  const path = join(copy, "docs/roadmap/k0.md");
  const content = readFileSync(path, "utf8").replace(/^\| K0-02 \|.*$/m, (line) => {
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    cells[4] = "K0-99";
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(path, content);
});

expectPolicyFailure("unknown root feature", "check-project-model.mjs", (copy) => {
  appendFileSync(join(copy, "AGENTS.md"), "\nImplement UNKNOWN-99.\n");
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("policy mutation tests passed (5 expected failures detected)");
