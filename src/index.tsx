import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import api from './api'

export type Env = { DB: D1Database }

const app = new Hono<{ Bindings: Env }>()

// API first
app.route('/api', api)

const shell = (title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="Track who has submitted their individual training reports." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/static/style.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%93%8B</text></svg>" />
</head>
<body>
  <div id="gate" class="gate" hidden>
    <form class="gate-card" id="gate-form">
      <div class="gate-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      </div>
      <h1>Training Report Tracker</h1>
      <p>This tracker is protected. Enter your team access code to continue.</p>
      <label for="gate-code">Access code</label>
      <input id="gate-code" type="password" autocomplete="current-password" required />
      <p class="gate-error" id="gate-error" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">Unlock</button>
    </form>
  </div>

  <div id="shell" hidden>
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H16l4 4v11.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z"/><path d="M8 12h8M8 16h5"/></svg>
        </span>
        <div>
          <strong>Report Tracker</strong>
          <small id="brand-org">Training submissions</small>
        </div>
      </div>

      <nav class="nav" aria-label="Main">
        <a href="#/dashboard" data-view="dashboard"><i data-i="dashboard"></i>Dashboard</a>
        <a href="#/tracker" data-view="tracker"><i data-i="tracker"></i>Submission tracker</a>
        <a href="#/programmes" data-view="programmes"><i data-i="tracker"></i>Programme assignments</a>
        <a href="#/history" data-view="history"><i data-i="roster"></i>Staff training history</a>
        <a href="#/inbox" data-view="inbox"><i data-i="inbox"></i>Unmatched<span class="pill" id="nav-inbox-count" hidden>0</span></a>
        <a href="#/roster" data-view="roster"><i data-i="roster"></i>Staff roster</a>
        <a href="#/setup" data-view="setup"><i data-i="setup"></i>Forms connection</a>
        <a href="#/settings" data-view="settings"><i data-i="settings"></i>Settings</a>
      </nav>

      <div class="sidebar-foot">
        <div class="period-switch">
          <label for="period-picker">Reporting period</label>
          <select id="period-picker"></select>
        </div>
        <a class="foot-link" href="#/setup">+ New period</a>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h2 id="page-title">Dashboard</h2>
          <p id="page-sub" class="page-sub"></p>
        </div>
        <div class="topbar-actions" id="topbar-actions"></div>
      </header>
      <div id="view" class="view"></div>
    </main>
  </div>

  <div id="toast" class="toast" hidden></div>
  <script src="/static/app.js"></script>
</body>
</html>`

app.get('/', (c) => c.html(shell('Training Report Tracker')))

// Anything that is not an API route renders the app shell (hash routing).
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api')) return c.notFound()
  // Let Pages serve real static files; fall back to the shell for app routes.
  const assets = (c.env as any)?.ASSETS
  if (assets && /\.[a-zA-Z0-9]{2,5}$/.test(c.req.path)) {
    const res = await assets.fetch(c.req.raw)
    if (res.status !== 404) return res
  }
  return c.html(shell('Training Report Tracker'))
})

export default app
