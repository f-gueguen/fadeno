import type {
  ActionDeclaration,
  ActionError,
  ActionField,
  ActionFieldToken,
  ActionInput,
  ActionOptions,
  ActionUpload,
  ResourceDeclaration,
  ResourceInput,
} from "../index.ts";

const encoder = new TextEncoder();
const maximumFieldBytes = 64 * 1_024;
const maximumFileBytes = 5 * 1_024 * 1_024;
const maximumParts = 128;
const maximumFieldNameBytes = 128;
const maximumFailureTextBytes = 1_024;
const maximumFailureBytes = 16 * 1_024;
const maximumFormErrors = 16;
const maximumActions = 4_096;

export type ActionFieldState = Readonly<
  | { kind: "text"; required: boolean; maximumBytes: number }
  | { kind: "integer"; required: boolean; minimum?: number; maximum?: number }
  | { kind: "checkbox" }
  | { kind: "file"; required: boolean; maximumBytes: number; acceptedTypes: readonly string[] }
>;

export type ActionState = Readonly<{
  id: string;
  declaration: ActionDeclaration<Record<string, unknown>>;
  descriptors: Readonly<Record<string, ActionFieldState>>;
  fields: Readonly<Record<string, ActionFieldToken<unknown>>>;
  generatedNames: Readonly<Record<string, string>>;
  logicalNames: ReadonlyMap<string, string>;
  authorize: (context: unknown) => unknown;
  run: (context: unknown) => unknown;
  keeps: readonly ResourceDeclaration<ResourceInput, unknown>[];
}>;

export type ActionErrorState = Readonly<{
  code: string;
  changed: boolean;
  fieldErrors: Readonly<Record<string, string>>;
  formErrors: readonly string[];
}>;

const descriptors = new WeakMap<object, ActionFieldState>();
const tokens = new WeakMap<object, Readonly<{ action: ActionDeclaration<Record<string, unknown>>; logicalName: string }>>();
const actions = new WeakMap<object, ActionState>();
const actionsById = new Map<string, ActionState>();
const expectedErrors = new WeakMap<object, ActionErrorState>();

function fail(code: string): never { throw new TypeError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function own(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("FADENO_ACTION_DECLARATION");
  return descriptor.value;
}
function exactKeys(value: Record<string, unknown>, accepted: readonly string[]): boolean {
  return Object.keys(value).every((name) => accepted.includes(name));
}
function boundedPositive(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail("FADENO_ACTION_DECLARATION");
  }
  return value as number;
}
function randomIdentity(bytes: number): string {
  const value = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function field<Value>(state: ActionFieldState): ActionField<Value> {
  const value = Object.freeze(Object.create(null) as object) as ActionField<Value>;
  descriptors.set(value, state);
  return value;
}

export function createTextField(options: Readonly<{ required?: boolean; maximumBytes?: number }> = {}): ActionField<string | null> {
  if (!plain(options) || !exactKeys(options, ["required", "maximumBytes"])) fail("FADENO_ACTION_DECLARATION");
  const required = options.required ?? true;
  if (typeof required !== "boolean") fail("FADENO_ACTION_DECLARATION");
  const state = Object.freeze({
    kind: "text" as const,
    required,
    maximumBytes: boundedPositive(options.maximumBytes ?? maximumFieldBytes, maximumFieldBytes),
  });
  return field<string | null>(state);
}

export function createIntegerField(options: Readonly<{ required?: boolean; minimum?: number; maximum?: number }> = {}): ActionField<number | null> {
  if (!plain(options) || !exactKeys(options, ["required", "minimum", "maximum"])) fail("FADENO_ACTION_DECLARATION");
  const required = options.required ?? true;
  const { minimum, maximum } = options;
  if (
    typeof required !== "boolean" ||
    (minimum !== undefined && !Number.isSafeInteger(minimum)) ||
    (maximum !== undefined && !Number.isSafeInteger(maximum)) ||
    (minimum !== undefined && maximum !== undefined && minimum > maximum)
  ) fail("FADENO_ACTION_DECLARATION");
  return field<number | null>(Object.freeze({
    kind: "integer" as const,
    required,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  }));
}

export function createCheckboxField(): ActionField<boolean> {
  return field<boolean>(Object.freeze({ kind: "checkbox" as const }));
}

export function createFileField(options: Readonly<{
  required?: boolean;
  maximumBytes?: number;
  acceptedTypes?: readonly string[];
}> = {}): ActionField<ActionUpload | null> {
  if (!plain(options) || !exactKeys(options, ["required", "maximumBytes", "acceptedTypes"])) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const required = options.required ?? true;
  const acceptedTypes = options.acceptedTypes ?? [];
  if (
    typeof required !== "boolean" || !Array.isArray(acceptedTypes) || acceptedTypes.length > 16 ||
    acceptedTypes.some((value) => typeof value !== "string" || value.length > 127 ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value))
  ) fail("FADENO_ACTION_DECLARATION");
  return field<ActionUpload | null>(Object.freeze({
    kind: "file" as const,
    required,
    maximumBytes: boundedPositive(options.maximumBytes ?? maximumFileBytes, maximumFileBytes),
    acceptedTypes: Object.freeze([...new Set(acceptedTypes)].sort(compareText)),
  }));
}

export function createActionDeclaration<Fields extends Readonly<Record<string, ActionField<unknown>>>>(
  options: ActionOptions<Fields>,
): ActionDeclaration<ActionInput<Fields>> {
  if (!plain(options) || !exactKeys(options, ["fields", "authorize", "run", "keeps"])) fail("FADENO_ACTION_DECLARATION");
  if (!plain(options.fields) || typeof options.authorize !== "function" || typeof options.run !== "function") {
    fail("FADENO_ACTION_DECLARATION");
  }
  const names = Object.keys(options.fields).sort(compareText);
  if (names.length === 0 || names.length > maximumParts || actionsById.size >= maximumActions) {
    fail("FADENO_ACTION_DECLARATION");
  }
  const normalizedDescriptors: Record<string, ActionFieldState> = Object.create(null) as Record<string, ActionFieldState>;
  const fieldTokens: Record<string, ActionFieldToken<unknown>> = Object.create(null) as Record<string, ActionFieldToken<unknown>>;
  const generatedNames: Record<string, string> = Object.create(null) as Record<string, string>;
  const logicalNames = new Map<string, string>();
  const declaration = Object.create(null) as ActionDeclaration<Record<string, unknown>>;
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name) || encoder.encode(name).byteLength > maximumFieldNameBytes) {
      fail("FADENO_ACTION_DECLARATION");
    }
    const descriptor = own(options.fields, name);
    const state = descriptor && typeof descriptor === "object" ? descriptors.get(descriptor) : undefined;
    if (!state) fail("FADENO_ACTION_DECLARATION");
    const token = Object.freeze(Object.create(null) as object) as ActionFieldToken<unknown>;
    const generatedName = `f_${randomIdentity(12)}`;
    normalizedDescriptors[name] = state;
    fieldTokens[name] = token;
    generatedNames[name] = generatedName;
    logicalNames.set(generatedName, name);
    tokens.set(token, Object.freeze({ action: declaration, logicalName: name }));
  }
  const keepsInput = options.keeps ?? [];
  if (!Array.isArray(keepsInput) || keepsInput.length > maximumParts) fail("FADENO_ACTION_DECLARATION");
  const keeps = Object.freeze([...keepsInput]) as readonly ResourceDeclaration<ResourceInput, unknown>[];
  const id = randomIdentity(24);
  const exposed = Object.freeze(Object.defineProperty(declaration, "fields", {
    value: Object.freeze(fieldTokens),
    enumerable: true,
  })) as ActionDeclaration<Record<string, unknown>>;
  const state: ActionState = Object.freeze({
    id,
    declaration: exposed,
    descriptors: Object.freeze(normalizedDescriptors),
    fields: Object.freeze(fieldTokens),
    generatedNames: Object.freeze(generatedNames),
    logicalNames,
    authorize: options.authorize as (context: unknown) => unknown,
    run: options.run as (context: unknown) => unknown,
    keeps,
  });
  actions.set(exposed, state);
  actionsById.set(id, state);
  return exposed as ActionDeclaration<ActionInput<Fields>>;
}

export function createActionError(input: Readonly<{
  code: string;
  changed?: boolean;
  fieldErrors?: Readonly<Record<string, string>>;
  formErrors?: readonly string[];
}>): ActionError {
  if (
    !plain(input) || !exactKeys(input, ["code", "changed", "fieldErrors", "formErrors"]) ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.code) ||
    (input.changed !== undefined && typeof input.changed !== "boolean")
  ) fail("FADENO_ACTION_EXPECTED_FAILURE");
  const fieldErrors = input.fieldErrors ?? {};
  const formErrors = input.formErrors ?? [];
  if (!plain(fieldErrors) || !Array.isArray(formErrors) || formErrors.length > maximumFormErrors) {
    fail("FADENO_ACTION_EXPECTED_FAILURE");
  }
  let bytes = 0;
  const normalizedFields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of Object.keys(fieldErrors).sort(compareText)) {
    const value = own(fieldErrors, name);
    const next = encoder.encode(name).byteLength + (typeof value === "string" ? encoder.encode(value).byteLength : maximumFailureBytes + 1);
    if (
      !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name) || typeof value !== "string" ||
      encoder.encode(value).byteLength > maximumFailureTextBytes || next > maximumFailureBytes - bytes
    ) fail("FADENO_ACTION_EXPECTED_FAILURE");
    bytes += next;
    normalizedFields[name] = value;
  }
  const normalizedForms: string[] = [];
  for (let index = 0; index < formErrors.length; index += 1) {
    const value = own(formErrors, String(index));
    if (typeof value !== "string" || encoder.encode(value).byteLength > maximumFailureTextBytes) {
      fail("FADENO_ACTION_EXPECTED_FAILURE");
    }
    bytes += encoder.encode(value).byteLength;
    if (bytes > maximumFailureBytes) fail("FADENO_ACTION_EXPECTED_FAILURE");
    normalizedForms.push(value);
  }
  const error = new Error(input.code) as ActionError;
  expectedErrors.set(error, Object.freeze({
    code: input.code,
    changed: input.changed ?? false,
    fieldErrors: Object.freeze(normalizedFields),
    formErrors: Object.freeze(normalizedForms),
  }));
  return error;
}

export function readActionState(value: unknown): ActionState | undefined {
  return value !== null && typeof value === "object" ? actions.get(value) : undefined;
}

export function readActionStateById(id: string): ActionState | undefined { return actionsById.get(id); }

export function readActionFieldToken(value: unknown): Readonly<{
  action: ActionDeclaration<Record<string, unknown>>;
  logicalName: string;
}> | undefined {
  return value !== null && typeof value === "object" ? tokens.get(value) : undefined;
}

export function readActionError(value: unknown): ActionErrorState | undefined {
  return value !== null && typeof value === "object" ? expectedErrors.get(value) : undefined;
}

export function registeredActionStates(): readonly ActionState[] {
  return Object.freeze([...actionsById.values()]);
}
