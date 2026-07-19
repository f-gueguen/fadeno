# ADR 0043: Defer independent usability and external tooling for first alpha

- Status: Accepted
- Date: 2026-07-19
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [compiler and analyzer](../spec/compiler-analyzer.md), [A0 roadmap](../roadmap/a0.md)
- Supersedes: ADR 0042

## Context

ADR 0042 prepared a privacy-bounded, exact-artifact independent-usability
qualification and made two non-contributor attempts a prerequisite for A0-08.
The packet, reconstruction, replay, privacy, and synthetic-refusal controls are
implemented, but suitable participants are not currently available. Keeping
the first alpha blocked would not add evidence; treating an automated or
maintainer-authored attempt as a participant would fabricate evidence.

The automated packed workflows already prove that the public package can be
installed, can create an application, and can run check, test, development,
build, production start, and immutable deployment success/refusal/recovery
paths. They do not prove that a newcomer can discover or understand those
workflows without help.

## Decision drivers

- Alpha release progress must not depend indefinitely on unavailable people.
- Missing evidence must remain visible rather than being relabeled as success.
- A tooling product or public analyzer schema must not be chosen without a
  demonstrated consumer.
- The completed collection machinery should remain usable for a later release.
- Alpha documentation must distinguish mechanical conformance from observed
  newcomer usability.

## Decision

Independent-user collection is deferred beyond the first alpha. A0-07 exits as
`deferred-unqualified`: its packet, bundle reconstruction, replay, retention,
privacy, and synthetic-refusal controls are accepted, but no participant
outcome or usability claim is accepted by default.

For the first alpha, the public workflow is qualified only by current-packed
automated application evidence. Release status, support text, and release notes
must state that independent newcomer usability has not been qualified.

A0-08 resolves to no supported editor product and no public analyzer schema.
The existing analyzer stays private and tool-neutral. DG-A0-02 is removed as an
A0 blocker; external analyzer consumers remain deferred until a real consumer
and product-specific lifecycle evidence justify a new compatibility decision.
References in earlier effective decisions to the former external-schema gate
are replaced by this deferral; they do not keep a removed gate authoritative.

The ADR 0042 task packet and verifier remain the contract for any later
collection using that packet version. A later usability claim must still use
real independent non-contributors, retain every started attempt, bind results
to one exact package/source identity, pass the privacy and synthetic-refusal
gates, and state exactly which release artifact the evidence qualifies.

## Alternatives considered

- Accept the missing attempts as passing: rejected because absence is not
  usability evidence.
- Use maintainers, agents, or synthetic fixtures as participants: rejected
  because implementation context defeats independence and the verifier
  intentionally refuses those records.
- Select an editor product from maintainer preference: rejected because no
  demonstrated unresolved workflow exists.
- Keep A0 blocked indefinitely: rejected because the unavailable external
  observation does not prevent an explicitly experimental alpha whose
  limitation is disclosed.

## Consequences

- A0-09 may qualify the first alpha without real participant attempts.
- The first alpha cannot claim independently validated onboarding,
  discoverability, corrections, editor usability, or assistive-technology
  usability.
- No editor extension, language server, public analyzer schema, or compatibility
  promise is introduced.
- Later evidence qualifies only the exact artifact it names and does not
  retroactively qualify the first alpha.
- Reinstating independent usability as a release gate requires a later ADR and
  current-artifact evidence.
- This decision changes no package bytes or public runtime behavior, requires no
  Changeset, and can be rolled back by a later decision before publication.

## Validation

`pnpm check:a0-tooling-deferral` verifies ADR supersession, the explicit
`deferred-unqualified` state, release caveat, removal of DG-A0-02, continued
editor/schema deferrals, private analyzer boundary, A0-09 sequencing, and
negative mutations that would fabricate evidence or introduce a tooling
product. `pnpm check:a0-usability-contract`,
`pnpm check:a0-usability-replay-contract`, and
`pnpm check:a0-usability-artifact` continue to preserve the deferred collection
machinery without claiming participants.
