# Morph tests

`harness.spec.ts` executes the independent K0-02 controls, while
`candidate.spec.ts` executes only the K0-03 private candidate control. The
Playwright configuration selects exactly one spec from the catalog fixture so
a candidate module-load failure cannot prevent the K0-02 controls from running.
Both specs execute identically in the Chromium, Firefox, and WebKit projects,
share only the JSON attachment helper, and use `machine-reporter.ts` to emit the
bounded child-run evidence consumed by the meta-verifier.

`qualification-corpus.types.ts` locks impossible structural/replacement case
combinations with stock TypeScript. The browser qualification spec will remain
separate from both earlier controls so a qualification failure cannot erase
their independent integrity evidence.

`qualification.spec.ts` now owns only K0-04 browser execution. It runs one
zero-retry test per engine and loops the closed case/ordinal matrix internally,
retaining bounded aggregate records instead of one artifact per passing cell.
The spec drives `candidate.ts` directly and independently observes references,
state, transient setter/method/event activity, structural output, runtime
errors, unhandled rejections, and blocked requests. `qualification-report.ts`
revalidates the portable records and exact matrix outside the browser.
