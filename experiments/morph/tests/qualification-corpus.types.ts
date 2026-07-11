import type { MorphQualificationCase } from "../fixtures/qualification-corpus.ts";

const validStructuralCase: MorphQualificationCase = {
  id: "valid-structural",
  state: "dirty-text",
  operation: "insert-keyed",
  structuralStress: "insert-before-target",
  targetIdentity: "target",
  description: "valid",
};

const validReplacementCase: MorphQualificationCase = {
  id: "valid-replacement",
  state: "intentional-replacement",
  operation: "intentional-replacement",
  structuralStress: "replace-target",
  targetIdentity: "target",
  description: "valid",
};

void validStructuralCase;
void validReplacementCase;

// @ts-expect-error replacement state cannot claim an ordinary structural operation.
const invalidReplacementOperation: MorphQualificationCase = {
  id: "invalid-replacement",
  state: "intentional-replacement",
  operation: "insert-keyed",
  structuralStress: "insert-before-target",
  targetIdentity: "target",
  description: "invalid",
};

// @ts-expect-error structural state cannot claim the declared-replacement control operation.
const invalidStructuralOperation: MorphQualificationCase = {
  id: "invalid-structural",
  state: "dirty-file",
  operation: "intentional-replacement",
  structuralStress: "replace-target",
  targetIdentity: "target",
  description: "invalid",
};

void invalidReplacementOperation;
void invalidStructuralOperation;
