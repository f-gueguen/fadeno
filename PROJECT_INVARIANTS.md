# Project invariants

This file is Fadeno's public architectural contract. An implementation that
conflicts with it is wrong unless an accepted ADR updates the invariant.

## Product boundary

1. Fadeno targets web applications whose primary model is documents, links,
   forms, server-owned data, and progressively enhanced interaction.
2. Fadeno is not a general SPA runtime, game engine, editor engine, or client
   state-management library.
3. A root island is the explicit escape hatch when rich client behavior owns a
   route. Repeated need for that escape hatch is guidance to choose another
   framework.

## Public language

1. Application syntax is standard TypeScript and JSX accepted by stock tools.
2. The framework never extends the TypeScript or JSX grammar.
3. The public vocabulary stays centered on page, fragment, resource, action,
   island, state home, context, links, and forms.
4. Framework behavior uses typed APIs, not stringly selector or `data-*`
   protocols in ordinary application code.
5. One canonical public way exists for each job.

## Progressive enhancement

1. Server-rendered HTML is the baseline.
2. Links navigate and forms submit without JavaScript.
3. JavaScript may add patching, pending states, transitions, focus management,
   and rich islands; it does not replace the baseline path.
4. A route that requires JavaScript declares a reviewable reason.
5. Native HTML, CSS, and browser capabilities are preferred before framework
   JavaScript.

## Execution boundaries

1. Server, client, and shared zones are visible from source structure.
2. A refactor never silently relocates code across a network boundary.
3. Resources and actions are server boundaries.
4. Islands and extracted interaction handlers are client boundaries.
5. Shared code cannot access server secrets or browser-only globals.
6. The server core uses standard `Request`, `Response`, and Web Streams.

## Data and state

1. Resources own application reads used by pages.
2. Actions own ordinary mutations and every action is form-callable.
3. A successful action revalidates page resources by default.
4. The initial optimization surface only permits declarations that preserve
   correctness when omitted and can be checked in development.
5. Ordinary application code has no client-fetch primitive and no default
   global client store.
6. Every UI state value has one explicit home: URL, form, resource, session,
   device, or local element/island state.
7. Selector-targeted distant updates are not part of ordinary application
   code; changed output follows state and resource dependencies.

## Security and protocols

1. Dynamic HTML is escaped by default; raw HTML is explicit and auditable.
2. Action, cookie, redirect, patch, cache, and live-update behavior must have
   threat-model coverage before public release.
3. Network payloads are validated at trust boundaries.
4. Wire and analyzer schemas are versioned before external consumers depend on
   them; they are not declared stable before conformance evidence exists.
5. Logs and diagnostics must not expose secrets or sensitive form values.

## Repository and package boundaries

1. This repository owns implementation and current documentation.
2. New public package boundaries require an ADR and a demonstrated consumer.
3. Cross-package relative imports and private deep imports are forbidden once
   packages exist.
4. Compiler IR, render internals, patch internals, and browser runtime helpers
   stay private until a supported external consumer justifies a public package.
5. Examples import only public entrypoints and execute in CI.

## Evidence and compatibility

1. Unproven mechanisms live in the hypothesis ledger, not as claims of
   implemented behavior.
2. Performance claims name the dataset, hardware, runtime, command, and result.
3. Pre-1.0 public details may change when evidence requires it; the change must
   add or supersede ADRs and update specifications, tests, changelog intent, and
   migration guidance.
4. Published release tags are immutable.
5. Released behavior remains compatible until an explicitly versioned change
   replaces it.

## Done criteria

A non-trivial change is done only when:

1. the narrowest relevant boundary owns it;
2. positive and negative behavior is covered;
3. current docs, decisions, schemas, examples, and tests agree;
4. compatibility and rollback consequences are stated;
5. `pnpm check` passes.
