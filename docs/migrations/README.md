# Migration policy and index

Migration documents exist only for released compatibility changes. There are no
released migrations yet. The [V1 private-preview seed](v1-private-preview.md)
is generated from verified correction evidence to establish the future format;
it is not a released migration.

## Location and naming

A migration document is named:

```text
<changeset-id>-<short-topic>.md
```

Its executable fixture lives at:

```text
docs/migrations/fixtures/<changeset-id>-<short-topic>/
```

The fixture contains a before project or source, the migration command or
documented edits, the expected after state, and a verification command. CI runs
the fixture against the released public entrypoints.

## Required contents

Copy [the migration template](template.md). Every migration states:

- affected versions and public packages;
- who is affected and how to detect the old usage;
- behavior before and after the change;
- ordered migration steps;
- automated assistance and its limitations;
- executable verification;
- rollback behavior;
- links to the Changeset, changelog release section, ADR, and immutable release
  tag.

## Workflow

The compatibility-changing feature PR adds the migration document and fixture.
Its stable Changeset ID owns both paths and the Changeset links the migration.
`From` and `To` metadata remain `Pending release` while batching can still alter
the target version. The release PR verifies the fixture, fills final versions
and immutable links without renaming the files, and links the migration from the
generated changelog.

Migration files are never used as the current API reference. Current behavior
belongs in specifications and released declarations.

## Current migrations

None. The private-preview seed is non-release guidance.
