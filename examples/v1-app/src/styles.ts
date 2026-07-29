export const applicationStyles = `
:root {
  color-scheme: light;
  --mist: #eef2f7;
  --paper: #f9fbfd;
  --white: #ffffff;
  --ink: #121826;
  --muted: #526075;
  --line: #cfd8e6;
  --cobalt: #315cf4;
  --cobalt-dark: #1739b7;
  --mint: #168a62;
  --mint-soft: #dff5ec;
  --amber: #b86900;
  --amber-soft: #fff0d6;
  --danger: #a43a40;
  --danger-soft: #fde8e9;
  --display: "Arial Narrow", "Aptos Display", "Roboto Condensed", sans-serif;
  --body: "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif;
  --utility: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-family: var(--body);
}

* {
  box-sizing: border-box;
}

html {
  background: var(--mist);
}

body.app-shell {
  margin: 0;
  min-height: 100vh;
  background:
    linear-gradient(90deg, transparent calc(50% - 0.5px), rgb(49 92 244 / 6%) 50%, transparent calc(50% + 0.5px)),
    var(--mist);
  color: var(--ink);
  font-size: 1rem;
  line-height: 1.6;
}

a {
  color: var(--cobalt-dark);
  text-underline-offset: 0.18em;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1,
h2,
h3 {
  font-family: var(--display);
  font-stretch: condensed;
  line-height: 1.02;
}

h1 {
  max-width: 13ch;
  margin-bottom: 1.25rem;
  font-size: clamp(3rem, 8vw, 6.5rem);
  font-weight: 800;
  letter-spacing: -0.055em;
}

h2 {
  margin-bottom: 0.75rem;
  font-size: clamp(1.65rem, 3vw, 2.35rem);
  letter-spacing: -0.035em;
}

h3 {
  font-size: 1.35rem;
  letter-spacing: -0.025em;
}

code,
.utility-label,
.eyebrow,
.step-label,
.status-chip,
.route-card code,
.project-number {
  font-family: var(--utility);
}

code {
  overflow-wrap: anywhere;
  font-size: 0.88em;
}

.skip-link {
  position: fixed;
  z-index: 20;
  top: 0.75rem;
  left: 0.75rem;
  padding: 0.65rem 0.9rem;
  translate: 0 -180%;
  background: var(--ink);
  color: var(--white);
}

.skip-link:focus {
  translate: 0;
}

.site-header {
  border-bottom: 1px solid rgb(18 24 38 / 14%);
  background: rgb(249 251 253 / 94%);
}

.header-inner,
.page-content,
.site-footer {
  width: min(76rem, calc(100% - 2.5rem));
  margin-inline: auto;
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  min-height: 5.25rem;
}

.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--ink);
  font-family: var(--display);
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1;
  text-decoration: none;
  letter-spacing: -0.03em;
}

.wordmark small {
  display: block;
  margin-top: 0.25rem;
  color: var(--muted);
  font-family: var(--utility);
  font-size: 0.58rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.wordmark-mark {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border-radius: 50%;
  background: var(--cobalt);
  color: var(--white);
  font-family: var(--utility);
  font-size: 1rem;
  box-shadow: inset 0 0 0 0.4rem rgb(255 255 255 / 14%);
}

.primary-nav {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.primary-nav a {
  padding: 0.55rem 0.75rem;
  border-radius: 0.4rem;
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 650;
  text-decoration: none;
}

.primary-nav a:hover {
  background: var(--mist);
  color: var(--ink);
}

.mode-ribbon {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(76rem, calc(100% - 2.5rem));
  margin: 1rem auto 0;
  overflow: hidden;
  border: 1px solid rgb(18 24 38 / 14%);
  border-radius: 0.7rem;
  background: var(--paper);
  box-shadow: 0 0.8rem 2.5rem rgb(24 39 75 / 7%);
}

.mode-ribbon > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.65rem;
  align-items: center;
  padding: 0.8rem 0.9rem;
}

.mode-ribbon > div + div {
  border-left: 1px solid var(--line);
}

.mode-ribbon strong {
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.35;
}

.status-native {
  background: #e7ecf4;
  color: #344154;
}

.status-enhanced {
  background: var(--mint-soft);
  color: var(--mint);
}

.status-refused {
  background: var(--amber-soft);
  color: var(--amber);
}

.guided-rail {
  width: min(76rem, calc(100% - 2.5rem));
  margin: 1rem auto 0;
}

.guided-rail ol {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
  border-block: 1px solid rgb(18 24 38 / 14%);
}

.guided-rail li + li {
  border-left: 1px solid rgb(18 24 38 / 14%);
}

.guided-rail a {
  display: grid;
  min-height: 3.7rem;
  padding: 0.7rem 0.8rem;
  color: var(--ink);
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.25;
  text-decoration: none;
}

.guided-rail a:hover {
  background: rgb(49 92 244 / 6%);
}

.guided-rail span {
  color: var(--cobalt);
  font-family: var(--utility);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
}

.page-content {
  min-height: calc(100vh - 12rem);
  padding-block: clamp(3rem, 7vw, 6.5rem);
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(22rem, 0.88fr);
  gap: clamp(2rem, 6vw, 5.5rem);
  align-items: start;
}

.hero-panel {
  padding-top: 1rem;
}

.eyebrow,
.utility-label,
.step-label {
  margin-bottom: 0.75rem;
  color: var(--cobalt-dark);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}

.hero-copy,
.lab-heading > p:last-child {
  max-width: 42rem;
  color: var(--muted);
  font-size: clamp(1.08rem, 2vw, 1.3rem);
}

.hero-actions,
.failure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block: 2rem;
}

.button-link,
button {
  display: inline-flex;
  min-height: 2.8rem;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.45rem;
  font: 700 0.9rem/1 var(--body);
  text-decoration: none;
  cursor: pointer;
}

.button-primary,
button {
  border-color: var(--cobalt);
  background: var(--cobalt);
  color: var(--white);
}

.button-primary:hover,
button:hover {
  border-color: var(--cobalt-dark);
  background: var(--cobalt-dark);
}

.button-secondary {
  border-color: var(--line);
  background: var(--white);
  color: var(--ink);
}

.button-warning {
  border-color: #e8bd79;
  background: var(--amber-soft);
  color: #6d3c00;
}

.button-danger {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}

.button-danger:hover {
  background: var(--danger);
  color: var(--white);
}

.native-note {
  color: var(--muted);
  font-size: 0.9rem;
}

.native-note span,
.status-dot {
  color: var(--mint);
}

.request-panel,
.form-card,
.reload-card,
.environment-banner,
.explain-strip,
.evidence-boundary {
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  background: var(--paper);
  box-shadow: 0 1.5rem 4rem rgb(24 40 72 / 8%);
}

.request-panel {
  overflow: hidden;
  border-top: 0.35rem solid var(--cobalt);
}

.request-panel-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid var(--line);
}

.request-panel-heading h2 {
  margin: 0;
  font-family: var(--utility);
  font-size: 1.1rem;
  letter-spacing: 0;
}

.utility-label {
  margin-bottom: 0.25rem;
  color: var(--muted);
  font-size: 0.64rem;
}

.status-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 0.3rem 0.55rem;
  border-radius: 99rem;
  font-size: 0.64rem;
  font-weight: 750;
  letter-spacing: 0.035em;
  text-transform: uppercase;
}

.status-success {
  background: var(--mint-soft);
  color: #07583d;
}

.request-thread {
  margin: 0;
  padding: 1.2rem 1.5rem 1.4rem 3.2rem;
  list-style: none;
}

.request-thread li {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3.15rem;
  align-items: start;
  padding-bottom: 1rem;
}

.request-thread li::before {
  content: "";
  position: absolute;
  top: 0.32rem;
  left: -1.75rem;
  width: 0.62rem;
  height: 0.62rem;
  border: 2px solid var(--cobalt);
  border-radius: 50%;
  background: var(--paper);
}

.request-thread li:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 0.95rem;
  bottom: -0.2rem;
  left: -1.42rem;
  width: 2px;
  background: var(--cobalt);
}

.request-thread strong {
  max-width: 55%;
  font-family: var(--utility);
  font-size: 0.78rem;
  text-align: right;
}

.thread-label {
  color: var(--muted);
  font-size: 0.88rem;
}

.request-thread .thread-outcome::before {
  border-color: var(--mint);
  background: var(--mint);
  box-shadow: 0 0 0 0.35rem var(--mint-soft);
}

.request-proof {
  margin: 0;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--line);
  background: var(--white);
  color: var(--muted);
  font-size: 0.82rem;
}

.feature-map {
  grid-column: 1 / -1;
  padding-top: clamp(2rem, 5vw, 4.5rem);
}

.section-heading {
  margin-bottom: 1.5rem;
}

.section-heading h2 {
  max-width: 22ch;
}

.feature-grid,
.route-grid,
.resource-proof-grid,
.workflow-grid {
  display: grid;
  gap: 1rem;
}

.feature-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.feature-link,
.route-card {
  display: flex;
  min-height: 13rem;
  flex-direction: column;
  padding: 1.35rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: var(--paper);
  color: var(--ink);
  text-decoration: none;
  transition: translate 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.feature-link:hover,
.route-card:hover {
  translate: 0 -0.25rem;
  border-color: var(--cobalt);
  box-shadow: 0 1rem 2.2rem rgb(33 58 112 / 10%);
}

.feature-link > span {
  margin-bottom: auto;
  color: var(--cobalt);
  font-family: var(--utility);
  font-size: 0.75rem;
}

.feature-link strong,
.route-card strong {
  margin-block: 2rem 0.45rem;
  font-family: var(--display);
  font-size: 1.55rem;
  letter-spacing: -0.03em;
}

.feature-link small,
.route-card span {
  color: var(--muted);
  font-size: 0.88rem;
}

.site-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding-block: 1.75rem;
  border-top: 1px solid rgb(18 24 38 / 14%);
  color: var(--muted);
  font-size: 0.85rem;
}

.site-footer p {
  margin: 0;
}

.lab-page {
  max-width: 70rem;
  margin-inline: auto;
}

.lab-heading {
  margin-bottom: clamp(2.5rem, 6vw, 5rem);
}

.lab-heading h1 {
  max-width: 15ch;
  font-size: clamp(2.8rem, 7vw, 5.5rem);
}

.route-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.route-card {
  min-height: 14rem;
}

.route-card code {
  color: var(--cobalt-dark);
  font-size: 0.68rem;
}

.route-warning {
  border-color: #e8bd79;
  background: var(--amber-soft);
}

.explain-strip {
  margin-top: 1rem;
  padding: 1.5rem;
}

.explain-strip p:last-child {
  margin-bottom: 0;
  color: var(--muted);
}

.resource-proof-grid,
.workflow-grid {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.72fr);
}

.reload-card,
.form-card,
.environment-banner {
  padding: clamp(1.5rem, 4vw, 2.25rem);
}

.reload-card p,
.form-card > p,
.environment-banner p {
  color: var(--muted);
}

.failure-lab {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 2rem;
  margin-top: 1rem;
  padding: clamp(1.5rem, 4vw, 2.5rem);
  border: 1px solid #e8bd79;
  border-radius: 0.8rem;
  background: var(--amber-soft);
}

.failure-lab > div:first-child {
  max-width: 38rem;
}

.failure-lab p:last-child {
  margin-bottom: 0;
  color: #6d4b1c;
}

.refusal-demo {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(18rem, 0.85fr);
  gap: 2rem;
  align-items: center;
  margin-top: 1rem;
  padding: clamp(1.25rem, 4vw, 2rem);
  border: 1px solid #e4bd76;
  border-radius: 0.75rem;
  background: var(--amber-soft);
}

.refusal-demo p:last-child,
.refusal-controls small {
  margin-bottom: 0;
  color: var(--muted);
}

.refusal-controls {
  display: grid;
  gap: 0.7rem;
}

.refusal-controls input {
  width: 100%;
}

.compact-thread {
  box-shadow: none;
}

.compact-thread > .utility-label,
.compact-thread > h2 {
  margin-inline: 1.5rem;
}

.compact-thread > .utility-label {
  margin-top: 1.5rem;
}

.environment-readonly {
  max-width: 48rem;
  border-color: #e8bd79;
  background: var(--amber-soft);
}

.form-stack {
  display: grid;
  gap: 0.7rem;
}

label {
  color: var(--ink);
  font-size: 0.88rem;
  font-weight: 700;
}

input {
  min-width: 0;
  min-height: 2.85rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #9ba9bc;
  border-radius: 0.4rem;
  background: var(--white);
  color: var(--ink);
  font: inherit;
}

input[type="checkbox"] {
  min-height: auto;
  accent-color: var(--cobalt);
}

input[aria-invalid="true"] {
  border-color: var(--danger);
  background: var(--danger-soft);
}

[role="alert"] {
  padding: 0.8rem 1rem;
  border-left: 0.3rem solid var(--danger);
  background: var(--danger-soft);
  color: #6f2025;
}

.create-card {
  max-width: 46rem;
  margin-bottom: 3rem;
}

#authenticated-viewer {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  border-radius: 99rem;
  background: var(--mint-soft);
  color: #07583d;
  font-size: 0.85rem;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: currentColor;
}

.inline-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.inline-heading h2,
.inline-heading p {
  margin-bottom: 0;
}

.project-list {
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-card {
  display: grid;
  grid-template-columns: minmax(13rem, 0.8fr) minmax(18rem, 1.2fr) auto;
  gap: 1.25rem;
  align-items: end;
  padding: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: var(--paper);
}

.project-summary {
  display: flex;
  gap: 0.8rem;
  align-items: start;
}

.project-number {
  display: grid;
  flex: none;
  width: 2.3rem;
  height: 2.3rem;
  place-items: center;
  border-radius: 50%;
  background: var(--mist);
  color: var(--cobalt-dark);
  font-size: 0.68rem;
}

.project-title {
  margin-bottom: 0.2rem;
}

.project-attachment {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}

.inline-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.inline-form label {
  grid-column: 1 / -1;
}

.delete-form {
  display: grid;
  gap: 0.6rem;
}

.delete-form label {
  white-space: nowrap;
}

.evidence-list {
  border-top: 1px solid var(--ink);
}

.evidence-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.55fr);
  gap: 2rem;
  align-items: center;
  padding-block: 1.5rem;
  border-bottom: 1px solid var(--line);
}

.evidence-row h2 {
  margin-block: 0.7rem 0.3rem;
  font-size: 1.5rem;
}

.evidence-row p {
  margin-bottom: 0;
  color: var(--muted);
}

.evidence-row > code {
  padding: 1rem;
  border-radius: 0.45rem;
  background: var(--ink);
  color: var(--white);
}

.evidence-boundary {
  margin-top: 1.5rem;
  padding: 1.25rem;
}

.evidence-boundary p {
  margin: 0.3rem 0 0;
  color: var(--muted);
}

.result-page {
  max-width: 52rem;
  padding: clamp(1.5rem, 5vw, 3rem);
  border: 1px solid var(--line);
  border-top: 0.35rem solid var(--cobalt);
  border-radius: 0.8rem;
  background: var(--paper);
  box-shadow: 0 1.5rem 4rem rgb(24 40 72 / 8%);
}

.result-page h1 {
  max-width: 12ch;
  font-size: clamp(2.8rem, 7vw, 5rem);
}

.result-page > p:not(.eyebrow),
.nested-result > p {
  max-width: 42rem;
  color: var(--muted);
}

.failure-result {
  border-top-color: var(--amber);
}

.recovery-result {
  border-top-color: var(--mint);
}

.result-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-block: 2rem;
}

.result-facts div {
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
}

.result-facts dt {
  color: var(--muted);
  font-size: 0.72rem;
}

.result-facts dd {
  margin: 0.25rem 0 0;
  font-family: var(--utility);
  font-size: 0.78rem;
  font-weight: 700;
}

.nested-result h2 {
  margin-top: 1.5rem;
}

main > section:not([class]),
main > p,
main > div > section:not([class]) {
  max-width: 52rem;
}

main > section:not([class]) {
  padding: 2rem;
  border: 1px solid var(--line);
  border-top: 0.35rem solid var(--cobalt);
  border-radius: 0.75rem;
  background: var(--paper);
}

.developer-panel {
  position: fixed;
  z-index: 12;
  right: 1.25rem;
  bottom: 1.25rem;
  width: min(31rem, calc(100% - 2.5rem));
  overflow: hidden;
  border: 1px solid rgb(18 24 38 / 20%);
  border-radius: 0.8rem;
  background: var(--paper);
  box-shadow: 0 1.4rem 4rem rgb(24 39 75 / 18%);
}

.developer-panel[open] {
  width: min(52rem, calc(100% - 2.5rem));
}

.developer-panel summary {
  display: grid;
  gap: 0.15rem;
  padding: 0.9rem 1rem;
  background: var(--ink);
  color: var(--white);
  cursor: pointer;
  font-weight: 750;
  list-style: none;
}

.developer-panel summary::-webkit-details-marker {
  display: none;
}

.developer-panel summary::before {
  content: "↳";
  position: absolute;
  right: 1rem;
  color: var(--cobalt);
  font-family: var(--utility);
}

.developer-panel[open] summary::before {
  content: "×";
}

.developer-panel summary small {
  color: #b9c4d8;
  font-family: var(--utility);
  font-size: 0.67rem;
  font-weight: 500;
}

.developer-panel-content {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(16rem, 0.9fr);
  gap: 1.25rem;
  max-height: min(65vh, 34rem);
  padding: 1rem;
  overflow: auto;
}

.developer-panel-content h2 {
  margin-bottom: 0.7rem;
  font-size: 1.2rem;
}

.developer-panel pre {
  margin: 0;
  padding: 1rem;
  overflow: auto;
  border-radius: 0.45rem;
  background: #0d1422;
  color: #dce6ff;
  font-size: 0.76rem;
  line-height: 1.55;
}

.developer-panel ol {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--muted);
  font-size: 0.86rem;
}

.developer-panel li + li {
  margin-top: 0.55rem;
}

.developer-boundary {
  margin: 1rem 0 0;
  padding-top: 0.8rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.75rem;
}

a:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 3px solid var(--amber);
  outline-offset: 3px;
}

@media (max-width: 64rem) {
  .header-inner {
    align-items: start;
    flex-direction: column;
    gap: 1rem;
    padding-block: 1rem;
  }

  .primary-nav {
    width: 100%;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }

  .overview-grid,
  .resource-proof-grid,
  .workflow-grid,
  .refusal-demo {
    grid-template-columns: 1fr;
  }

  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .route-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .project-card {
    grid-template-columns: 1fr 1fr;
  }

  .project-summary {
    grid-column: 1 / -1;
  }

  .developer-panel,
  .developer-panel[open] {
    position: static;
    width: 100%;
    margin-top: 2rem;
  }

  .developer-panel-content {
    grid-template-columns: 1fr;
    max-height: none;
  }
}

@media (max-width: 42rem) {
  .header-inner,
  .page-content,
  .site-footer,
  .mode-ribbon,
  .guided-rail {
    width: min(100% - 1.25rem, 76rem);
  }

  .primary-nav {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow-x: visible;
  }

  .primary-nav a {
    padding-inline: 0.55rem;
    text-align: center;
    white-space: nowrap;
  }

  .mode-ribbon {
    grid-template-columns: 1fr;
  }

  .mode-ribbon > div + div {
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .guided-rail {
    overflow-x: auto;
  }

  .guided-rail ol {
    min-width: 42rem;
  }

  .page-content {
    padding-block: 2.5rem;
  }

  h1,
  .lab-heading h1 {
    font-size: clamp(2.7rem, 15vw, 4.4rem);
  }

  .feature-grid,
  .route-grid,
  .project-card,
  .evidence-row,
  .result-facts {
    grid-template-columns: 1fr;
  }

  .feature-link,
  .route-card {
    min-height: 11rem;
  }

  .failure-lab,
  .site-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .failure-actions,
  .hero-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .button-link {
    width: 100%;
  }

  .request-thread {
    padding-left: 2.8rem;
  }

  .project-summary {
    grid-column: auto;
  }

  .inline-form {
    grid-template-columns: 1fr;
  }

  .inline-form label {
    grid-column: auto;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --mist: #0f1521;
    --paper: #171f2d;
    --white: #202b3d;
    --ink: #f4f7fb;
    --muted: #b5c0d2;
    --line: #3b485d;
    --cobalt: #6f8cff;
    --cobalt-dark: #a9b9ff;
    --mint: #4dd0a1;
    --mint-soft: #123d32;
    --amber: #ffc46b;
    --amber-soft: #3a2b15;
    --danger: #ff8e96;
    --danger-soft: #48262b;
  }

  .site-header {
    background: rgb(23 31 45 / 94%);
  }

  .status-success,
  #authenticated-viewer {
    color: #bdf5df;
  }

  .button-warning,
  .failure-lab p:last-child {
    color: #ffe0ac;
  }

  [role="alert"] {
    color: #ffc4c8;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`.trimStart();
