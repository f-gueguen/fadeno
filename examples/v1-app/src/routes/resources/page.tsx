import type { Page } from "@fadeno/framework";
import { DeveloperPanel } from "../../components/developer-panel.tsx";
import { projectSummary } from "../../resources/projects.ts";

const page: Page = async ({ read }) => {
  const [first, second] = await Promise.all([
    read(projectSummary, { projectId: 21, region: "east" }),
    read(projectSummary, { region: "east", projectId: 21 }),
  ]);
  if (first !== second) throw new Error("resource laboratory lost request ownership");

  return (
    <div class="lab-page">
      <header class="lab-heading">
        <p class="eyebrow">Resource laboratory</p>
        <h1>Two reads. One request-owned result.</h1>
        <p>The page asks for equivalent data twice. Fadeno owns one loader execution for this response, reuses the same frozen value, then forgets it when the request ends.</p>
      </header>
      <div class="resource-proof-grid">
        <section class="request-panel" aria-labelledby="resource-thread-heading">
          <div class="request-panel-heading"><div><p class="utility-label">Current response</p><h2 id="resource-thread-heading">GET /resources</h2></div><span class="status-chip status-success">shared</span></div>
          <ol class="request-thread">
            <li><span class="thread-label">Read calls</span><strong>2</strong></li>
            <li><span class="thread-label">Structural inputs</span><strong>equivalent</strong></li>
            <li><span class="thread-label">Loader executions</span><strong>1</strong></li>
            <li><span class="thread-label">Object identity</span><strong>same frozen result</strong></li>
            <li class="thread-outcome"><span class="thread-label">Execution</span><strong>{first.executionId}</strong></li>
          </ol>
        </section>
        <section class="reload-card" aria-labelledby="request-boundary-heading">
          <p class="utility-label">Try it</p>
          <h2 id="request-boundary-heading">Reload this page.</h2>
          <p>The execution label changes because a reload creates a new request owner. It never reuses this request’s value across viewers.</p>
          <a class="button-link button-primary" href="/resources">Start a new request</a>
        </section>
      </div>
      <section class="failure-lab" aria-labelledby="resource-failure-heading">
        <div><p class="eyebrow">Failure and recovery</p><h2 id="resource-failure-heading">Expected failures stay typed and local.</h2><p>Start a recovering request after the deliberate 404. The first recovery visit returns 503; the next request succeeds without a stale error.</p></div>
        <div class="failure-actions">
          <a class="button-link button-warning" href="/resource-failure">Open typed 404</a>
          <a class="button-link button-secondary" href="/resource-recovery">Start 503 → recovery</a>
        </div>
      </section>
      <DeveloperPanel
        source="src/routes/resources/page.tsx"
        code={'const [first, second] = await Promise.all([\n  read(projectSummary, input),\n  read(projectSummary, equivalentInput),\n]);\n\nif (first !== second) throw new Error();'}
        explanation={[
          "The page asks for the same structural resource input twice.",
          "One request scope owns the shared promise and frozen value.",
          "A reload creates a new request scope and a new execution.",
          "Typed failure and recovery never reuse the previous request result.",
        ]}
      />
    </div>
  );
};

export default page;
