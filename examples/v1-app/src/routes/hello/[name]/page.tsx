import type { Page } from "@fadeno/framework";

const page: Page = ({ parameters }) => {
  const name = parameters["name"];
  if (typeof name !== "string") throw new TypeError("FADENO_EXAMPLE_NAME_PARAMETER");
  return (
    <section aria-labelledby="greeting-heading" class="result-page">
      <p class="eyebrow">Routing result · 200 HTML</p>
      <h1 id="greeting-heading">Hello {name}</h1>
      <p>The dynamic URL parameter is rendered as escaped HTML text inside the root layout.</p>
      <dl class="result-facts"><div><dt>Matched route</dt><dd>/hello/:name</dd></div><div><dt>Layout</dt><dd>root</dd></div><div><dt>Outcome</dt><dd>streamed document</dd></div></dl>
      <a class="button-link button-secondary" href="/routing">Back to routing lab</a>
    </section>
  );
};

export default page;
