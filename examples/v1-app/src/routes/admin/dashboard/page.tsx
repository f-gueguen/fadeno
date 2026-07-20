import type { Page } from "@fadeno/framework";

const page: Page = () => (
  <div class="nested-result">
    <h2>Administrative dashboard</h2>
    <p>The root document and the scoped administration layout both wrapped this page.</p>
    <dl class="result-facts"><div><dt>Matched route</dt><dd>/admin/dashboard</dd></div><div><dt>Layouts</dt><dd>root → admin</dd></div><div><dt>Status</dt><dd>200</dd></div></dl>
    <a class="button-link button-secondary" href="/routing">Back to routing lab</a>
  </div>
);

export default page;
