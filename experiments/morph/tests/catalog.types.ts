import type { MorphFixture } from "../fixtures/catalog.ts";

const validSeededFailure: MorphFixture = {
  id: "seeded-undeclared-state-loss",
  kind: "seeded-failure",
  operation: "replace-focused-control",
  expectedStatus: "failed",
  expectedExitCode: 1,
  description: "valid discriminated outcome",
  diagnostic: "FADENO_MORPH_STATE_LOSS",
};

// @ts-expect-error passing controls cannot execute the private candidate operation
const invalidPassingOperation: MorphFixture = {
  id: "invalid-passing-operation",
  kind: "passing-control",
  operation: "apply-private-candidate",
  expectedStatus: "passed",
  expectedExitCode: 0,
  description: "invalid operation pairing",
};

// @ts-expect-error seeded failures cannot be verified as passing
const invalidSeededStatus: MorphFixture = {
  id: "invalid-seeded-status",
  kind: "seeded-failure",
  operation: "replace-focused-control",
  expectedStatus: "passed",
  expectedExitCode: 1,
  description: "invalid status pairing",
  diagnostic: "FADENO_MORPH_STATE_LOSS",
};

void validSeededFailure;
void invalidPassingOperation;
void invalidSeededStatus;
