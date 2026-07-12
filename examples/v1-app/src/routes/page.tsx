import type { Page } from "fadeno-framework-internal";
import { routeHref } from "fadeno:routes";

const greetingHref = routeHref({ route: "/hello/[name]", parameters: { name: "Reader" } });

const page: Page = () => (
  <section aria-labelledby="welcome-heading">
    <h1 id="welcome-heading">First running Fadeno application</h1>
    <p>This document is routed, escaped, and streamed without client JavaScript.</p>
    <a href={greetingHref}>Open the parameterized greeting</a>
  </section>
);

export default page;
