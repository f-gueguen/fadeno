import type { NotFoundPage } from "@fadeno/framework";

const notFoundPage: NotFoundPage = () => (
  <section class="result-page"><p class="eyebrow">Scoped routing result · 404</p><h1>Shop page not found</h1><p>The shop scope selected its own fallback.</p><a class="button-link button-secondary" href="/routing">Back to routing lab</a></section>
);

export default notFoundPage;
