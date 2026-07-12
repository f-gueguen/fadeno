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

expectPolicyFailure("deleted V1/DX milestone", "check-project-model.ts", "expected ordered V1/DX milestones", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^\| V1-DX-B \|.*\n/m, "");
  writeFileSync(path, content);
});

expectPolicyFailure("duplicated V1/DX milestone", "check-project-model.ts", "expected ordered V1/DX milestones", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(
    /^(\| V1-DX-B \|.*)$/m,
    "$1\n$1",
  );
  writeFileSync(path, content);
});

expectPolicyFailure("reordered V1/DX milestones", "check-project-model.ts", "expected ordered V1/DX milestones", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8");
  const rowB = content.match(/^\| V1-DX-B \|.*$/m)?.[0] ?? "";
  const rowC = content.match(/^\| V1-DX-C \|.*$/m)?.[0] ?? "";
  writeFileSync(path, content.replace(rowB, "__V1_DX_B__").replace(rowC, rowB).replace("__V1_DX_B__", rowC));
});

expectPolicyFailure("broken numbered V1/DX dependency", "check-project-model.ts", "V1-10 missing dependency V1-DX-B", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^(\| V1-10 \|.*)V1-DX-B, ?/m, "$1");
  writeFileSync(path, content);
});

expectPolicyFailure("wrong V1/DX feature ownership", "check-project-model.ts", "V1-DX-B feature ownership differs", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^\| V1-DX-B \|.*$/m, (line) =>
    line.replace("TYPE-01, ", ""),
  );
  writeFileSync(path, content);
});

expectPolicyFailure("missing V1/DX validation command", "check-project-model.ts", "V1-DX-C missing validation command pnpm check:v1-analyzer-feedback", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^\| V1-DX-C \|.*$/m, (line) =>
    line.replace("; `pnpm check:v1-analyzer-feedback`", ""),
  );
  writeFileSync(path, content);
});

expectPolicyFailure("empty V1/DX artifacts", "check-project-model.ts", "V1-DX-B has no required artifacts", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^\| V1-DX-B \|.*$/m, (line) => {
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    cells[4] = "";
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(path, content);
});

expectPolicyFailure("empty V1/DX delivery boundary", "check-project-model.ts", "V1-DX-C has no delivery boundary", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8").replace(/^\| V1-DX-C \|.*$/m, (line) => {
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    cells[6] = "";
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(path, content);
});

expectPolicyFailure("deleted V1-DX-B sub-slice", "check-project-model.ts", "expected ordered V1-DX-B sub-slices", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^\| V1-DX-B4 \|.*\n/m, ""));
});

expectPolicyFailure("reordered V1-DX-B sub-slices", "check-project-model.ts", "expected ordered V1-DX-B sub-slices", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  const content = readFileSync(path, "utf8");
  const row3 = content.match(/^\| V1-DX-B3 \|.*$/m)?.[0] ?? "";
  const row4 = content.match(/^\| V1-DX-B4 \|.*$/m)?.[0] ?? "";
  writeFileSync(path, content.replace(row3, "__V1_DX_B3__").replace(row4, row3).replace("__V1_DX_B3__", row4));
});

expectPolicyFailure("broken V1-DX-B dependency", "check-project-model.ts", "V1-DX-B5 missing dependency V1-DX-B4", (copy) => {
  const path = join(copy, "docs/roadmap/v1.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^\| V1-DX-B5 \|.*$/m, (line) => line.replace("V1-DX-B4", "V1-DX-B3")));
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("policy mutation tests passed (18 expected failures detected)");
