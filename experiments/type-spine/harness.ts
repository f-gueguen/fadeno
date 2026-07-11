import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  TYPE_SPINE_INPUT,
  TYPE_SPINE_INVALID_FIXTURES,
  TYPE_SPINE_VALID_FIXTURES,
} from "./contract.ts";
import {
  generateTypeSpine,
  type TypeSpineInput,
  type TypeSpineGeneration,
} from "./generator.ts";

const root = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(root, "fixtures");
const candidatePath = "generated/candidate-types.ts";
const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");

type TypeScriptRun = Readonly<{ status: number; output: string }>;

function fail(message: string): never {
  throw new Error(`FADENO_TYPE_SPINE_HARNESS: ${message}`);
}

function runTypeScript(files: readonly string[]): TypeScriptRun {
  const child = spawnSync(process.execPath, [
    tsc,
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "ESNext",
    "--moduleResolution", "Bundler",
    "--allowImportingTsExtensions",
    "--skipLibCheck", "false",
    "--pretty", "false",
    ...files,
  ], { encoding: "utf8" });
  if (child.error) throw child.error;
  return { status: child.status ?? 1, output: `${child.stdout}${child.stderr}` };
}

function copyFixture(destination: string, fixture: string): string {
  const target = join(destination, "fixtures", fixture);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(fixturesRoot, fixture), target, { errorOnExist: true, force: false });
  return target;
}

function makeConsumerRoot(parent: string, name: string, candidate?: string): string {
  const destination = join(parent, name);
  mkdirSync(destination, { recursive: false });
  if (candidate !== undefined) {
    mkdirSync(join(destination, "generated"));
    writeFileSync(join(destination, candidatePath), candidate, { encoding: "utf8", flag: "wx" });
  }
  return destination;
}

function verifyStockTypeScript(candidate: string, workspace: string): void {
  const validRoot = makeConsumerRoot(workspace, "valid-consumers", candidate);
  const validFiles = TYPE_SPINE_VALID_FIXTURES.map((fixture) => copyFixture(validRoot, fixture));
  const valid = runTypeScript(validFiles);
  if (valid.status !== 0 || valid.output !== "") fail(`valid consumers failed\n${valid.output}`);

  for (const [fixture, expected] of Object.entries(TYPE_SPINE_INVALID_FIXTURES)) {
    const fixtureRoot = makeConsumerRoot(workspace, `invalid-${fixture.split("/").at(-1)}`, candidate);
    const source = copyFixture(fixtureRoot, fixture);
    const sourceLine = readFileSync(source, "utf8").split("\n")[expected.line - 1] ?? "";
    const column = sourceLine.indexOf(expected.anchor) + 1;
    if (column === 0) fail(`${fixture} contract anchor is absent from line ${expected.line}`);
    const invalid = runTypeScript([source]);
    const escapedFixture = fixture.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const diagnostics = invalid.output.trim().split("\n").filter(Boolean);
    const exact = new RegExp(
      `^(?!.*(?:generated|harness))[^\\n]*fixtures/${escapedFixture}\\(${expected.line},${column}\\): error TS${expected.code}:`,
    );
    if (invalid.status === 0 || diagnostics.length !== 1 || !exact.test(diagnostics[0] ?? "")) {
      fail(`${fixture} diagnostic differed\n${invalid.output}`);
    }
  }

  const missingRoot = makeConsumerRoot(workspace, "missing-output");
  const missingFiles = TYPE_SPINE_VALID_FIXTURES.map((fixture) => copyFixture(missingRoot, fixture));
  const missing = runTypeScript(missingFiles);
  if (missing.status === 0 || !/fixtures\/valid\/.*error TS2307:/u.test(missing.output)) {
    fail(`missing-output control did not fail in consumer source\n${missing.output}`);
  }

  const permissive = [
    "export type RouteParameters<Id extends string> = Record<string, unknown>;",
    "export type LinkInput<Id extends string> = { readonly route: string; readonly parameters: Record<string, unknown> };",
    "export type ActionFields<Id extends string> = Record<string, unknown>;",
    "export type RequestContext = Record<string, unknown>;",
    "",
  ].join("\n");
  const permissiveRoot = makeConsumerRoot(workspace, "permissive-output", permissive);
  const permissiveFiles = Object.keys(TYPE_SPINE_INVALID_FIXTURES).map(
    (fixture) => copyFixture(permissiveRoot, fixture),
  );
  const permissiveRun = runTypeScript(permissiveFiles);
  if (permissiveRun.status !== 0 || permissiveRun.output !== "") {
    fail(`permissive-output control still rejected consumers\n${permissiveRun.output}`);
  }
}

function snapshot(path: string): string {
  if (!existsSync(path)) return "absent";
  if (lstatSync(path).isSymbolicLink()) return `link:${readFileSync(path, "utf8")}`;
  if (!lstatSync(path).isDirectory()) return `file:${readFileSync(path).toString("hex")}`;
  const records: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const absolute = join(directory, entry.name);
      const name = relative(path, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) records.push(`${name}:symlink`);
      else if (entry.isDirectory()) {
        records.push(`${name}:directory`);
        visit(absolute);
      } else records.push(`${name}:file:${readFileSync(absolute).toString("hex")}`);
    }
  };
  visit(path);
  return records.join("\n");
}

function expectRefusal(action: () => unknown, watched: string, label: string): void {
  const before = snapshot(watched);
  try {
    action();
    fail(`${label} was accepted`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.endsWith("was accepted")) throw error;
  }
  if (snapshot(watched) !== before) fail(`${label} mutated output before refusal`);
}

function reverseInput(input: TypeSpineInput): TypeSpineInput {
  return {
    ...input,
    routes: [...input.routes].reverse().map((route) => ({
      ...route,
      parameters: [...route.parameters].reverse(),
    })),
    forms: [...input.forms].reverse().map((form) => ({ ...form, fields: [...form.fields].reverse() })),
    context: [...input.context].reverse(),
  };
}

function alternateInput(input: TypeSpineInput): TypeSpineInput {
  return {
    ...input,
    routes: input.routes.filter(({ id }) => id !== "account"),
    forms: input.forms.map((form) => ({
      ...form,
      fields: form.fields.filter(({ key }) => key !== "notificationCount"),
    })),
    context: input.context.filter(({ key }) => key !== "csrfToken"),
  };
}

function verifyRefusals(workspace: string): void {
  const unsafeParent = join(workspace, "unsafe-inputs");
  mkdirSync(unsafeParent);
  const hostileInputs: readonly unknown[] = [
    { ...TYPE_SPINE_INPUT, routes: [...TYPE_SPINE_INPUT.routes, TYPE_SPINE_INPUT.routes[0]] },
    { ...TYPE_SPINE_INPUT, routes: [{ id: "../escape", parameters: [] }] },
    { ...TYPE_SPINE_INPUT, routes: [{ id: "route", parameters: [{ key: "__proto__", type: "string" }] }] },
    { ...TYPE_SPINE_INPUT, context: [{ key: "line\nbreak", type: "string" }] },
    { ...TYPE_SPINE_INPUT, forms: [{ id: 'bad";type Injected=never', fields: [] }] },
  ];
  hostileInputs.forEach((input, index) => expectRefusal(
    () => generateTypeSpine(input as TypeSpineInput, join(unsafeParent, `output-${index}`)),
    unsafeParent,
    `hostile input ${index}`,
  ));

  const unowned = join(workspace, "unowned");
  mkdirSync(unowned);
  writeFileSync(join(unowned, "user.txt"), "keep\n");
  expectRefusal(() => generateTypeSpine(TYPE_SPINE_INPUT, unowned), unowned, "unowned root");

  const tampered = join(workspace, "tampered");
  generateTypeSpine(TYPE_SPINE_INPUT, tampered);
  writeFileSync(join(tampered, candidatePath), "tampered\n");
  expectRefusal(() => generateTypeSpine(TYPE_SPINE_INPUT, tampered), tampered, "tampered owned root");

  const target = join(workspace, "symlink-target");
  mkdirSync(target);
  const linkedRoot = join(workspace, "linked-root");
  symlinkSync(target, linkedRoot, "dir");
  expectRefusal(() => generateTypeSpine(TYPE_SPINE_INPUT, linkedRoot), target, "root symlink");

  const linkedParent = join(workspace, "linked-parent");
  symlinkSync(target, linkedParent, "dir");
  expectRefusal(
    () => generateTypeSpine(TYPE_SPINE_INPUT, join(linkedParent, "nested")),
    target,
    "intermediate symlink",
  );

  const stale = join(workspace, "stale-symlink");
  mkdirSync(stale);
  symlinkSync(join(workspace, "outside"), join(stale, "generated"), "dir");
  expectRefusal(() => generateTypeSpine(TYPE_SPINE_INPUT, stale), stale, "stale symlink entry");
}

export function executeTypeSpineHarness(): TypeSpineGeneration {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "fadeno-type-spine-"));
  try {
    const outputA = join(workspace, "output-a");
    const first = generateTypeSpine(TYPE_SPINE_INPUT, outputA);
    if (first.replacements !== 1) fail("first generation did not publish");
    const firstBytes = snapshot(outputA);
    const candidate = readFileSync(join(outputA, candidatePath), "utf8");
    const mtime = statSync(join(outputA, candidatePath), { bigint: true }).mtimeNs;
    const noChange = generateTypeSpine(TYPE_SPINE_INPUT, outputA);
    if (
      noChange.replacements !== 0 || snapshot(outputA) !== firstBytes ||
      statSync(join(outputA, candidatePath), { bigint: true }).mtimeNs !== mtime
    ) fail("unchanged generation rewrote output");

    const outputReversed = join(workspace, "output-reversed");
    generateTypeSpine(reverseInput(TYPE_SPINE_INPUT), outputReversed);
    if (snapshot(outputReversed) !== firstBytes) fail("input ordering changed generated bytes");

    const alternate = alternateInput(TYPE_SPINE_INPUT);
    generateTypeSpine(alternate, outputA);
    const alternateBytes = readFileSync(join(outputA, candidatePath), "utf8");
    if (
      alternateBytes.includes("account") || alternateBytes.includes("notificationCount") ||
      alternateBytes.includes("csrfToken")
    ) fail("replacement retained stale semantic declarations");
    generateTypeSpine(TYPE_SPINE_INPUT, outputA);
    if (snapshot(outputA) !== firstBytes) fail("A-B-A generation did not reproduce exact output");

    verifyStockTypeScript(candidate, workspace);
    verifyRefusals(workspace);
    return first;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
