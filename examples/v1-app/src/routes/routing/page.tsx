import type { Page } from "@fadeno/framework";
import { DeveloperPanel } from "../../components/developer-panel.tsx";

const page: Page = ({ request }) => {
  const refused = new URL(request.url).searchParams.get("outcome") === "dirty-control";
  return (
    <div class="lab-page">
    <header class="lab-heading">
      <p class="eyebrow">Routing laboratory</p>
      <h1>URLs select typed server outcomes.</h1>
      <p>Open each real route and compare its URL, status, selected layout, and response type. Deliberate failures are isolated, so the main application remains buildable.</p>
    </header>
    <div class="route-grid">
      <a class="route-card" href="/hello/Reader"><code>200 · /hello/:name</code><strong>Dynamic parameter</strong><span>Renders escaped route text for “Reader.”</span></a>
      <a class="route-card" href="/admin/dashboard"><code>200 · nested layout</code><strong>Administration</strong><span>Composes the root and scoped admin layouts.</span></a>
      <a class="route-card" href="/admin/missing"><code>404 · scoped fallback</code><strong>Admin not found</strong><span>Selects the nearest route-owned 404 page.</span></a>
      <a class="route-card" href="/moved"><code>303 · redirect</code><strong>Moved route</strong><span>Redirects to a typed greeting destination.</span></a>
      <a class="route-card" href="/raw"><code>200 · text/plain</code><strong>Raw response</strong><span>Leaves document rendering through a typed handler.</span></a>
      <a class="route-card route-warning" href="/failure"><code>500 · controlled failure</code><strong>Incident response</strong><span>Shows a public incident ID without private failure details.</span></a>
    </div>
    <section class="explain-strip" aria-labelledby="routing-explanation">
      <p class="utility-label">What changed?</p>
      <h2 id="routing-explanation">The URL owns the route; the route owns the outcome.</h2>
      <p>No client router is required. Use Back after each example to return to this laboratory.</p>
    </section>
    <section aria-labelledby="refusal-heading" class="refusal-demo">
      <div>
        <p class="eyebrow">Safe refusal laboratory</p>
        <h2 id="refusal-heading">{refused ? "Refused safely. Native navigation completed." : "Make browser-owned state unsafe."}</h2>
        <p>{refused
          ? "The draft made in the previous document was not silently reconciled. The browser loaded this complete current document through the native path."
          : "Type into the draft field, then follow the link. Before V2-08, a dirty control keeps the interaction native instead of risking silent state loss."}</p>
      </div>
      <div class="refusal-controls">
        <label for="refusal-draft">Unsaved browser draft</label>
        <input id="refusal-draft" name="refusal-draft" type="text" placeholder="Type before continuing" />
        <a class="button-link button-warning" href="/routing?outcome=dirty-control">Try the guarded navigation</a>
        <small>Correction: clear the draft first when you want the eligible enhanced path.</small>
      </div>
    </section>
    <DeveloperPanel
      source="src/routes/hello/[name]/page.tsx"
      code={'const page: Page = ({ parameters }) => (\n  <h1>Hello {parameters["name"]}</h1>\n);'}
      explanation={[
        "The generated route matcher selects the parameterized page.",
        "The decoded name becomes ordinary escaped JSX text.",
        "The root layout wraps the page before the response streams.",
        "A raw handler or typed redirect stays an explicit route outcome.",
      ]}
    />
  </div>
  );
};

export default page;
