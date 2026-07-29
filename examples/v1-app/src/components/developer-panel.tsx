import type { RenderChild } from "@fadeno/framework";
import { demoSourceExcerpts, type DemoSourceExcerpt } from "../generated/demo-source-excerpts.ts";

export function DeveloperPanel({
  source,
  excerpt,
  explanation,
}: Readonly<{
  source: string;
  excerpt: DemoSourceExcerpt;
  explanation: readonly string[];
}>): RenderChild {
  return (
    <details class="developer-panel">
      <summary>
        <span>View source &amp; request explanation</span>
        <small>{source}</small>
      </summary>
      <div class="developer-panel-content">
        <section aria-labelledby="developer-source-heading">
          <p class="utility-label">Application source</p>
          <h2 id="developer-source-heading">{source}</h2>
          <pre><code>{demoSourceExcerpts[excerpt]}</code></pre>
        </section>
        <section aria-labelledby="developer-explanation-heading">
          <p class="utility-label">What happens</p>
          <h2 id="developer-explanation-heading">Ownership stays visible.</h2>
          <ol>
            {explanation.map((step) => <li>{step}</li>)}
          </ol>
          <p class="developer-boundary">This panel explains public application behavior. It does not expose private transport, analyzer, or session records.</p>
        </section>
      </div>
    </details>
  );
}
