type MorphFixtureBase = Readonly<{
  id: string;
  description: string;
}>;

export type MorphFixture =
  | (MorphFixtureBase & Readonly<{
      kind: "passing-control";
      operation: "insert-unrelated-sibling";
      expectedStatus: "passed";
      expectedExitCode: 0;
      diagnostic?: never;
    }>)
  | (MorphFixtureBase & Readonly<{
      kind: "seeded-failure";
      operation: "replace-focused-control";
      expectedStatus: "failed";
      expectedExitCode: 1;
      diagnostic: "FADENO_MORPH_STATE_LOSS";
    }>)
  | (MorphFixtureBase & Readonly<{
      kind: "candidate-control";
      operation: "apply-private-candidate";
      expectedStatus: "passed";
      expectedExitCode: 0;
      diagnostic?: never;
    }>);

export const MORPH_FIXTURES: readonly MorphFixture[] = Object.freeze([
  Object.freeze({
    id: "seeded-preservation-control",
    kind: "passing-control",
    operation: "insert-unrelated-sibling",
    expectedStatus: "passed",
    expectedExitCode: 0,
    description: "Dirty focused input survives a proven unrelated sibling insertion.",
  }),
  Object.freeze({
    id: "seeded-undeclared-state-loss",
    kind: "seeded-failure",
    operation: "replace-focused-control",
    expectedStatus: "failed",
    expectedExitCode: 1,
    description: "Replacing a dirty focused input must be detected as undeclared state loss.",
    diagnostic: "FADENO_MORPH_STATE_LOSS",
  }),
  Object.freeze({
    id: "intentional-replacement",
    kind: "candidate-control",
    operation: "apply-private-candidate",
    expectedStatus: "passed",
    expectedExitCode: 0,
    description: "One private patch reuses the dirty focused input and replaces a declared peer.",
  }),
]);

export function getMorphFixture(id: string): MorphFixture {
  const fixture = MORPH_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`FADENO_MORPH_UNKNOWN_FIXTURE: ${id}`);
  return fixture;
}

export function stableMorphInventory() {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      experiment: "morph",
      fixtures: MORPH_FIXTURES,
    },
    null,
    2,
  )}\n`;
}
