import type { Layout } from "fadeno-framework-internal";

const layout: Layout = ({ children }) => (
  <section aria-labelledby="admin-area-heading">
    <h1 id="admin-area-heading">Administration</h1>
    {children}
  </section>
);

export default layout;
