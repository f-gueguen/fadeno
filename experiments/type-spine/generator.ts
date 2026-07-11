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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { TYPE_SPINE_CANDIDATE_ABI } from "./contract.ts";

export type TypeSpineScalar = "boolean" | "number" | "string";
export type TypeSpineEntry = Readonly<{ key: string; type: TypeSpineScalar }>;
export type TypeSpineInput = Readonly<{
  schemaVersion: 1;
  visibility: "private-harness-control";
  routes: readonly Readonly<{ id: string; parameters: readonly TypeSpineEntry[] }>[];
  forms: readonly Readonly<{ id: string; fields: readonly TypeSpineEntry[] }>[];
  context: readonly TypeSpineEntry[];
}>;

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
const safeId = /^[a-z][a-z0-9-]*$/u;
const safeKey = /^[A-Za-z][A-Za-z0-9]*$/u;
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
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail("INPUT_SHAPE");
}

function assertText(value: unknown, pattern: RegExp, code: string): asserts value is string {
  if (
    typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES ||
    !pattern.test(value) || [...value].some((character) => character.codePointAt(0)! < 0x20)
  ) fail(code);
}

function validateEntries(value: unknown, label: string): readonly TypeSpineEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) fail("INPUT_BOUNDS");
  const entries = value.map((candidate) => {
    assertPlainRecord(candidate);
    assertExactKeys(candidate, ["key", "type"]);
    assertText(candidate.key, safeKey, `${label}_KEY`);
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
    assertText(candidate.id, safeId, "ROUTE_ID");
    return { id: candidate.id, parameters: validateEntries(candidate.parameters, "ROUTE_PARAMETER") };
  }).sort((left, right) => compareText(left.id, right.id));
  const forms = value.forms.map((candidate) => {
    assertPlainRecord(candidate);
    assertExactKeys(candidate, ["id", "fields"]);
    assertText(candidate.id, safeId, "FORM_ID");
    return { id: candidate.id, fields: validateEntries(candidate.fields, "FORM_FIELD") };
  }).sort((left, right) => compareText(left.id, right.id));
  const ids = [...routes.map(({ id }) => id), ...forms.map(({ id }) => id)];
  if (new Set(ids).size !== ids.length) fail("SEMANTIC_ID_DUPLICATE");

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

export function renderTypeSpineCandidate(input: TypeSpineInput): string {
  const normalized = normalizeTypeSpineInput(input);
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

function inventory(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("OUTPUT_SYMLINK");
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) found.push(relative(root, absolute).split(sep).join("/"));
      else fail("OUTPUT_ENTRY");
    }
  };
  visit(root);
  return found.sort(compareText);
}

function validateOwnedRoot(root: string): void {
  const entries = inventory(root);
  if (entries.length === 0) return;
  if (JSON.stringify(entries) !== JSON.stringify([OWNER_FILE, TYPE_SPINE_CANDIDATE_ABI].sort(compareText))) {
    fail("OUTPUT_UNOWNED");
  }
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

export function generateTypeSpine(input: TypeSpineInput, outputRoot: string): TypeSpineGeneration {
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

  const candidate = renderTypeSpineCandidate(normalized);
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
  try {
    mkdirSync(join(stagedRoot, dirname(TYPE_SPINE_CANDIDATE_ABI)), { recursive: true });
    writeFileSync(join(stagedRoot, TYPE_SPINE_CANDIDATE_ABI), candidate, { encoding: "utf8", flag: "wx" });
    writeFileSync(join(stagedRoot, OWNER_FILE), owner, { encoding: "utf8", flag: "wx" });
    validateOwnedRoot(stagedRoot);
    const hadRoot = existsSync(root);
    if (hadRoot) renameSync(root, backup);
    try {
      renameSync(stagedRoot, root);
    } catch (error: unknown) {
      if (hadRoot && existsSync(backup) && !existsSync(root)) renameSync(backup, root);
      throw error;
    }
    return { files: [TYPE_SPINE_CANDIDATE_ABI], replacements: 1 };
  } finally {
    rmSync(transaction, { recursive: true, force: true });
  }
}
