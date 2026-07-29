import type { Layout } from "@fadeno/framework";

const layout: Layout = ({ children }) => (
  <html lang="en">
    <head>
      <title>Fadeno live application lab</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link href="/styles" rel="stylesheet" type="text/css" />
    </head>
    <body class="app-shell">
      <a class="skip-link" href="#main-content">Skip to the demonstration</a>
      <header class="site-header">
        <div class="header-inner">
          <a class="wordmark" href="/" aria-label="Fadeno application lab home">
            <span class="wordmark-mark" aria-hidden="true">F</span>
            <span>Fadeno <small>live application lab</small></span>
          </a>
          <nav aria-label="Primary" class="primary-nav">
            <a href="/">Overview</a>
            <a href="/routing">Routing</a>
            <a href="/resources">Resources</a>
            <a href="/projects">Projects</a>
            <a href="/evidence">Evidence</a>
          </nav>
        </div>
      </header>
      <section aria-label="Interaction ownership" class="mode-ribbon">
        <div>
          <span class="status-chip status-native">Native</span>
          <strong>Every link and form has a complete server path.</strong>
        </div>
        <div>
          <span class="status-chip status-enhanced">Enhanced</span>
          <strong id="demo-enhancement-status">Native mode remains active until the optional runtime starts.</strong>
        </div>
        <div>
          <span class="status-chip status-refused">Refused safely</span>
          <strong>Unsafe state stays native until structural reconciliation is qualified.</strong>
        </div>
      </section>
      <nav aria-label="Guided demonstration" class="guided-rail">
        <ol>
          <li><a href="/"><span>01</span>Observe one request</a></li>
          <li><a href="/routing"><span>02</span>Change the route</a></li>
          <li><a href="/resources"><span>03</span>Share one read</a></li>
          <li><a href="/projects"><span>04</span>Run an action</a></li>
          <li><a href="/resource-recovery"><span>05</span>Recover fresh truth</a></li>
        </ol>
      </nav>
      <main class="page-content" id="main-content">{children}</main>
      <footer class="site-footer">
        <p><strong>Server-owned by default.</strong> Links, forms, and documents remain useful without client JavaScript.</p>
        <a href="/evidence">Reproduce the evidence</a>
      </footer>
    </body>
  </html>
);

export default layout;
