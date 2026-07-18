import type { Layout } from "@fadeno/framework";

const layout: Layout = ({ children }) => (
  <html lang="en">
    <head>
      <title>my-fadeno-app</title>
      <link href="/styles" rel="stylesheet" type="text/css" />
    </head>
    <body class="app-shell">
      <header class="site-header">
        <nav aria-label="Primary" class="primary-nav"><a href="/">Home</a></nav>
      </header>
      <main class="page-content">{children}</main>
      <footer class="site-footer">Rendered by Fadeno</footer>
    </body>
  </html>
);

export default layout;
