import type { ErrorPage } from "@fadeno/framework";

const errorPage: ErrorPage = ({ incidentId, resourceError }) => resourceError ? (
  <section aria-labelledby="resource-error-heading">
    <h1 id="resource-error-heading">Project unavailable</h1>
    <p>{resourceError.code} ({resourceError.status})</p>
  </section>
) : (
  <section aria-labelledby="error-heading">
    <h1 id="error-heading">The page could not be rendered</h1>
    <p>Incident {incidentId}</p>
  </section>
);

export default errorPage;
