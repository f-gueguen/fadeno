# Extraction results

The first immutable run is the K0-06 GO qualification from exact clean source
commit [`267cd0f`](https://github.com/f-gueguen/fadeno/commit/267cd0f2e8c6a71762007fc1d4fde52b49a026a5)
in [hosted run 29144470073](https://github.com/f-gueguen/fadeno/actions/runs/29144470073).
Its [validated manifest](20260711T072809Z-267cd0f-a1/manifest.json) retains the
complete three-engine observations, deterministic generated handlers, ten
refusal diagnostics, decision record, reference preflight, lockfile, and exact
source identity.

Immediately after the hosted job completed, the downloaded
`extraction-qualification-evidence` archive was compared byte-for-byte with the
pinned directory. GitHub reported artifact ID `8246311306` and archive digest
`sha256:e3ec01059ee0c08aca0dc45f9e665f8ed3f86d7c0791b8031ef13f49c86d3cf0`.
This is a manual hosted-artifact attestation; the persistent verifier owns the
stronger extracted-file hashes, semantics, source ancestry, and cross-record
consistency after GitHub artifact retention expires.

PR 11 was squash-merged as commit `f71dbb6`, so the exact qualification source
commit is intentionally not a Git ancestor of `main`. The tracked
[source-integration attestation](../../source-integration-attestations.json)
binds that result/source pair to the squash commit; the persistent verifier
requires the attested integration commit to be an ancestor, contain the exact
manifest and every hashed result artifact, and match the recorded lock and
qualification contract from its tree.
