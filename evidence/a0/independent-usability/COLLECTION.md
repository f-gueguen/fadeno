# A0 independent-usability collection procedure

This is a facilitator retention procedure, not additional participant guidance.
Participants receive only the reconstructed bundle, its cover sheet, and
public documentation.

1. Before a participant opens the packet, assign an anonymous ID matching
   `participant-[a-z0-9]{8,32}` and record it in the started-attempt roster.
   Opening the packet starts an attempt; refusal or abandonment does not remove
   it from the roster.
2. Confirm that the participant has never contributed to the repository and
   has received no private implementation guidance. Any task-level facilitator
   help is retained as `facilitator-intervention` and cannot qualify as an
   independent completion.
3. Retain task outputs only under
   `evidence/a0/independent-usability/attempts/<anonymous-id>/`. Use distinct
   regular files for human output, machine output, correction before/after,
   flow inspection, and recovery where the frozen packet requires them.
4. Before hashing or retaining a file, remove names, contact details, secrets,
   absolute paths, environment values, unrelated command history, and precise
   timestamps. Keep each artifact at or below 262,144 bytes and each
   observation at or below 2,048 UTF-8 bytes. Record lowercase SHA-256 digests.
5. Create `attempt.json` in that participant directory using the exact record
   shape in `task-packet.json`. Retain all tasks that were started, in packet
   order, including refused and abandoned outcomes and their matching recovery
   state.
6. After collection is truly closed, create one manifest with schema
   `fadeno.a0.independent-usability-evidence`, version `1`, disposition
   `participant-evidence`, the packet and artifact identities from the bundle,
   sorted repository-relative attempt paths, and sorted started and retained
   rosters. `omittedAttemptIds` must be empty.
7. Replay the closed collection from a clean dependency environment with:

   ```sh
   pnpm check:a0-usability-evidence --manifest evidence/a0/independent-usability/evidence-manifest.json
   ```

The replay result is accepted only when the reconstructed source commit,
package digest, and version match; all attempts and required artifacts are
present and private-data checks pass; and at least two complete independent
non-contributors report the missing-workflow task. A failed replay is a refusal
to claim evidence, not permission to delete an attempt or rewrite an observed
outcome.
