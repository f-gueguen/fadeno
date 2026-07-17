import type { Page } from "fadeno-framework-internal";

const page: Page = () => (
  <section style="padding: 2rem">
    <h1>CSS boundary</h1>
    <p>Inline CSS should be refused.</p>
  </section>
);

export default page;
