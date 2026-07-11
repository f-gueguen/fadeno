# Architecture decision records

ADRs record durable decisions that constrain Fadeno. They explain why the
decision exists, its consequences, and how it can be validated.

An effective ADR changes only through a later accepted ADR. The later record
names what it supersedes, and the earlier record changes status to `Superseded`
with a backlink. Specifications may add detail, but may not contradict an
effective decision.

## Effective decisions

1. [ADR 0001 — Canonical repository and authority](0001-canonical-repository-and-authority.md)
2. [ADR 0002 — Standard TypeScript and HTML-shaped JSX](0002-standard-typescript-and-html-shaped-jsx.md)
3. [ADR 0003 — Progressive enhancement as the baseline](0003-progressive-enhancement-baseline.md)
4. [ADR 0004 — Structural execution boundaries](0004-structural-execution-boundaries.md)
5. [ADR 0005 — Resources and actions](0005-resources-and-actions.md)
6. [ADR 0006 — Correctness-first revalidation](0006-correctness-first-revalidation.md)
7. [ADR 0007 — Tiered interactivity direction](0007-tiered-interactivity-direction.md)
8. [ADR 0008 — Web-standard server boundary](0008-web-standard-server-boundary.md)
9. [ADR 0009 — Documentation and evidence authority](0009-documentation-and-evidence-authority.md)
10. [ADR 0010 — Pre-1.0 compatibility and releases](0010-pre-1-0-compatibility-and-releases.md)
11. [ADR 0011 — Supported developer workflow](0011-supported-developer-workflow.md)
12. [ADR 0012 — Evidence-gated support and operations](0012-evidence-gated-support-and-operations.md)
13. [ADR 0013 — MIT license](0013-mit-license.md)
14. [ADR 0014 — Narrow structural preservation around scroll-affecting layout](0014-narrow-structural-preservation.md)

## Superseded decisions

None.

## Writing an ADR

Copy [the template](template.md), use the next four-digit number, and keep the
decision focused. A new numbered ADR is merged only when its status is
`Accepted`. Proposals remain in the change discussion until accepted; uncertain
mechanisms belong in the hypothesis ledger.
