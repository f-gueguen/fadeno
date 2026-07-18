export const applicationStyles = `
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

* { box-sizing: border-box; }
body.app-shell { margin: 0; min-height: 100vh; line-height: 1.6; }
.primary-nav, .page-content, .site-footer { width: min(60rem, calc(100% - 2rem)); margin-inline: auto; }
.site-header, .site-footer { padding-block: 1rem; background: #18233a; color: #fff; }
.page-content { padding-block: 3rem; }
.hero-card { padding: 2rem; border: 1px solid #cbd3e1; border-radius: 1rem; }
a:focus-visible { outline: 3px solid #d45d00; outline-offset: 3px; }
`.trimStart();
