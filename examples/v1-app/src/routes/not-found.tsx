import type { NotFoundPage } from "@fadeno/framework";

const notFoundPage: NotFoundPage = () => (
  <section aria-labelledby="missing-heading" class="result-page">
    <p class="eyebrow">Routing result · 404</p>
    <h1 id="missing-heading">Page not found</h1>
    <p>No more specific route or scoped fallback owned this URL.</p>
    <a class="button-link button-secondary" href="/routing">Return to routing lab</a>
  </section>
);

export default notFoundPage;
