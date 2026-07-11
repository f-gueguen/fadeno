# Morph fixtures

`catalog.ts` is the single private fixture inventory. It contains the K0-02
passing and intended-failure controls, the K0-03 candidate control, and the
stable projection of the K0-04 closed qualification corpus.

`qualification-corpus.ts` is the typed K0-04 corpus authority. Its golden JSON
projection fixes the state/operation cases, three engines, zero-retry policy,
and separate 20-repetition CI and 100-repetition qualification profiles before
the candidate is broadened or results are collected. The corpus explicitly
contains structural-preservation evidence only; request, history, action,
transport, native-equivalence, and public-protocol claims remain out of scope.

`qualification-assets.ts` deterministically generates the selected local file
and two-second WAV used by the file/media cases. Their byte lengths and SHA-256
digests are part of the checked corpus projection; no network resource is used.
