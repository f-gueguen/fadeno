import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  createProjectTemplate,
  runProjectCreateCommand,
  type ProjectCreateCommandContext,
} from "../packages/framework/src/internal/project-create.ts";

function treeIdentity(root: string): readonly Readonly<{ path: string; sha256: string }>[] {
  const files: { path: string; sha256: string }[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(root, path).split("\\").join("/"),
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
      else throw new TypeError("FADENO_A0_CREATE_TREE_ENTRY");
    }
  };
  visit(root);
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

const temporary = mkdtempSync(join(tmpdir(), "fadeno-a0-create-command-"));
try {
  const context = { cwd: temporary, packageVersion: "0.1.0-alpha.0" } satisfies ProjectCreateCommandContext;
  for (const arguments_ of [
    [],
    ["create"],
    ["create", "my-app"],
    ["create", "--project-root"],
    ["create", "--project-root", "my-app", "extra"],
    ["create", "--unknown", "my-app"],
  ]) {
    assert.deepEqual(runProjectCreateCommand(arguments_, context), {
      exitCode: 2,
      stdout: "",
      stderr: "FADENO_CREATE_USAGE: fadeno create --project-root <path>\n",
    });
  }

  assert.equal(runProjectCreateCommand(["create", "--project-root", "Bad_Name"], context).stderr,
    "FADENO_CREATE_NAME: Project directory name must be a lowercase package name.\n");
  assert.equal(existsSync(join(temporary, "Bad_Name")), false);
  assert.equal(runProjectCreateCommand(["create", "--project-root", "missing/my-app"], context).stderr,
    "FADENO_CREATE_PARENT: Project parent must be one ordinary non-symlink directory.\n");

  const realParent = join(temporary, "real-parent");
  const linkedParent = join(temporary, "linked-parent");
  mkdirSync(realParent);
  symlinkSync(realParent, linkedParent, "dir");
  assert.equal(runProjectCreateCommand(["create", "--project-root", "linked-parent/my-app"], context).stderr,
    "FADENO_CREATE_PARENT: Project parent must be one ordinary non-symlink directory.\n");
  assert.equal(existsSync(join(realParent, "my-app")), false);

  const existing = join(temporary, "existing-app");
  mkdirSync(existing);
  writeFileSync(join(existing, "canary.txt"), "owned by user\n");
  assert.equal(runProjectCreateCommand(["create", "--project-root", "existing-app"], context).stderr,
    "FADENO_CREATE_TARGET_EXISTS: Project target must not already exist.\n");
  assert.equal(readFileSync(join(existing, "canary.txt"), "utf8"), "owned by user\n");

  const target = join(temporary, "my-fadeno-app");
  const success = runProjectCreateCommand(["create", "--project-root", "my-fadeno-app"], context);
  assert.deepEqual(success, {
    exitCode: 0,
    stdout: `Created Fadeno project at ${target}.\nNext: cd ${target} && pnpm install && pnpm check\n`,
    stderr: "",
  });
  const expected = createProjectTemplate("my-fadeno-app", "0.1.0-alpha.0");
  assert.deepEqual(treeIdentity(target).map(({ path }) => path), expected.map(({ path }) => path));
  for (const file of expected) {
    assert.equal(readFileSync(join(target, file.path), "utf8"), file.contents);
    assert.equal(lstatSync(join(target, file.path)).mode & 0o777, 0o644);
  }
  assert.equal(existsSync(join(target, ".fadeno")), false);
  assert.equal(existsSync(join(target, "dist")), false);
  assert.equal(existsSync(join(target, "node_modules")), false);
  const acceptedIdentity = treeIdentity(target);
  assert.equal(runProjectCreateCommand(["create", "--project-root", "my-fadeno-app"], context).stderr,
    "FADENO_CREATE_TARGET_EXISTS: Project target must not already exist.\n");
  assert.deepEqual(treeIdentity(target), acceptedIdentity);

  rmSync(target, { recursive: true });
  const failed = runProjectCreateCommand(["create", "--project-root", "my-fadeno-app"], {
    ...context,
    beforeWrite: (_path, index) => {
      if (index === 2) throw new Error("controlled write failure");
    },
  });
  assert.deepEqual(failed, {
    exitCode: 1,
    stdout: "",
    stderr: "FADENO_CREATE_FILESYSTEM: Project creation failed and no target was accepted.\n",
  });
  assert.equal(existsSync(target), false);

  assert.equal(runProjectCreateCommand(["create", "--project-root", "my-fadeno-app"], context).exitCode, 0);
  assert.deepEqual(treeIdentity(target), acceptedIdentity);
  assert.deepEqual(JSON.parse(readFileSync(join(target, "package.json"), "utf8")), {
    name: "my-fadeno-app",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@11.7.0",
    scripts: {
      check: "fadeno check --project-root .",
      build: "fadeno build --project-root .",
      dev: "fadeno dev --project-root . --port 4173",
      start: "node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js",
    },
    dependencies: { "@fadeno/framework": "0.1.0-alpha.0" },
    devDependencies: { "@types/node": "22.20.1", typescript: "7.0.2" },
  });
  console.log(`A0 create command passed (${expected.length} byte-stable files, usage/refusal/rollback/retry)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
