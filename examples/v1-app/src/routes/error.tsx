import type { ErrorPage } from "fadeno-framework-internal";

const errorPage: ErrorPage = ({ incidentId }) => (
  <section aria-labelledby="error-heading">
    <h1 id="error-heading">The page could not be rendered</h1>
    <p>Incident {incidentId}</p>
  </section>
);

export default errorPage;
