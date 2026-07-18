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
15. [ADR 0015 — Accept bounded interaction extraction](0015-accept-bounded-interaction-extraction.md)
16. [ADR 0016 — Local repository merge validation](0016-local-repository-merge-validation.md)
17. [ADR 0017 — H3 local Docker reference environment](0017-h3-local-docker-reference.md)
18. [ADR 0018 — Narrow the type spine around incremental generation](0018-narrow-type-spine-incremental-generation.md)
19. [ADR 0019 — H4 local Docker reference environment](0019-h4-local-docker-reference.md)
20. [ADR 0020 — Accept correctness-first revalidation](0020-accept-correctness-first-revalidation.md)
21. [ADR 0021 — Reconcile K0 evidence into V1 delivery](0021-reconcile-k0-into-v1-delivery.md)
22. [ADR 0022 — Toolchain and configuration contract](0022-toolchain-and-configuration-contract.md)
23. [ADR 0023 — Node HTTP as the initial adapter](0023-node-http-initial-adapter.md)
24. [ADR 0024 — Initial package boundary](0024-initial-package-boundary.md)
25. [ADR 0025 — Public Node adapter smoke contract](0025-public-node-adapter-smoke-contract.md)
26. [ADR 0027 — Generated route module and production routing](0027-generated-route-module-and-production-routing.md)
27. [ADR 0028 — Contextual rendering security](0028-contextual-rendering-security.md)
28. [ADR 0029 — Streaming lifecycle and boundary ownership](0029-streaming-lifecycle-and-boundary-ownership.md)
29. [ADR 0030 — Private incremental analyzer session](0030-private-incremental-analyzer-session.md)
30. [ADR 0031 — JSX renderer and generated route binding](0031-jsx-renderer-and-generated-route-binding.md)
31. [ADR 0032 — Project-check command contract](0032-project-check-command-contract.md)
32. [ADR 0033 — Build and development lifecycle](0033-build-and-development-lifecycle.md)
33. [ADR 0034 — Resource identity and request cache](0034-resource-identity-and-request-cache.md)
34. [ADR 0035 — Native actions and protected sessions](0035-native-actions-and-protected-sessions.md)
35. [ADR 0036 — Native external CSS for alpha](0036-native-external-css-for-alpha.md)
36. [ADR 0037 — Public package identity and publication boundary](0037-public-package-identity-and-publication.md)

## Superseded decisions

1. [ADR 0026 — Route filesystem and generated links](0026-route-filesystem-and-links.md), superseded by ADR 0027.

## Writing an ADR

Copy [the template](template.md), use the next four-digit number, and keep the
decision focused. A new numbered ADR is merged only when its status is
`Accepted`. Proposals remain in the change discussion until accepted; uncertain
mechanisms belong in the hypothesis ledger.
