import type { Page } from "@fadeno/framework";

const page: Page = () => (
  <section aria-labelledby="welcome-heading" class="hero-card">
    <h1 id="welcome-heading">Your Fadeno application is running</h1>
    <p>This routed document is rendered and streamed by the server.</p>
    <p>It remains usable without client JavaScript.</p>
  </section>
);

export default page;
