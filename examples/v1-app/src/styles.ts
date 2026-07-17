export const applicationStyles = `
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body.app-shell {
  margin: 0;
  min-height: 100vh;
  background: #f4f6fb;
  color: #1d2433;
  line-height: 1.6;
}

.site-header,
.site-footer {
  background: #18233a;
  color: #ffffff;
}

.primary-nav,
.page-content,
.site-footer {
  width: min(60rem, calc(100% - 2rem));
  margin-inline: auto;
}

.primary-nav {
  display: flex;
  gap: 1rem;
  padding-block: 1rem;
}

.primary-nav a,
.site-footer a {
  color: inherit;
}

.page-content {
  padding-block: 3rem;
}

.hero-card {
  padding: clamp(1.5rem, 4vw, 3rem);
  border: 1px solid #cbd3e1;
  border-radius: 1rem;
  background: #ffffff;
  box-shadow: 0 1rem 2.5rem rgb(24 35 58 / 10%);
}

.site-footer {
  padding-block: 1rem;
}

a:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 3px solid #d45d00;
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto;
  }
}

@media (prefers-color-scheme: dark) {
  body.app-shell {
    background: #111827;
    color: #edf2f7;
  }

  .hero-card {
    border-color: #475569;
    background: #1e293b;
    box-shadow: none;
  }
}
`.trimStart();
