import { MORPH_PROJECTS } from "../contract.ts";
import { MORPH_QUALIFICATION_ASSETS } from "./qualification-assets.ts";

export const MORPH_QUALIFICATION_PROFILES = Object.freeze([
  Object.freeze({ id: "ci", repetitions: 20 }),
  Object.freeze({ id: "qualification", repetitions: 100 }),
] as const);

export const MORPH_QUALIFICATION_STATES = Object.freeze([
  "focused-input-selection",
  "focused-textarea-selection",
  "focused-contenteditable-caret",
  "dirty-text",
  "dirty-checkbox",
  "dirty-radio",
  "dirty-select",
  "dirty-file",
  "details-open",
  "dialog-modal",
  "dialog-nonmodal",
  "popover-open",
  "media-playing",
  "media-paused",
  "document-scroll",
  "element-scroll",
  "island-identity",
  "intentional-replacement",
] as const);

export const MORPH_QUALIFICATION_OPERATIONS = Object.freeze([
  "insert-keyed",
  "remove-keyed",
  "reorder-keyed",
  "intentional-replacement",
] as const);

export type QualificationState = (typeof MORPH_QUALIFICATION_STATES)[number];
export type StructuralOperation = Exclude<
  (typeof MORPH_QUALIFICATION_OPERATIONS)[number],
  "intentional-replacement"
>;

type QualificationCaseBase = Readonly<{
  id: string;
  targetIdentity: string;
  description: string;
}>;

export type MorphQualificationCase =
  | (QualificationCaseBase & Readonly<{
      state: Exclude<QualificationState, "intentional-replacement">;
      operation: StructuralOperation;
    }>)
  | (QualificationCaseBase & Readonly<{
      state: "intentional-replacement";
      operation: "intentional-replacement";
    }>);

export const MORPH_QUALIFICATION_CASES: readonly MorphQualificationCase[] = Object.freeze([
  Object.freeze({
    id: "focused-input-selection-insert",
    state: "focused-input-selection",
    operation: "insert-keyed",
    targetIdentity: "focused-input",
    description: "A focused input keeps object identity and its exact text selection during insertion.",
  }),
  Object.freeze({
    id: "focused-textarea-selection-remove",
    state: "focused-textarea-selection",
    operation: "remove-keyed",
    targetIdentity: "focused-textarea",
    description: "A focused textarea keeps object identity and its exact text selection during removal.",
  }),
  Object.freeze({
    id: "focused-contenteditable-caret-reorder",
    state: "focused-contenteditable-caret",
    operation: "reorder-keyed",
    targetIdentity: "focused-editor",
    description: "A focused contenteditable keeps object identity and its exact caret during reorder.",
  }),
  Object.freeze({
    id: "dirty-text-insert",
    state: "dirty-text",
    operation: "insert-keyed",
    targetIdentity: "dirty-text",
    description: "A dirty text input keeps its user value while server-owned output is inserted.",
  }),
  Object.freeze({
    id: "dirty-checkbox-remove",
    state: "dirty-checkbox",
    operation: "remove-keyed",
    targetIdentity: "dirty-checkbox",
    description: "A dirty checkbox keeps its checked state while a keyed peer is removed.",
  }),
  Object.freeze({
    id: "dirty-radio-reorder",
    state: "dirty-radio",
    operation: "reorder-keyed",
    targetIdentity: "dirty-radio-a",
    description: "A dirty radio group keeps the selected original node while keyed peers reorder.",
  }),
  Object.freeze({
    id: "dirty-select-insert",
    state: "dirty-select",
    operation: "insert-keyed",
    targetIdentity: "dirty-select",
    description: "A dirty select keeps its selected option while a keyed peer is inserted.",
  }),
  Object.freeze({
    id: "dirty-file-remove",
    state: "dirty-file",
    operation: "remove-keyed",
    targetIdentity: "dirty-file",
    description: "A selected local file and its original input survive keyed peer removal.",
  }),
  Object.freeze({
    id: "details-open-reorder",
    state: "details-open",
    operation: "reorder-keyed",
    targetIdentity: "open-details",
    description: "An open disclosure remains open on the original node during keyed reorder.",
  }),
  Object.freeze({
    id: "dialog-modal-insert",
    state: "dialog-modal",
    operation: "insert-keyed",
    targetIdentity: "modal-dialog",
    description: "An open modal dialog remains modal on the original top-layer node during insertion.",
  }),
  Object.freeze({
    id: "dialog-nonmodal-remove",
    state: "dialog-nonmodal",
    operation: "remove-keyed",
    targetIdentity: "nonmodal-dialog",
    description: "An open non-modal dialog remains open on the original node during removal.",
  }),
  Object.freeze({
    id: "popover-open-reorder",
    state: "popover-open",
    operation: "reorder-keyed",
    targetIdentity: "open-popover",
    description: "An open popover remains open on the original top-layer node during keyed reorder.",
  }),
  Object.freeze({
    id: "media-playing-insert",
    state: "media-playing",
    operation: "insert-keyed",
    targetIdentity: "playing-media",
    description: "Playing local media keeps identity, playback, and a non-reset clock during insertion.",
  }),
  Object.freeze({
    id: "media-paused-remove",
    state: "media-paused",
    operation: "remove-keyed",
    targetIdentity: "paused-media",
    description: "Paused local media keeps identity and its exact current time during removal.",
  }),
  Object.freeze({
    id: "document-scroll-reorder",
    state: "document-scroll",
    operation: "reorder-keyed",
    targetIdentity: "scroll-anchor",
    description: "Document scroll remains exact while keyed content outside the anchor reorders.",
  }),
  Object.freeze({
    id: "element-scroll-insert",
    state: "element-scroll",
    operation: "insert-keyed",
    targetIdentity: "scroll-container",
    description: "Nested element scroll remains exact while keyed content is inserted.",
  }),
  Object.freeze({
    id: "island-identity-remove",
    state: "island-identity",
    operation: "remove-keyed",
    targetIdentity: "mounted-island",
    description: "A mounted private island sentinel keeps object and lifecycle identity during removal.",
  }),
  Object.freeze({
    id: "intentional-replacement-control",
    state: "intentional-replacement",
    operation: "intentional-replacement",
    targetIdentity: "replacement-target",
    description: "A declared replacement disconnects the original node in every control repetition.",
  }),
]);

export function morphQualificationCorpusDocument() {
  return {
    schemaVersion: 1,
    experiment: "morph",
    hypothesis: "H1",
    scope: "private-structural-preservation",
    transportEvidence: "not-in-scope",
    retries: 0,
    workers: 1,
    projects: MORPH_PROJECTS,
    profiles: MORPH_QUALIFICATION_PROFILES,
    assets: MORPH_QUALIFICATION_ASSETS,
    cases: MORPH_QUALIFICATION_CASES,
  } as const;
}

export function stableMorphQualificationCorpus(): string {
  return `${JSON.stringify(morphQualificationCorpusDocument(), null, 2)}\n`;
}
