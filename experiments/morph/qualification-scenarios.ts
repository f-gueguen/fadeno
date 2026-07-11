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
  operationParentIdentity: string;
  insertedIdentity: string | null;
  removedIdentity: string | null;
}>;

export const MORPH_QUALIFICATION_PAGE_STYLE =
  "html,body{margin:0}.peer{display:block;height:20px}.document-spacer{display:block;height:2400px}.scroll-box{display:block;width:240px;height:80px;overflow:auto}.scroll-content{display:block;height:600px}";
const pagePrefix =
  `<!doctype html><meta charset="utf-8"><style>${MORPH_QUALIFICATION_PAGE_STYLE}</style>`;
const peerA = '<output id="peer-a" class="peer">peer-a</output>';
const peerB = '<output id="peer-b" class="peer">peer-b</output>';
const insertedPeer = '<output id="inserted-peer" class="peer">inserted</output>';
const removedPeer = '<output id="removed-peer" class="peer">removed</output>';
const mediaSource = `data:audio/wav;base64,${createQualificationTone().toString("base64")}`;

function targetRoots(
  state: QualificationState,
  phase: "current" | "incoming" = "current",
): readonly string[] {
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
        `<div id="scroll-container" class="scroll-box">${
          phase === "incoming" ? insertedPeer : ""
        }<section id="scroll-content" class="scroll-content">Nested spacer</section></div>`,
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
  const currentTargets = targetRoots(fixture.state, "current");
  const incomingTargets = targetRoots(fixture.state, "incoming");
  const targetIdentities = rootIdentities(currentTargets);
  let currentChildren: readonly string[];
  let incomingChildren: readonly string[];
  let operationParentIdentity = "root";
  let beforeOrder: readonly string[];
  let afterOrder: readonly string[];
  let insertedIdentity: string | null = null;
  let removedIdentity: string | null = null;
  let replacementIdentities: readonly string[] = [];

  switch (fixture.operation) {
    case "insert-keyed":
      if (fixture.structuralStress === "insert-inside-scroll-container-before-content") {
        currentChildren = [...currentTargets, peerA];
        incomingChildren = [...incomingTargets, peerA];
        operationParentIdentity = fixture.targetIdentity;
        beforeOrder = ["scroll-content"];
        afterOrder = ["inserted-peer", "scroll-content"];
      } else {
        currentChildren = [...currentTargets, peerA];
        incomingChildren = [insertedPeer, ...incomingTargets, peerA];
        beforeOrder = [...targetIdentities, "peer-a"];
        afterOrder = ["inserted-peer", ...targetIdentities, "peer-a"];
      }
      insertedIdentity = "inserted-peer";
      break;
    case "remove-keyed":
      currentChildren = [removedPeer, ...currentTargets, peerA];
      incomingChildren = [...incomingTargets, peerA];
      beforeOrder = ["removed-peer", ...targetIdentities, "peer-a"];
      afterOrder = [...targetIdentities, "peer-a"];
      removedIdentity = "removed-peer";
      break;
    case "reorder-keyed":
      currentChildren = [peerA, ...currentTargets, peerB];
      incomingChildren = [...incomingTargets, peerB, peerA];
      beforeOrder = ["peer-a", ...targetIdentities, "peer-b"];
      afterOrder = [...targetIdentities, "peer-b", "peer-a"];
      break;
    case "intentional-replacement":
      currentChildren = [...currentTargets, peerA];
      incomingChildren = [
        '<output id="replacement-target">after</output>',
        peerA,
      ];
      beforeOrder = [...targetIdentities, "peer-a"];
      afterOrder = [...targetIdentities, "peer-a"];
      replacementIdentities = [fixture.targetIdentity];
      break;
  }
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
    operationParentIdentity,
    insertedIdentity,
    removedIdentity,
  };
}

export const MORPH_QUALIFICATION_SCENARIOS = Object.freeze(
  MORPH_QUALIFICATION_CASES.map(createMorphQualificationScenario),
);
