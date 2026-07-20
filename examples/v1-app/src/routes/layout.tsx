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
      <main class="page-content" id="main-content">{children}</main>
      <footer class="site-footer">
        <p><strong>Server-owned by default.</strong> Links, forms, and documents remain useful without client JavaScript.</p>
        <a href="/evidence">Reproduce the evidence</a>
      </footer>
    </body>
  </html>
);

export default layout;
