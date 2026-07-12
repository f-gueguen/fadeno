import type { Page } from "fadeno-framework-internal";

const page: Page = () => (
  <section aria-labelledby="welcome-heading">
    <h1 id="welcome-heading">First running Fadeno application</h1>
    <p>This document is routed, escaped, and streamed without client JavaScript.</p>
    <a href="/hello/Reader">Open the parameterized greeting</a>
  </section>
);

export default page;
