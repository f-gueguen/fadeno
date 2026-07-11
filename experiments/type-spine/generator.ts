import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  TYPE_SPINE_CANDIDATE_ABI,
  type TypeSpineEntry,
  type TypeSpineInput,
  type TypeSpineScalar,
} from "./contract.ts";

export type TypeSpineGeneration = Readonly<{
  files: readonly string[];
  replacements: number;
}>;

const OWNER_FILE = ".fadeno-type-spine-owner.json";
const OWNER = "fadeno-private-type-spine-harness";
const GENERATOR_VERSION = 1;
const MAX_ITEMS = 2_000;
const MAX_ENTRIES = 256;
const MAX_TEXT_BYTES = 128;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const scalarTypes = new Set<TypeSpineScalar>(["boolean", "number", "string"]);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string): never {
  throw new Error(`FADENO_TYPE_SPINE_${code}`);
}

function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("INPUT_SHAPE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INPUT_SHAPE");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value);
  const wanted = new Set(expected);
  if (actual.length !== wanted.size || actual.some((key) => !wanted.has(key))) fail("INPUT_SHAPE");
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function assertOpaqueText(value: unknown, code: string): asserts value is string {
  if (
    typeof value !== "string" || Buffer.byteLength(value, "utf8") === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES || !isWellFormedUnicode(value) ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return point < 0x20 || (point >= 0x7f && point <= 0x9f);
    })
  ) fail(code);
}

function validateEntries(value: unknown, label: string): readonly TypeSpineEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) fail("INPUT_BOUNDS");
  const entries = value.map((candidate) => {
    assertPlainRecord(candidate);
    assertExactKeys(candidate, ["key", "type"]);
    assertOpaqueText(candidate.key, `${label}_KEY`);
    if (forbiddenKeys.has(candidate.key)) fail(`${label}_KEY`);
    if (typeof candidate.type !== "string" || !scalarTypes.has(candidate.type as TypeSpineScalar)) {
      fail(`${label}_TYPE`);
    }
    return { key: candidate.key, type: candidate.type as TypeSpineScalar };
  });
  if (new Set(entries.map(({ key }) => key)).size !== entries.length) fail(`${label}_DUPLICATE`);
  return entries.sort((left, right) => compareText(left.key, right.key));
}

export function normalizeTypeSpineInput(value: unknown): TypeSpineInput {
  assertPlainRecord(value);
  assertExactKeys(value, ["schemaVersion", "visibility", "routes", "forms", "context"]);
  if (value.schemaVersion !== 1 || value.visibility !== "private-harness-control") {
    fail("INPUT_VERSION");
  }
  if (!Array.isArray(value.routes) || !Array.isArray(value.forms)) fail("INPUT_SHAPE");
  if (value.routes.length > MAX_ITEMS || value.forms.length > MAX_ITEMS) fail("INPUT_BOUNDS");

  const routes = value.routes.map((candidate) => {
    assertPlainRecord(candidate);
    assertExactKeys(candidate, ["id", "parameters"]);
    assertOpaqueText(candidate.id, "ROUTE_ID");
    return { id: candidate.id, parameters: validateEntries(candidate.parameters, "ROUTE_PARAMETER") };
  }).sort((left, right) => compareText(left.id, right.id));
  const forms = value.forms.map((candidate) => {
    assertPlainRecord(candidate);
    assertExactKeys(candidate, ["id", "fields"]);
    assertOpaqueText(candidate.id, "FORM_ID");
    return { id: candidate.id, fields: validateEntries(candidate.fields, "FORM_FIELD") };
  }).sort((left, right) => compareText(left.id, right.id));
  if (new Set(routes.map(({ id }) => id)).size !== routes.length) fail("ROUTE_ID_DUPLICATE");
  if (new Set(forms.map(({ id }) => id)).size !== forms.length) fail("FORM_ID_DUPLICATE");

  return Object.freeze({
    schemaVersion: 1,
    visibility: "private-harness-control",
    routes,
    forms,
    context: validateEntries(value.context, "CONTEXT"),
  });
}

function renderRecord(entries: readonly TypeSpineEntry[]): string {
  if (entries.length === 0) return "Record<string, never>";
  return `{ ${entries.map(({ key, type }) => `readonly ${JSON.stringify(key)}: ${type}`).join("; ")} }`;
}

function renderNormalizedCandidate(normalized: TypeSpineInput): string {
  const routeMembers = normalized.routes.map(
    ({ id, parameters }) => `  readonly ${JSON.stringify(id)}: ${renderRecord(parameters)};`,
  );
  const formMembers = normalized.forms.map(
    ({ id, fields }) => `  readonly ${JSON.stringify(id)}: ${renderRecord(fields)};`,
  );
  const contextMembers = normalized.context.map(
    ({ key, type }) => `  readonly ${JSON.stringify(key)}: ${type};`,
  );
  return [
    "// Generated by the private K0 type-spine candidate (version 1).",
    "// This experiment artifact is not a public API and must not be edited.",
    "export interface RouteParameterMap {",
    ...routeMembers,
    "}",
    "export type RouteId = keyof RouteParameterMap;",
    "export type RouteParameters<Id extends RouteId> = RouteParameterMap[Id];",
    "export type LinkInput<Id extends RouteId> = {",
    "  readonly route: Id;",
    "  readonly parameters: RouteParameters<Id>;",
    "};",
    "export interface ActionFieldMap {",
    ...formMembers,
    "}",
    "export type ActionId = keyof ActionFieldMap;",
    "export type ActionFields<Id extends ActionId> = ActionFieldMap[Id];",
    "export interface RequestContext {",
    ...contextMembers,
    "}",
    "",
  ].join("\n");
}

export function renderTypeSpineCandidate(input: TypeSpineInput): string {
  return renderNormalizedCandidate(normalizeTypeSpineInput(input));
}

function stableOwner(candidate: string): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    owner: OWNER,
    generatorVersion: GENERATOR_VERSION,
    files: [{ path: TYPE_SPINE_CANDIDATE_ABI, bytes: Buffer.byteLength(candidate), sha256: digest(candidate) }],
  })}\n`;
}

function assertNoSymlinkComponents(path: string): void {
  let cursor = resolve(path);
  const components: string[] = [];
  while (true) {
    components.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const component of components.reverse()) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) fail("OUTPUT_SYMLINK");
  }
}

function validateOwnedRoot(root: string): void {
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length === 0) return;
  const ownerEntry = entries.find(({ name }) => name === OWNER_FILE);
  const generatedEntry = entries.find(({ name }) => name === dirname(TYPE_SPINE_CANDIDATE_ABI));
  if (
    entries.length !== 2 || ownerEntry?.isFile() !== true || ownerEntry.isSymbolicLink() ||
    generatedEntry?.isDirectory() !== true || generatedEntry.isSymbolicLink()
  ) {
    fail("OUTPUT_UNOWNED");
  }
  const generated = readdirSync(join(root, dirname(TYPE_SPINE_CANDIDATE_ABI)), { withFileTypes: true });
  if (
    generated.length !== 1 || generated[0]?.name !== basename(TYPE_SPINE_CANDIDATE_ABI) ||
    generated[0]?.isFile() !== true || generated[0].isSymbolicLink()
  ) fail("OUTPUT_UNOWNED");
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(join(root, OWNER_FILE), "utf8"));
  } catch {
    fail("OUTPUT_OWNER");
  }
  assertPlainRecord(marker);
  assertExactKeys(marker, ["schemaVersion", "owner", "generatorVersion", "files"]);
  if (
    marker.schemaVersion !== 1 || marker.owner !== OWNER || marker.generatorVersion !== GENERATOR_VERSION ||
    !Array.isArray(marker.files) || marker.files.length !== 1
  ) fail("OUTPUT_OWNER");
  const file = marker.files[0];
  assertPlainRecord(file);
  assertExactKeys(file, ["path", "bytes", "sha256"]);
  if (
    file.path !== TYPE_SPINE_CANDIDATE_ABI || typeof file.bytes !== "number" ||
    !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
    typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256)
  ) fail("OUTPUT_OWNER");
  const candidate = readFileSync(join(root, TYPE_SPINE_CANDIDATE_ABI), "utf8");
  if (Buffer.byteLength(candidate) !== file.bytes || digest(candidate) !== file.sha256) {
    fail("OUTPUT_OWNER");
  }
}

type HarnessFault = "publish" | "publish-and-obstruct-restore";

function generateTypeSpineInternal(
  input: TypeSpineInput,
  outputRoot: string,
  fault?: HarnessFault,
): TypeSpineGeneration {
  const normalized = normalizeTypeSpineInput(input);
  if (!isAbsolute(outputRoot)) fail("OUTPUT_ABSOLUTE");
  const root = resolve(outputRoot);
  const parent = dirname(root);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) fail("OUTPUT_PARENT");
  assertNoSymlinkComponents(parent);
  if (existsSync(root)) {
    if (!lstatSync(root).isDirectory()) fail("OUTPUT_ROOT");
    assertNoSymlinkComponents(root);
    validateOwnedRoot(root);
  }

  const candidate = renderNormalizedCandidate(normalized);
  const owner = stableOwner(candidate);
  if (
    existsSync(join(root, TYPE_SPINE_CANDIDATE_ABI)) &&
    existsSync(join(root, OWNER_FILE)) &&
    readFileSync(join(root, TYPE_SPINE_CANDIDATE_ABI), "utf8") === candidate &&
    readFileSync(join(root, OWNER_FILE), "utf8") === owner
  ) return { files: [TYPE_SPINE_CANDIDATE_ABI], replacements: 0 };

  const transaction = mkdtempSync(join(parent, `.${basename(root)}-stage-`));
  const stagedRoot = join(transaction, "root");
  const backup = join(transaction, "previous");
  let preserveTransaction = false;
  try {
    mkdirSync(join(stagedRoot, dirname(TYPE_SPINE_CANDIDATE_ABI)), { recursive: true });
    writeFileSync(join(stagedRoot, TYPE_SPINE_CANDIDATE_ABI), candidate, { encoding: "utf8", flag: "wx" });
    writeFileSync(join(stagedRoot, OWNER_FILE), owner, { encoding: "utf8", flag: "wx" });
    validateOwnedRoot(stagedRoot);
    const hadRoot = existsSync(root);
    if (hadRoot) renameSync(root, backup);
    try {
      if (fault !== undefined) throw new Error("FADENO_TYPE_SPINE_INJECTED_PUBLISH_FAILURE");
      renameSync(stagedRoot, root);
    } catch (error: unknown) {
      if (hadRoot && existsSync(backup)) {
        if (fault === "publish-and-obstruct-restore") mkdirSync(root);
        if (!existsSync(root)) {
          try {
            renameSync(backup, root);
          } catch {
            // The preserved backup below is the recovery contract.
          }
        }
        if (existsSync(backup)) {
          preserveTransaction = true;
          throw new Error(`FADENO_TYPE_SPINE_RECOVERY_REQUIRED:${backup}`);
        }
      }
      throw error;
    }
    return { files: [TYPE_SPINE_CANDIDATE_ABI], replacements: 1 };
  } finally {
    if (!preserveTransaction) rmSync(transaction, { recursive: true, force: true });
  }
}

export function generateTypeSpine(input: TypeSpineInput, outputRoot: string): TypeSpineGeneration {
  return generateTypeSpineInternal(input, outputRoot);
}

export function generateTypeSpineWithFaultForHarness(
  input: TypeSpineInput,
  outputRoot: string,
  fault: HarnessFault,
): TypeSpineGeneration {
  return generateTypeSpineInternal(input, outputRoot, fault);
}
