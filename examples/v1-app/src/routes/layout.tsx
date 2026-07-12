import type { Layout } from "fadeno-framework-internal";

const layout: Layout = ({ children }) => (
  <html lang="en">
    <head>
      <title>Fadeno V1 application</title>
    </head>
    <body>
      <header>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/hello/Fadeno">Greeting</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer>Rendered by the V1 framework</footer>
    </body>
  </html>
);

export default layout;
