import type { NotFoundPage } from "@fadeno/framework";

const notFoundPage: NotFoundPage = () => (
  <div class="nested-result">
    <h2>Administrative page not found</h2>
    <p>The nearest scoped not-found page handled this missing administration URL.</p>
    <dl class="result-facts"><div><dt>Scope</dt><dd>/admin</dd></div><div><dt>Status</dt><dd>404</dd></div><div><dt>Fallback</dt><dd>admin/not-found</dd></div></dl>
    <a class="button-link button-secondary" href="/routing">Back to routing lab</a>
  </div>
);

export default notFoundPage;
