# ADR 0042: Independent usability evidence contract

- Status: Accepted
- Date: 2026-07-18
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [A0 roadmap](../roadmap/a0.md)
- Supersedes: None

## Context

Packed conformance proves that commands work, but it does not prove that a new
user can discover the workflow, understand failures, follow corrections, or
identify missing tooling without private guidance. A0-08 must not select an
editor product from maintainer preference or fabricated observations.

## Decision drivers

- Tasks must be fixed before maintainers see participant outcomes.
- Evidence must distinguish independent discovery from facilitator coaching.
- Failed and abandoned attempts are as important as successful attempts.
- Participant privacy and artifact provenance must be verifiable.
- Contract tests must never be mistaken for real user evidence.

## Decision

A0-07 is collected in two bounded sub-slices. A0-07A freezes one versioned task
packet and its verifier before observation. A0-07B retains every started
attempt and accepts a result only after at least two independent participants
complete the packet against the same exact packed artifact identity.

A participant is independent only when they have not contributed Fadeno source,
tests, specifications, or task-packet text and have not received private
implementation guidance. The retained record uses an anonymous participant ID,
coarse prior-experience bands, task outcomes, assistance categories, bounded
redacted observations, artifact identity, and explicit missing-workflow reports.
Names, contact details, free-form environment values, secrets, source paths,
and command history outside the packet are not collected.

The packet covers install/create, stock application tests, successful and
failed framework explanation, seeded configuration/route/generation failures,
correction and stale-state removal, development, production build, immutable
deployment, and one explicit missing-workflow report. Every started attempt is
retained, including refusal, abandonment, and facilitator-intervention states.
The verifier rejects changed tasks, artifact mismatch, omitted attempts,
duplicate participant identity, unclassified assistance, missing recovery, or
claims derived from contract fixtures.

Contract fixtures test validation but are permanently marked as synthetic and
cannot satisfy participant or outcome counts. The evidence records observed
workflow behavior only; it is not telemetry, a public schema, or a supported
editor protocol.

## Alternatives considered

- Treat packed conformance as user evidence: rejected because an automated
  harness cannot report discoverability or missing workflows.
- Ask maintainers to replay the guide: rejected because implementation context
  defeats independence.
- Collect only successful sessions: rejected because it selects favorable
  outcomes and hides abandonment.
- Retain unrestricted recordings or shell history: rejected because the task
  does not justify collecting personal data, secrets, or unrelated activity.
- Choose editor tooling before collection: rejected because DG-A0-02 requires a
  demonstrated consumer and a concrete missing workflow.

## Consequences

- A0-07 cannot complete until real independent participants provide retained
  attempts.
- A0-08 receives reproducible user evidence and explicit missing workflows.
- The private analyzer and supported-editor deferral remain unchanged.
- This decision changes no package surface and needs no Changeset.

## Validation

`pnpm check:a0-usability-contract` validates the frozen packet, documentation,
tracking, synthetic positive fixture, and negative mutations. A0-07B adds the
attempt replay verifier, exact artifact reconstruction, all-attempt manifest,
and accepted/refused evidence commands before the result can be claimed.
