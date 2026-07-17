import type { Layout } from "fadeno-framework-internal";

const layout: Layout = ({ children }) => (
  <html lang="en">
    <head>
      <title>Fadeno V1 application</title>
      <link href="/styles" rel="stylesheet" type="text/css" />
    </head>
    <body class="app-shell">
      <header class="site-header">
        <nav aria-label="Primary" class="primary-nav">
          <a href="/">Home</a>
          <a href="/hello/Fadeno">Greeting</a>
        </nav>
      </header>
      <main class="page-content">{children}</main>
      <footer class="site-footer">Rendered by the V1 framework</footer>
    </body>
  </html>
);

export default layout;
