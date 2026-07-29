export type ReconciliationScenario = Readonly<{
  id: string;
  state: string;
  operation: "insert-keyed" | "remove-keyed" | "reorder-keyed" | "intentional-replacement";
  targetIdentity: string;
  currentChildren: string;
  incomingChildren: string;
}>;

const peerA = '<output id="peer-a" class="peer">peer-a</output>';
const peerB = '<output id="peer-b" class="peer">peer-b</output>';
const insertedPeer = '<output id="inserted-peer" class="peer">inserted</output>';
const removedPeer = '<output id="removed-peer" class="peer">removed</output>';

function qualificationTone(): string {
  const sampleRate = 8_000;
  const samples = sampleRate * 2;
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 10_000);
    view.setInt16(44 + index * 2, sample, true);
  }
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

const mediaSource = qualificationTone();

const cases = Object.freeze([
  ["focused-input-selection-insert", "focused-input-selection", "insert-keyed", "focused-input"],
  ["focused-textarea-selection-remove", "focused-textarea-selection", "remove-keyed", "focused-textarea"],
  ["focused-contenteditable-caret-reorder", "focused-contenteditable-caret", "reorder-keyed", "focused-editor"],
  ["dirty-text-insert", "dirty-text", "insert-keyed", "dirty-text"],
  ["dirty-checkbox-remove", "dirty-checkbox", "remove-keyed", "dirty-checkbox"],
  ["dirty-radio-reorder", "dirty-radio", "reorder-keyed", "dirty-radio-a"],
  ["dirty-select-insert", "dirty-select", "insert-keyed", "dirty-select"],
  ["dirty-file-remove", "dirty-file", "remove-keyed", "dirty-file"],
  ["details-open-reorder", "details-open", "reorder-keyed", "open-details"],
  ["dialog-modal-insert", "dialog-modal", "insert-keyed", "modal-dialog"],
  ["dialog-nonmodal-remove", "dialog-nonmodal", "remove-keyed", "nonmodal-dialog"],
  ["popover-open-reorder", "popover-open", "reorder-keyed", "open-popover"],
  ["media-playing-insert", "media-playing", "insert-keyed", "playing-media"],
  ["media-paused-remove", "media-paused", "remove-keyed", "paused-media"],
  ["document-scroll-reorder", "document-scroll", "reorder-keyed", "scroll-anchor"],
  ["element-scroll-insert", "element-scroll", "insert-keyed", "scroll-container"],
  ["island-identity-remove", "island-identity", "remove-keyed", "mounted-island"],
  ["intentional-replacement-control", "intentional-replacement", "intentional-replacement", "replacement-target"],
] as const);

function targets(state: string, phase: "current" | "incoming"): readonly string[] {
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
      return [`<output id="replacement-target">${phase === "incoming" ? "after" : "before"}</output>`];
    default:
      throw new TypeError(`FADENO_RECONCILIATION_SCENARIO_STATE:${state}`);
  }
}

function createScenario(
  [id, state, operation, targetIdentity]: (typeof cases)[number],
): ReconciliationScenario {
  const currentTargets = targets(state, "current");
  const incomingTargets = targets(state, "incoming");
  let currentChildren: readonly string[];
  let incomingChildren: readonly string[];
  switch (operation) {
    case "insert-keyed":
      if (state === "element-scroll") {
        currentChildren = [...currentTargets, peerA];
        incomingChildren = [...incomingTargets, peerA];
      } else {
        currentChildren = [...currentTargets, peerA];
        incomingChildren = [insertedPeer, ...incomingTargets, peerA];
      }
      break;
    case "remove-keyed":
      currentChildren = [removedPeer, ...currentTargets, peerA];
      incomingChildren = [...incomingTargets, peerA];
      break;
    case "reorder-keyed":
      currentChildren = [peerA, ...currentTargets, peerB];
      incomingChildren = [...incomingTargets, peerB, peerA];
      break;
    case "intentional-replacement":
      currentChildren = [...currentTargets, peerA];
      incomingChildren = [...incomingTargets, peerA];
      break;
  }
  return Object.freeze({
    id,
    state,
    operation,
    targetIdentity,
    currentChildren: currentChildren.join(""),
    incomingChildren: incomingChildren.join(""),
  });
}

export const RECONCILIATION_SCENARIOS: readonly ReconciliationScenario[] =
  Object.freeze(cases.map(createScenario));

export function reconciliationScenario(id: string): ReconciliationScenario | undefined {
  return RECONCILIATION_SCENARIOS.find((scenario) => scenario.id === id);
}
