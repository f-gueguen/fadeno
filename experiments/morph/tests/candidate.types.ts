import type { PrivateMorphPatch } from "../candidate.ts";

const validPatch: PrivateMorphPatch = {
  rootIdentity: "root",
  replacementHtml: '<main id="root"><input id="target"><output id="status"></output></main>',
  replacementIdentities: ["status"],
};

const invalidRootIdentity: PrivateMorphPatch = {
  // @ts-expect-error private identities are strings
  rootIdentity: 1,
  replacementHtml: '<main id="root"></main>',
  replacementIdentities: [],
};

const invalidReplacementIdentities: PrivateMorphPatch = {
  rootIdentity: "root",
  replacementHtml: '<main id="root"></main>',
  // @ts-expect-error replacement identities are strings
  replacementIdentities: [1],
};

void validPatch;
void invalidRootIdentity;
void invalidReplacementIdentities;
