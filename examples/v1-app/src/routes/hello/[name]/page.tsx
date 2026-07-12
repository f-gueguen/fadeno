import type { Page } from "fadeno-framework-internal";

const page: Page = ({ parameters }) => {
  const name = parameters["name"];
  if (typeof name !== "string") throw new TypeError("FADENO_EXAMPLE_NAME_PARAMETER");
  return (
    <section aria-labelledby="greeting-heading">
      <h1 id="greeting-heading">Hello {name}</h1>
      <p>The route parameter is rendered as HTML text.</p>
    </section>
  );
};

export default page;
