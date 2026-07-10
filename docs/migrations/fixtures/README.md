# Migration fixtures

Each child directory is named after one indexed migration. It contains the
before state, migration operation or edits, expected after state, and an
executable verification command.

No fixture exists until a released compatibility change requires one. Fixtures
use public package entrypoints and run in CI; prose-only migration claims are
insufficient.
