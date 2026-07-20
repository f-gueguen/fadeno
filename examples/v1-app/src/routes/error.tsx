import type { ErrorPage } from "@fadeno/framework";

const errorPage: ErrorPage = ({ incidentId, resourceError }) => resourceError ? (
  <section aria-labelledby="resource-error-heading" class="result-page failure-result">
    <p class="eyebrow">Typed resource outcome · {resourceError.status}</p>
    <h1 id="resource-error-heading">Project unavailable</h1>
    <p><code>{resourceError.code} ({resourceError.status})</code></p>
    <p>This typed outcome was safe to render through the route error boundary. No internal incident was created.</p>
    <div class="hero-actions"><a class="button-link button-secondary" href="/resources">Back to resources</a><a class="button-link button-primary" href="/resource-recovery">Try recovery</a></div>
  </section>
) : (
  <section aria-labelledby="error-heading" class="result-page failure-result">
    <p class="eyebrow">Controlled server failure · 500</p>
    <h1 id="error-heading">The page could not be rendered</h1>
    <p><code>Incident {incidentId}</code> links this public response to private operational evidence without exposing the failure detail.</p>
    <a class="button-link button-secondary" href="/routing">Back to routing lab</a>
  </section>
);

export default errorPage;
