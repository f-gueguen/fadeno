import type { NotFoundPage } from "fadeno-framework-internal";

const notFoundPage: NotFoundPage = () => (
  <section aria-labelledby="missing-heading">
    <h1 id="missing-heading">Page not found</h1>
    <a href="/">Return home</a>
  </section>
);

export default notFoundPage;
