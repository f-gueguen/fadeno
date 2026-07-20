import type { Layout } from "@fadeno/framework";

const layout: Layout = ({ children }) => (
  <section aria-labelledby="admin-area-heading" class="result-page scoped-layout">
    <p class="eyebrow">Nested layout active</p>
    <h1 id="admin-area-heading">Administration</h1>
    {children}
  </section>
);

export default layout;
