# Progressive enhancement

## Baseline contract

An ordinary route returns a complete, meaningful HTML response. Essential
links use navigable URLs. Essential mutations use forms whose method, action,
controls, and server response work without browser JavaScript.

Validation failures return accessible server-rendered feedback associated with
the relevant controls. Redirects and navigation preserve normal URL and history
semantics.

## Enhanced contract

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
