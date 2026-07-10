# Contributor and coding-agent workflow

This is the canonical change workflow for humans and coding agents. It turns a
roadmap outcome into small, reviewable, releasable changes without allowing task
discussion to become project law.

## 1. Orient before editing

Read, in order:

1. `AGENTS.md` and `PROJECT_INVARIANTS.md`;
2. `ROADMAP_LEDGER.md` and the detailed plan for its current or next approved
   slice;
3. the affected feature rows in `docs/product/scope.md` and
   `docs/traceability.md`;
4. relevant effective ADRs and current specifications;
5. relevant hypotheses, risks, decision gates, and deferrals.

State the feature IDs and one intended outcome before changing code. If a named
decision gate blocks the outcome, gather its required evidence or stop for the
decision; do not bury a new public contract in implementation.

## 2. Keep the change atomic

One pull request delivers one public behavior, infrastructure capability,
experiment result, or durable decision. A PR may contain several files only
when they are all required to make that one outcome complete.

Keep commits independently understandable and buildable. Do not mix unrelated
formatting, dependency churn, cleanup, or generated output. The normal merge
strategy is squash merge so `main` receives one atomic commit for one PR. A
maintainer may preserve multiple commits only when each is independently useful
to review, revert, and bisect.

Never rewrite or discard unrelated workspace changes. Coding agents do not
commit, push, publish, or open a PR unless the task authorizes that action.

## 3. Deliver the complete slice

An implementation PR includes, where applicable:

- implementation at the narrowest owning boundary;
- positive, negative, security, type, integration, and browser tests required
  by the affected traceability row;
- one executable example or an update to the existing executable example;
- current specification and generated-reference updates;
- an ADR when a durable decision changes;
- hypothesis, risk, decision-gate, deferral, roadmap, and traceability updates;
- compatibility and migration guidance;
- version intent and changelog material for affected published packages;
- explicit rollback behavior.

An omitted item is marked `Not applicable` in the PR with a concrete reason.
“Documentation later,” “tests in a follow-up,” and fictional examples do not
complete a public-behavior PR.

## 4. Examples and documentation

An example exists only when CI executes it against public entrypoints. The code
displayed in documentation is imported, included, or generated from that same
tested source; Markdown does not maintain a second copy.

When public behavior changes, update the smallest example that demonstrates the
behavior. Add a new example only when it teaches a distinct workflow. Negative
examples belong in diagnostic or conformance fixtures, not copied guide code.

Documentation describes current behavior. Future mechanisms stay in hypotheses,
decision gates, deferrals, or roadmap outcomes and are not written as available
APIs.

## 5. Version and changelog workflow

Before an installable public package exists:

- repository and experiment changes do not invent package versions or tags;
- every PR still declares `Release impact: none — no published package`;
- `CHANGELOG.md` remains the release-format contract rather than a journal of
  internal commits.

Once a package is designated publishable, including its first release:

1. Every PR that changes a package designated publishable declares affected
   packages, compatibility impact, and semantic version intent, including the
   first release.
2. Each independently releasable user-visible change carries exactly one
   Changeset. Internal or documentation-only work with no released behavior
   states why no Changeset is required.
3. The Changeset explains the user outcome; it is not a commit-message dump.
4. A compatibility change updates the indexed
   [migration guidance and executable fixture](migrations/README.md) in the same
   PR.
5. The release PR consumes pending Changesets, increments all public packages
   in the accepted lockstep group, updates the lockfile and changelogs, and runs
   clean-install and package-content checks.
6. The exact tested release commit receives one immutable tag. Packages and
   documentation are built from that tag.
7. A faulty release is reverted or corrected through a new PR and version. Tags
   and published versions are never replaced.

Feature PRs remain small even when release automation batches compatible
Changesets. A release PR is mechanical and cannot introduce unrelated behavior.

## 6. Validate proportionally

Always run:

```sh
pnpm install --frozen-lockfile
pnpm check
```

Also run every affected command named by traceability and the current roadmap
slice. Browser, security, performance, package, and reproducibility gates are
required when their surface changes; retrying a flaky test until green is not
evidence.

Record benchmark dataset, environment, command, warmup, repetitions, raw result,
and conclusion. Performance claims without those fields do not enter current
documentation.

## 7. Prepare review and handoff

The PR description contains:

- one-sentence outcome and affected feature IDs;
- evidence and commands run;
- decisions/specifications/examples changed;
- security and compatibility impact;
- release impact and version intent;
- rollback behavior;
- remaining blocker or explicitly deferred follow-up.

Update `ROADMAP_LEDGER.md` only for current slice, gate, blocker, or open-question
state. Git history, ADR supersession, changelogs, and immutable evidence carry
completed history.

## Definition of done

A change is done when the feature's traceability row is satisfied, current
authority surfaces agree, generated artifacts are reproducible, relevant
examples execute, version/changelog intent is correct, rollback is understood,
and all required checks pass from the frozen install.
