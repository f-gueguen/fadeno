# Progressive enhancement

## Baseline contract

An ordinary route returns a complete, meaningful HTML response. Essential
links use navigable URLs. Essential mutations use forms whose method, action,
controls, and server response work without browser JavaScript.

Validation failures return accessible server-rendered feedback associated with
the relevant controls. Redirects and navigation preserve normal URL and history
semantics.

## Native CSS baseline

Alpha styling uses standard external CSS under
[ADR 0036](../adr/0036-native-external-css-for-alpha.md). Applications render
ordinary `class` attributes, link same-origin stylesheets, and own stylesheet
ordering, cascade, selector scope, and caching. Rendered documents permit only
same-origin styles through `style-src 'self'`; inline style attributes and
application-owned `style` children remain refused.

Fadeno does not provide scoped CSS, selector rewriting, extraction, an asset
pipeline, or stylesheet hot replacement in alpha. Those capabilities remain
deferred until application evidence earns a separate decision.

## Enhanced contract

ADR 0047 establishes the first optional browser bootstrap without beginning
enhancement behavior. `@fadeno/framework/browser` starts only when called by a
generated application module. The renderer loads that module through one
same-origin external script using its existing request-owned CSP nonce. If
JavaScript is disabled, the nonce is wrong or missing, the artifact is absent,
or module emission is rolled back, the complete native document remains
authoritative. The initial handle does not intercept links or forms.

When enhancement code is available, it may intercept a link or form only when
it can preserve the baseline semantics. It may then:

- avoid a full document replacement;
- expose pending and submission state;
- manage focus after a change;
- cancel superseded prefetch work;
- use an optional navigation transition.

Enhancement failure falls back to normal navigation or submission whenever the
request has not already been committed in a way that would duplicate a
mutation.

## Preservation requirements

Server-derived updates must preserve browser or user-owned state unless the
application explicitly replaces it. The conformance corpus includes:

- focused element, selection, and text caret;
- dirty form controls;
- open disclosure, dialog, and popover state;
- media playback state;
- relevant scroll position;
- mounted island identity and local state.

These are acceptance requirements for the morph experiment, not a claim that a
working algorithm exists.

## JavaScript-required routes

A JavaScript-required route declares the reason in source and supplies a useful
server response. The reason appears in analyzer output and review tooling. A
root island is the explicit ownership boundary.

## Accessibility

Enhancement must not reduce keyboard access, focus visibility, accessible
names, error association, live feedback, or user preferences. Automated checks
supplement, but do not replace, keyboard and assistive-technology review before
a stable release.
