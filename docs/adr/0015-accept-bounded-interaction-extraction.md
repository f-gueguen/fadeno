# ADR 0015: Accept bounded interaction extraction

- Status: Accepted
- Date: 2026-07-11
- Owners: Fadeno maintainers
- Related specifications: [Compiler and analyzer](../spec/compiler-analyzer.md), [execution boundaries](../spec/execution-boundaries.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

H2 asked whether common local interactions can become lazy browser handlers
without hydrating their server-rendered fragment. K0-06 locked five accepted
classes, ten refusal classes, 100 consecutive interactions, three browser
engines, deterministic generation, response and request evidence, and the
accepted H1 identity-operation signature before implementing a candidate.

The exact clean source commit
[`829ea53`](https://github.com/f-gueguen/fadeno/commit/829ea53e3176bcd1ba88b17f5ed67e8c712f0d68)
completed that matrix in the pinned reference environment in
[hosted run 29144117748](https://github.com/f-gueguen/fadeno/actions/runs/29144117748)
with no retries. All five accepted classes passed in
Chromium, Firefox, and WebKit. All ten rejected classes stopped at their source
boundary with the locked diagnostic and no browser artifact. The generated
module was requested only by the first interaction, its served bytes matched
the emitted disk bytes, and later interactions caused no additional module
request or evaluation.

## Decision drivers

- Extraction must stay bounded, explainable, and statically conservative.
- A refusal must never silently expand into fragment hydration.
- Server capabilities and ambiguous values must not cross into browser output.
- Capture limits must bound analyzer work and the complete serialized payload.
- Generated files and immutable qualification evidence must be deterministic,
  contained, and attributable to one clean commit.
- Passing experiment syntax is not automatically a public authoring API.

## Decision

H2 is **accepted with a GO decision**. Fadeno may implement bounded lazy
interaction extraction for V3 using this semantic contract:

1. The analyzer selects one syntactically visible handler closure and performs
   checker-backed analysis of every runtime free value. K0 accepts exactly one
   statically resolved, self-contained behavior function plus the referenced
   root-body plain captures; root parameters, additional helpers, unresolved
   values, and behavior functions with external dependencies are refused.
2. Captures are bounded plain JSON data. Numbers must be finite and preserve
   their JSON meaning, so negative zero is refused; prototype-sensitive object
   keys are also refused. The single canonical serialized envelope may not
   exceed 65,536 UTF-8 bytes.
3. Server-only imports, secrets, opaque capabilities, class instances, cyclic
   data, non-literal dynamic imports, ambient environment switching,
   unbounded async lifetimes, oversized envelopes, non-deterministic
   initializers, and unresolved flows are refused with teaching diagnostics.
4. Accepted K0 output contains the selected handler and its one self-contained
   behavior function. The permitted additional dependency set is empty until a
   later pre-locked corpus qualifies dependency emission. Output never contains
   a fragment renderer, server module, component runtime, or implicit hydration
   fallback.
5. The handler module is lazy: no request occurs before the interaction; the
   first interaction requests only its handler graph; later interactions reuse
   the same module and handler identity.
6. Handler trigger identity survives every locked non-replacement H1 operation.
   The state record retains ADR 0014's accepted signature: 15 states preserve
   exactly, while the two known layout-affecting scroll cases remain narrowed
   rather than being misreported as preservation.
7. Emission is transactional, byte-deterministic, and confined against lexical
   traversal plus symlinks in every existing output-path component.

The K0 marker function, fixture roots, candidate classes, generated filenames,
diagnostic identifiers, and report schemas remain private evidence code. This
ADR resolves the former extraction gate's semantic contract; it does not publish
authoring syntax, a package entrypoint, or an external analyzer schema.

## Alternatives considered

- **Narrow extraction by excluding tabs:** retained as a locked executable
  decision path, but rejected by the actual result because all five classes
  passed.
- **Pivot to islands for all client behavior:** retained as the required result
  for any core, boundary, identity, determinism, or output-safety failure, but
  not selected by the evidence.
- **Allow arbitrary serializable closures:** rejected because runtime
  serializability does not prove capability safety, determinism, or teachable
  refusal.
- **Fall back to fragment hydration:** rejected because it hides a boundary
  failure and contradicts explicit islands and inspectable output.

## Consequences

- INT-01 remains a V3 delivery item, but it is no longer blocked on H2 or the
  extraction-contract decision.
- V3 implementation must preserve this refusal-first semantic boundary and
  qualify any concrete public authoring surface before release.
- Any shared browser-dependency emission expands this decision and therefore
  requires a pre-locked positive/negative corpus and a follow-up ADR; it cannot
  be inferred from K0's module-graph wording.
- Diagnostic codes remain internal until DG-A0-02 resolves their external
  lifecycle and schema.
- ADR 0014's scroll narrowing remains authoritative; extraction does not imply
  a broader patch or scroll guarantee.
- Release impact: none — no published package.

## Validation

- `pnpm install --frozen-lockfile`
- `pnpm check`
- `pnpm experiment:extraction -- --qualify`
- Seeded tabs-only qualification produces `NARROW`.
- Seeded core and rejected-boundary qualification produce `PIVOT`.
- The immutable run manifest and hosted reference-run link are recorded in
  [the extraction results index](../../experiments/extraction/results/README.md).
