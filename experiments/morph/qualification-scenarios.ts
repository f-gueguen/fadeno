import type { PrivateMorphPatch } from "./candidate.ts";
import {
  MORPH_QUALIFICATION_CASES,
} from "./fixtures/qualification-corpus.ts";
import type {
  MorphQualificationCase,
  QualificationState,
} from "./fixtures/qualification-corpus.ts";
import {
  createQualificationTone,
} from "./fixtures/qualification-assets.ts";

export type MorphQualificationProfile = "ci" | "qualification";

export type MorphQualificationScenario = Readonly<{
  fixture: MorphQualificationCase;
  currentHtml: string;
  patch: PrivateMorphPatch;
  beforeOrder: readonly string[];
  afterOrder: readonly string[];
  insertedIdentity: string | null;
  removedIdentity: string | null;
}>;

const pagePrefix =
  '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}.peer{display:block;height:20px}.document-spacer{display:block;height:2400px}.scroll-box{display:block;width:240px;height:80px;overflow:auto}.scroll-content{display:block;height:600px}</style>';
const peerA = '<output id="peer-a" class="peer">peer-a</output>';
const peerB = '<output id="peer-b" class="peer">peer-b</output>';
const insertedPeer = '<output id="inserted-peer" class="peer">inserted</output>';
const removedPeer = '<output id="removed-peer" class="peer">removed</output>';
const mediaSource = `data:audio/wav;base64,${createQualificationTone().toString("base64")}`;

function targetRoots(state: QualificationState): readonly string[] {
  switch (state) {
    case "focused-input-selection":
      return ['<input id="focused-input" aria-label="Focused input" value="server-default">'];
    case "focused-textarea-selection":
      return ['<textarea id="focused-textarea" aria-label="Focused textarea">server-default</textarea>'];
    case "focused-contenteditable-caret":
      return ['<div id="focused-editor" contenteditable="true">editable-value</div>'];
    case "dirty-text":
      return ['<input id="dirty-text" aria-label="Dirty text" value="server-default">'];
    case "dirty-checkbox":
      return ['<input id="dirty-checkbox" type="checkbox" aria-label="Dirty checkbox">'];
    case "dirty-radio":
      return [
        '<input id="dirty-radio-a" type="radio" name="qualification-radio" aria-label="Radio A">',
        '<input id="dirty-radio-b" type="radio" name="qualification-radio" aria-label="Radio B">',
      ];
    case "dirty-select":
      return [
        '<select id="dirty-select" aria-label="Dirty select"><option id="select-a" value="a" selected>A</option><option id="select-b" value="b">B</option></select>',
      ];
    case "dirty-file":
      return ['<input id="dirty-file" type="file" aria-label="Dirty file">'];
    case "details-open":
      return [
        '<details id="open-details"><summary id="details-summary">Summary</summary><output id="details-content">Content</output></details>',
      ];
    case "dialog-modal":
      return ['<dialog id="modal-dialog">Modal content</dialog>'];
    case "dialog-nonmodal":
      return ['<dialog id="nonmodal-dialog">Non-modal content</dialog>'];
    case "popover-open":
      return ['<div id="open-popover" popover="manual">Popover content</div>'];
    case "media-playing":
      return [`<audio id="playing-media" preload="auto" src="${mediaSource}"></audio>`];
    case "media-paused":
      return [`<audio id="paused-media" preload="auto" src="${mediaSource}"></audio>`];
    case "document-scroll":
      return ['<section id="scroll-anchor" class="document-spacer">Document spacer</section>'];
    case "element-scroll":
      return [
        '<div id="scroll-container" class="scroll-box"><section id="scroll-content" class="scroll-content">Nested spacer</section></div>',
      ];
    case "island-identity":
      return ['<fadeno-island id="mounted-island">client-owned</fadeno-island>'];
    case "intentional-replacement":
      return ['<output id="replacement-target">before</output>'];
  }
}

function rootIdentities(roots: readonly string[]): string[] {
  return roots.map((root) => {
    const identity = /\bid="([^"]+)"/u.exec(root)?.[1];
    if (!identity) throw new Error(`FADENO_MORPH_SCENARIO_IDENTITY: ${root}`);
    return identity;
  });
}

export function createMorphQualificationScenario(
  fixture: MorphQualificationCase,
): MorphQualificationScenario {
  const targets = targetRoots(fixture.state);
  const targetIdentities = rootIdentities(targets);
  let currentChildren: readonly string[];
  let incomingChildren: readonly string[];
  let insertedIdentity: string | null = null;
  let removedIdentity: string | null = null;
  let replacementIdentities: readonly string[] = [];

  switch (fixture.operation) {
    case "insert-keyed":
      currentChildren = [...targets, peerA];
      incomingChildren = [...targets, insertedPeer, peerA];
      insertedIdentity = "inserted-peer";
      break;
    case "remove-keyed":
      currentChildren = [...targets, removedPeer, peerA];
      incomingChildren = [...targets, peerA];
      removedIdentity = "removed-peer";
      break;
    case "reorder-keyed":
      currentChildren = [...targets, peerA, peerB];
      incomingChildren = [...targets, peerB, peerA];
      break;
    case "intentional-replacement":
      currentChildren = [...targets, peerA];
      incomingChildren = [
        '<output id="replacement-target">after</output>',
        peerA,
      ];
      replacementIdentities = [fixture.targetIdentity];
      break;
  }

  const beforeOrder = [
    ...targetIdentities,
    ...(fixture.operation === "insert-keyed"
      ? ["peer-a"]
      : fixture.operation === "remove-keyed"
        ? ["removed-peer", "peer-a"]
        : fixture.operation === "reorder-keyed"
          ? ["peer-a", "peer-b"]
          : ["peer-a"]),
  ];
  const afterOrder = [
    ...targetIdentities,
    ...(fixture.operation === "insert-keyed"
      ? ["inserted-peer", "peer-a"]
      : fixture.operation === "remove-keyed"
        ? ["peer-a"]
        : fixture.operation === "reorder-keyed"
          ? ["peer-b", "peer-a"]
          : ["peer-a"]),
  ];
  return {
    fixture,
    currentHtml: `${pagePrefix}<main id="root" class="before">${currentChildren.join("")}</main>`,
    patch: {
      rootIdentity: "root",
      replacementHtml: `<main id="root" class="after">${incomingChildren.join("")}</main>`,
      replacementIdentities,
    },
    beforeOrder,
    afterOrder,
    insertedIdentity,
    removedIdentity,
  };
}

export const MORPH_QUALIFICATION_SCENARIOS = Object.freeze(
  MORPH_QUALIFICATION_CASES.map(createMorphQualificationScenario),
);
