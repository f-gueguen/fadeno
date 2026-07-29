import type { RenderChild } from "@fadeno/framework";
import { DeveloperPanel } from "./developer-panel.tsx";

export type OverviewEvidence = Readonly<{
  executionId: string;
  projectId: number;
  viewer: string;
}>;

export function Overview({
  evidence,
  greetingHref,
}: Readonly<{
  evidence: OverviewEvidence;
  greetingHref: string;
}>): RenderChild {
  return (
    <div class="overview-grid">
      <section aria-labelledby="welcome-heading" class="hero-panel">
        <p class="eyebrow">One server response · visible from cause to outcome</p>
        <h1 id="welcome-heading">Follow the request thread.</h1>
        <p class="hero-copy">Fadeno keeps the document, its data, and its recovery path on the server. This page makes that ownership visible without exposing private framework machinery.</p>
        <div class="hero-actions">
          <a class="button-link button-primary" href={greetingHref}>Try a typed route</a>
          <a class="button-link button-secondary" href="/projects">Open the project workflow</a>
        </div>
        <p class="native-note"><span aria-hidden="true">●</span> Native HTML baseline. No client JavaScript is required.</p>
      </section>

      <section aria-labelledby="thread-heading" class="request-panel">
        <div class="request-panel-heading">
          <div>
            <p class="utility-label">Current response</p>
            <h2 id="thread-heading">GET /</h2>
          </div>
          <span class="status-chip status-success">200 HTML</span>
        </div>
        <ol class="request-thread">
          <li><span class="thread-label">Route matched</span><strong>/</strong></li>
          <li><span class="thread-label">Resource calls</span><strong>2</strong></li>
          <li><span class="thread-label">Loader executions</span><strong>1 · shared</strong></li>
          <li><span class="thread-label">Viewer</span><strong>{evidence.viewer}</strong></li>
          <li><span class="thread-label">Rendering</span><strong>escaped · streamed</strong></li>
          <li class="thread-outcome"><span class="thread-label">Observable outcome</span><strong>Project {evidence.projectId} ready</strong></li>
        </ol>
        <p class="request-proof">Project {evidence.projectId} is ready for {evidence.viewer}. Equivalent resource reads shared one request result. Execution <code>{evidence.executionId}</code> was created once for this response.</p>
      </section>

      <section aria-labelledby="feature-map-heading" class="feature-map">
        <div class="section-heading">
          <p class="eyebrow">Explore by outcome</p>
          <h2 id="feature-map-heading">What the running application proves</h2>
        </div>
        <div class="feature-grid">
          <a class="feature-link" href="/routing"><span>01</span><strong>Routing</strong><small>Parameters, layouts, redirects, 404s, errors, and raw responses.</small></a>
          <a class="feature-link" href="/resources"><span>02</span><strong>Resources</strong><small>One request owner, shared reads, typed failures, and clean recovery.</small></a>
          <a class="feature-link" href="/projects"><span>03</span><strong>Actions &amp; sessions</strong><small>Protected sign-in, validation, upload, CRUD, replay refusal, and revalidation.</small></a>
          <a class="feature-link" href="/evidence"><span>04</span><strong>Build &amp; recovery</strong><small>Reproducible commands for last-good output, cleanup, and browser qualification.</small></a>
        </div>
      </section>
      <DeveloperPanel
        source="src/routes/page.tsx"
        excerpt="overview"
        explanation={[
          "The URL selects the page and root layout.",
          "Equivalent resource inputs share one request-owned result.",
          "The renderer publishes one complete escaped document.",
          "The optional runtime may enhance only an eligible next interaction.",
        ]}
      />
    </div>
  );
}
