/* ------------------------------------------------------------------
   Training Report Tracker — client
   ------------------------------------------------------------------ */
'use strict'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const ICONS = {
  dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
  tracker: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  roster: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  setup: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
}

const ico = (name, size) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${
    size ? ` style="width:${size}px;height:${size}px"` : ''
  }>${ICONS[name] || ''}</svg>`

/* ---------------- state ---------------- */
const state = {
  periods: [],
  periodId: null,
  view: 'dashboard',
  session: { locked: false, org_name: '' },
  staff: [],
  filters: { q: '', team: '', status: 'all' },
  settings: {},
}

/* ---------------- api ---------------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof Blob) && typeof opts.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}))
    if (data.error === 'locked') {
      showGate()
      throw new Error('locked')
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || data.message || `Request failed (${res.status})`)
  }
  return res.json()
}

let toastTimer
function toast(msg, isError) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.toggle('err', !!isError)
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), 3400)
}

/* ---------------- formatting ---------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmtDate(iso)}, ${hh}:${mm}`
}
function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return fmtDate(iso)
}
function initials(name) {
  return String(name || '?')
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase()
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

const currentPeriod = () => state.periods.find((p) => p.id === Number(state.periodId)) || null

/* ---------------- gate ---------------- */
function showGate() {
  $('#gate').hidden = false
  $('#shell').hidden = true
  setTimeout(() => $('#gate-code')?.focus(), 50)
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const code = $('#gate-code').value
  const err = $('#gate-error')
  err.hidden = true
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    })
    const data = await r.json()
    if (!r.ok || !data.ok) throw new Error(data.message || 'Incorrect code')
    await boot()
  } catch (ex) {
    err.textContent = ex.message
    err.hidden = false
  }
})

/* ---------------- boot / routing ---------------- */
async function boot() {
  state.session = await api('/session')
  if (state.session.locked) {
    // probe: the session call is public, so test a protected endpoint
    try {
      await api('/periods')
    } catch (e) {
      if (e.message === 'locked') return
    }
  }
  $('#gate').hidden = true
  $('#shell').hidden = false

  const [periodsRes, settingsRes] = await Promise.all([api('/periods'), api('/settings')])
  state.periods = periodsRes.periods || []
  state.settings = settingsRes.settings || {}

  if (!state.periodId && state.periods.length) {
    const open = state.periods.find((p) => p.status === 'open')
    state.periodId = (open || state.periods[0]).id
  }
  if (state.session.org_name || state.settings.org_name) {
    $('#brand-org').textContent = state.session.org_name || state.settings.org_name
  }
  renderPeriodPicker()
  await refreshBadges()

  const hash = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard'
  navigate(hash, true)
}

function renderPeriodPicker() {
  const sel = $('#period-picker')
  sel.innerHTML = state.periods
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === Number(state.periodId) ? ' selected' : ''}>${esc(p.name)}${
          p.status === 'closed' ? ' (closed)' : ''
        }</option>`
    )
    .join('')
  sel.hidden = !state.periods.length
}

async function refreshBadges() {
  try {
    const { unmatched } = await api('/unmatched')
    const n = (unmatched || []).length
    const pill = $('#nav-inbox-count')
    pill.textContent = n
    pill.hidden = n === 0
  } catch (_) {}
}

const ROUTES = {
  dashboard: { title: 'Dashboard', sub: 'Who has submitted, at a glance', render: renderDashboard },
  tracker: { title: 'Submission tracker', sub: 'Every staff member and their report status', render: renderTracker },
  programmes: { title: 'Programme assignments', sub: 'Manage assignments and outstanding reports', render: renderProgrammes },
  history: { title: 'Staff training history', sub: 'A consolidated record of training programmes reported by staff', render: renderTrainingHistory },
  inbox: { title: 'Unmatched responses', sub: 'Submissions we could not attribute to anyone on the roster', render: renderInbox },
  roster: { title: 'Staff roster', sub: 'The people required to submit reports', render: renderRoster },
  setup: { title: 'Forms connection', sub: 'Connect your Microsoft Form so submissions record themselves', render: renderSetup },
  settings: { title: 'Settings', sub: 'Workspace preferences and access', render: renderSettings },
}

function navigate(view, initial) {
  if (!ROUTES[view]) view = 'dashboard'
  state.view = view
  if (!initial) location.hash = '#/' + view

  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view))
  const route = ROUTES[view]
  $('#page-title').textContent = route.title
  $('#page-sub').textContent = route.sub
  $('#topbar-actions').innerHTML = ''
  document.title = `${route.title} · Training Report Tracker`

  const el = $('#view')
  el.innerHTML = `<div class="empty"><p class="muted">Loading…</p></div>`
  Promise.resolve(route.render(el)).catch((e) => {
    if (e.message === 'locked') return
    el.innerHTML = `<div class="notice notice-bad"><span class="nicon">${ico('alert')}</span><div><strong>Could not load this page</strong>${esc(e.message)}</div></div>`
  })
}

window.addEventListener('hashchange', () => {
  const v = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard'
  if (v !== state.view) navigate(v, true)
})

$('#period-picker').addEventListener('change', (e) => {
  state.periodId = Number(e.target.value)
  navigate(state.view, true)
})

/* ---------------- dashboard ---------------- */
async function renderDashboard(el) {
  if (!state.periodId) return renderNoPeriod(el)

  const data = await api(`/overview?period=${state.periodId}`)
  const s = data.stats
  const period = data.period
  const rate = pct(s.submitted, s.roster)

  const lateBadge = period?.due_date && s.late > 0 ? ` · <strong>${s.late} after the deadline</strong>` : ''
  const overdue = period?.due_date ? new Date(period.due_date + 'T23:59:59') < new Date() && s.pending > 0 : false

  $('#topbar-actions').innerHTML = `
    <button class="btn" id="dash-export">${ico('download', 15)} Export CSV</button>
    <a class="btn btn-primary" href="#/tracker">Open tracker</a>`
  $('#dash-export').addEventListener('click', () => downloadFile(`/api/export.csv?period=${state.periodId}`))

  el.innerHTML = `
    ${!s.roster ? notice('info', 'Your roster is empty', 'Add staff members (or import your staff list) before reports can be matched to anyone. <a href="#/roster">Go to the roster →</a>') : ''}
    ${s.unmatched > 0 ? notice('warn', `${s.unmatched} response${s.unmatched === 1 ? '' : 's'} could not be matched`, `Someone submitted the form but is not on the roster (or their email/name differs). <a href="#/inbox">Review them in the inbox →</a>`) : ''}
    ${overdue ? notice('bad', 'The deadline has passed', `${s.pending} staff member${s.pending === 1 ? ' has' : 's have'} not submitted yet. <button class="btn btn-sm" id="chase">Download chase list</button>`) : ''}

    <div class="grid grid-4 mt-16">
      <div class="card stat stat-accent">
        <div class="stat-label">Submitted</div>
        <div class="stat-value">${s.submitted}<small> / ${s.roster}</small></div>
        <div class="stat-foot">${rate}% of the roster</div>
      </div>
      <div class="card stat ${s.pending ? 'stat-warn' : ''}">
        <div class="stat-label">Outstanding</div>
        <div class="stat-value" style="${s.pending ? 'color:var(--warn)' : ''}">${s.pending}</div>
        <div class="stat-foot">${s.pending ? 'Awaiting a report' : 'Everyone has submitted'}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Deadline</div>
        <div class="stat-value" style="font-size:19px;margin-top:10px">${period?.due_date ? fmtDate(period.due_date) : 'Not set'}</div>
        <div class="stat-foot">${period?.due_date ? (overdue ? 'Passed' : `${Math.ceil((new Date(period.due_date + 'T23:59:59') - Date.now()) / 86400000)} days remaining`) : 'Add one in Forms connection'}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Completion</div>
        <div class="stat-value">${rate}<small>%</small></div>
        <div class="bar mt-8${rate < 60 ? ' warn' : ''}"><span style="width:${rate}%"></span></div>
      </div>
    </div>

    <div class="grid grid-3-2 mt-16">
      <div class="card">
        <div class="card-head">
          <div><h3>Progress by team</h3><p>${esc(period?.name || '')}</p></div>
        </div>
        <div class="card-body">
          ${
            data.teams.length
              ? data.teams
                  .map((t) => {
                    const p = pct(t.submitted, t.roster)
                    return `<div class="team-row">
                      <div class="tname">${esc(t.team)}</div>
                      <div class="tcount">${t.submitted}/${t.roster}</div>
                      <div class="bar${p < 60 ? ' warn' : ''}"><span style="width:${p}%"></span></div>
                      <div class="tmeta">${p}% complete</div>
                    </div>`
                  })
                  .join('')
              : `<p class="muted tiny">No teams assigned yet. Add a team to each staff member to see the breakdown.</p>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Recent submissions</h3><p>Latest reports received</p></div></div>
        <div class="card-body" style="padding-top:8px">
          ${
            data.recent.length
              ? `<div class="feed">${data.recent
                  .map(
                    (r) => `<div class="feed-item">
                      <span class="feed-dot ok"></span>
                      <div class="feed-body">
                        <div class="fmain"><strong>${esc(r.full_name)}</strong></div>
                        <div class="ftime">${esc(r.team || 'No team')} · ${relTime(r.submitted_at)}</div>
                      </div>
                    </div>`
                  )
                  .join('')}</div>`
              : `<p class="muted tiny">Nothing yet${period?.form_url ? ' — as soon as someone submits the form it will appear here.' : '.'}</p>`
          }
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Activity log</h3><p>Everything the tracker has recorded</p></div></div>
      <div class="card-body">
        ${
          data.activity.length
            ? `<div class="feed">${data.activity
                .map(
                  (a) => `<div class="feed-item">
                    <span class="feed-dot ${a.event === 'unmatched' ? 'warn' : a.event.includes('submission') ? 'ok' : ''}"></span>
                    <div class="feed-body">
                      <div class="fmain">${esc(a.detail || a.event)}</div>
                      <div class="ftime">${fmtDateTime(a.ts)} · ${esc(a.actor || 'system')}</div>
                    </div>
                  </div>`
                )
                .join('')}</div>`
            : `<p class="muted tiny">No activity recorded yet.</p>`
        }
      </div>
    </div>`

  const chase = $('#chase')
  if (chase) chase.addEventListener('click', () => downloadFile(`/api/pending.csv?period=${state.periodId}`))
}

function notice(kind, title, body) {
  const iconName = kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info'
  return `<div class="notice notice-${kind}">
    <span class="nicon">${ico(iconName)}</span>
    <div><strong>${esc(title)}</strong>${body}</div>
  </div>`
}

function renderNoPeriod(el) {
  el.innerHTML = `<div class="card"><div class="empty">
    <div class="eicon">${ico('setup')}</div>
    <h3>No reporting period yet</h3>
    <p>A reporting period is one cycle of reports — for example “Term 1 2026”. Each period has its own form link and its own submission record.</p>
    <a class="btn btn-primary" href="#/setup">Create a reporting period</a>
  </div></div>`
}

function downloadFile(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/* ---------------- modal ---------------- */
function modal({ title, body, footer, wide }) {
  const back = document.createElement('div')
  back.className = 'modal-back'
  back.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="Close">${ico('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`
  document.body.appendChild(back)
  const close = () => back.remove()
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close()
  })
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close()
      document.removeEventListener('keydown', onKey)
    }
  })
  return { back, close, $: (s) => back.querySelector(s) }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied to clipboard')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    toast('Copied to clipboard')
  }
}

/* ---------------- tracker ---------------- */
async function renderTracker(el) {
  if (!state.periodId) return renderNoPeriod(el)
  const period = currentPeriod()

  $('#topbar-actions').innerHTML = `
    <button class="btn" id="tr-import">${ico('upload', 15)} Import from Forms</button>
    <button class="btn" id="tr-export">${ico('download', 15)} Export</button>
    <button class="btn btn-primary" id="tr-add">${ico('plus', 15)} Mark as submitted</button>`

  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input type="search" id="f-q" placeholder="Search name or email…" value="${esc(state.filters.q)}" />
        <select id="f-team"><option value="">All teams</option></select>
        <div class="seg" id="f-status">
          <button data-s="all" class="${state.filters.status === 'all' ? 'on' : ''}">All</button>
          <button data-s="pending" class="${state.filters.status === 'pending' ? 'on' : ''}">Outstanding</button>
          <button data-s="submitted" class="${state.filters.status === 'submitted' ? 'on' : ''}">Submitted</button>
        </div>
        <div class="right tiny muted" id="tr-count"></div>
      </div>
      <div id="tr-table"></div>
    </div>`

  $('#tr-add').addEventListener('click', () => manualMarkModal())
  $('#tr-export').addEventListener('click', () => downloadFile(`/api/export.csv?period=${state.periodId}`))
  $('#tr-import').addEventListener('click', () => importModal())

  const debounce = (fn, ms) => {
    let t
    return (...a) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...a), ms)
    }
  }

  $('#f-q').addEventListener(
    'input',
    debounce((e) => {
      state.filters.q = e.target.value.trim()
      loadTrackerTable()
    }, 220)
  )
  $('#f-team').addEventListener('change', (e) => {
    state.filters.team = e.target.value
    loadTrackerTable()
  })
  $$('#f-status button').forEach((b) =>
    b.addEventListener('click', () => {
      state.filters.status = b.dataset.s
      $$('#f-status button').forEach((x) => x.classList.toggle('on', x === b))
      loadTrackerTable()
    })
  )

  await loadTrackerTable()
}

async function loadTrackerTable() {
  const f = state.filters
  const qs = new URLSearchParams({ period: state.periodId })
  if (f.q) qs.set('q', f.q)
  if (f.team) qs.set('team', f.team)
  if (f.status !== 'all') qs.set('status', f.status)

  const { rows } = await api('/progress?' + qs)
  const holder = $('#tr-table')
  if (!holder) return

  // populate team filter once
  const teamSel = $('#f-team')
  if (teamSel && teamSel.options.length <= 1) {
    const teams = [...new Set((state.staff || []).map((s) => s.team).filter(Boolean))].sort()
    if (!teams.length) {
      const all = await api('/staff')
      state.staff = all.staff || []
      ;[...new Set(state.staff.map((s) => s.team).filter(Boolean))].sort().forEach((t) => {
        const o = document.createElement('option')
        o.value = t
        o.textContent = t
        teamSel.appendChild(o)
      })
    } else {
      teams.forEach((t) => {
        const o = document.createElement('option')
        o.value = t
        o.textContent = t
        teamSel.appendChild(o)
      })
    }
    teamSel.value = f.team
  }

  const submitted = rows.filter((r) => r.submitted_at).length
  const countEl = $('#tr-count')
  if (countEl) countEl.textContent = `${submitted} of ${rows.length} submitted`

  if (!rows.length) {
    holder.innerHTML = `<div class="empty">
      <div class="eicon">${ico('roster')}</div>
      <h3>${state.staff.length ? 'No matches' : 'No staff on the roster'}</h3>
      <p>${state.staff.length ? 'Try a different search or filter.' : 'Add staff members or import your staff list, then reports can be matched automatically.'}</p>
      ${state.staff.length ? '' : '<a class="btn btn-primary" href="#/roster">Go to roster</a>'}
    </div>`
    return
  }

  const period = currentPeriod()
  holder.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Staff member</th><th>Team</th><th>Training programme(s)</th><th>Status</th><th>Submitted</th><th>Source</th><th></th>
    </tr></thead>
    <tbody>${rows
      .map((r) => {
        const late =
          r.submitted_at && period?.due_date && r.submitted_at > period.due_date + 'T23:59:59.999Z'
        return `<tr>
          <td><div class="person">
            <span class="avatar">${esc(initials(r.full_name))}</span>
            <div><div class="pname">${esc(r.full_name)}</div><div class="pmeta">${esc(r.email)}</div></div>
          </div></td>
          <td class="muted">${esc(r.team || '—')}</td>
          <td class="tiny muted">${esc(r.training_programmes || '—')}</td>
          <td>${
            r.submitted_at
              ? late
                ? '<span class="badge badge-late">Late</span>'
                : '<span class="badge badge-ok">Submitted</span>'
              : '<span class="badge badge-pending">Outstanding</span>'
          }</td>
          <td class="muted tiny">${r.submitted_at ? fmtDateTime(r.submitted_at) : '—'}</td>
          <td class="tiny muted">${
            r.source === 'manual'
              ? 'Manual'
              : r.source === 'csv'
              ? 'Forms export'
              : r.matched_by === 'name'
              ? 'Form (name match)'
              : r.source
              ? 'Form'
              : '—'
          }</td>
          <td style="text-align:right;white-space:nowrap">
            ${
              r.submitted_at
                ? `<button class="btn btn-sm btn-ghost" data-undo="${r.staff_id}" title="Remove this record">Undo</button>`
                : `<button class="btn btn-sm" data-mark="${r.staff_id}">Mark submitted</button>`
            }
          </td>
        </tr>`
      })
      .join('')}</tbody>
  </table></div>`

  $$('[data-mark]', holder).forEach((b) =>
    b.addEventListener('click', () => markSubmitted(Number(b.dataset.mark)))
  )
  $$('[data-undo]', holder).forEach((b) =>
    b.addEventListener('click', async () => {
      const subs = await api('/submissions?period=' + state.periodId)
      const s = (subs.submissions || []).find((x) => x.staff_id === Number(b.dataset.undo))
      if (!s) return
      if (!confirm(`Remove the submission record for ${s.full_name}?`)) return
      await api('/submissions/' + s.id, { method: 'DELETE' })
      toast('Record removed')
      await loadTrackerTable()
      await refreshBadges()
    })
  )
}

async function markSubmitted(staffId, when, trainingProgramme, trainingStartDate, durationDays) {
  if (!trainingProgramme) trainingProgramme = prompt('Enter the training programme name:')?.trim()
  if (!trainingProgramme) return
  try {
    await api('/submissions/manual', {
      method: 'POST',
      body: JSON.stringify({ staff_id: staffId, period_id: state.periodId, submitted_at: when, training_programme: trainingProgramme, training_start_date: trainingStartDate, duration_days: durationDays }),
    })
    toast('Marked as submitted')
    await loadTrackerTable()
  } catch (e) {
    toast(e.message, true)
  }
}

function manualMarkModal() {
  const opts = (state.staff || [])
    .filter((s) => s.active)
    .map((s) => `<option value="${s.id}">${esc(s.full_name)} — ${esc(s.email)}</option>`)
    .join('')

  const m = modal({
    title: 'Mark a report as submitted',
    body: `
      <p class="tiny muted mb-12">Use this when a report arrived outside the form — for example by email or in person.</p>
      <label class="field"><span>Staff member</span>
        <select id="m-staff"><option value="">Select…</option>${opts}</select></label>
      <label class="field"><span>Training programme</span>
        <input type="text" id="m-programme" placeholder="e.g. Strategic Leadership Programme" /></label>
      <label class="field"><span>Training start date (optional)</span>
        <input type="date" id="m-training-date" /></label>
      <label class="field"><span>Training duration in days (optional)</span>
        <input type="number" id="m-duration" min="0.5" step="0.5" placeholder="e.g. 3" /></label>
      <label class="field"><span>Date and time submitted</span>
        <input type="datetime-local" id="m-when" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}" /></label>
      <p class="tiny muted">This is recorded with source “Manual” so it stays distinguishable from form submissions.</p>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="m-save">Save record</button>`,
  })

  m.$('#m-save').addEventListener('click', async () => {
    const id = m.$('#m-staff').value
    if (!id) return toast('Choose a staff member', true)
    const programme = m.$('#m-programme').value.trim()
    if (!programme) return toast('Enter the training programme', true)
    const when = m.$('#m-when').value
    await markSubmitted(Number(id), when ? new Date(when).toISOString() : undefined, programme, m.$('#m-training-date').value || undefined, m.$('#m-duration').value ? Number(m.$('#m-duration').value) : undefined)
    m.close()
  })
}

/* ---------------- import wizard ---------------- */
function importModal() {
  const m = modal({
    title: 'Import a Microsoft Forms export',
    wide: true,
    body: `
      <div class="notice notice-info mb-12">
        <span class="nicon">${ico('info')}</span>
        <div><strong>Use this for backfill or reconciliation</strong>
        In Microsoft Forms open your form → <em>Responses</em> → <em>Open in Excel</em>. Import that file here.
        Records already captured are skipped, so it is safe to re-import the same sheet.</div>
      </div>
      <div class="dropzone" id="dz">
        <div class="dicon">${ico('upload')}</div>
        <strong>Drop your .xlsx or .csv here</strong>
        <small>or click to browse — the file stays in this browser until you confirm</small>
        <input type="file" id="file" accept=".xlsx,.csv,.tsv" hidden />
      </div>
      <div id="preview" class="mt-12"></div>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="imp-go" disabled>Import</button>`,
  })

  let pending = null
  const dz = m.$('#dz')
  const fileInput = m.$('#file')
  const goBtn = m.$('#imp-go')

  dz.addEventListener('click', () => fileInput.click())
  dz.addEventListener('dragover', (e) => {
    e.preventDefault()
    dz.classList.add('over')
  })
  dz.addEventListener('dragleave', () => dz.classList.remove('over'))
  dz.addEventListener('drop', (e) => {
    e.preventDefault()
    dz.classList.remove('over')
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
  })
  fileInput.addEventListener('change', () => fileInput.files[0] && handleFile(fileInput.files[0]))

  async function handleFile(file) {
    const isXlsx = /\.xlsx$/i.test(file.name)
    m.$('#preview').innerHTML = `<p class="tiny muted">Reading ${esc(file.name)}…</p>`
    try {
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' },
        body: file,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read that file')

      if (!data.headers.length) throw new Error('No rows found in that file')

      const colOpts = data.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('')
      const sel = (label, key) => `
        <label class="field" style="margin-bottom:8px"><span>${label}</span>
          <select data-col="${key}">
            <option value="">— none —</option>
            ${data.headers
              .map(
                (h, i) =>
                  `<option value="${i}"${data.detected[key] === i ? ' selected' : ''}>${esc(h)}</option>`
              )
              .join('')}
          </select></label>`

      m.$('#preview').innerHTML = `
        <p class="tiny muted">${data.total} row${data.total === 1 ? '' : 's'} found. We detected these columns — adjust if needed.</p>
        <div class="grid grid-2 mt-8">
          ${sel('Responder email', 'email')}
          ${sel('Responder name', 'name')}
        </div>
        ${sel('Submission time', 'time')}
        ${
          data.sample.length
            ? `<div class="table-wrap mt-8" style="border:1px solid var(--border)"><table>
                 <thead><tr>${data.headers.slice(0, 5).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                 <tbody>${data.sample
                   .map((r) => `<tr>${data.headers.slice(0, 5).map((h, i) => `<td class="tiny">${esc(r[i] ?? '')}</td>`).join('')}</tr>`)
                   .join('')}</tbody></table></div>`
            : ''
        }`
      pending = file
      goBtn.disabled = false
    } catch (e) {
      m.$('#preview').innerHTML = notice('bad', 'Could not read the file', esc(e.message))
      goBtn.disabled = true
    }
  }

  goBtn.addEventListener('click', async () => {
    if (!pending) return
    goBtn.disabled = true
    goBtn.textContent = 'Importing…'
    const isXlsx = /\.xlsx$/i.test(pending.name)
    const params = new URLSearchParams({ period: state.periodId })
    for (const key of ['email', 'name', 'time']) {
      const v = m.$(`[data-col="${key}"]`)?.value
      if (v !== '' && v !== undefined) params.set(key + '_col', v)
    }
    try {
      const res = await fetch('/api/import?' + params, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' },
        body: pending,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      const r = data.report
      m.close()
      await refreshBadges()
      resultModal(r)
    } catch (e) {
      toast(e.message, true)
      goBtn.disabled = false
      goBtn.textContent = 'Import'
    }
  })
}

function resultModal(r) {
  const m = modal({
    title: 'Import complete',
    body: `
      <div class="grid grid-2" style="gap:10px">
        <div class="card card-pad"><div class="stat-label">Recorded</div><div class="stat-value" style="color:var(--ok)">${r.recorded}</div></div>
        <div class="card card-pad"><div class="stat-label">Already present</div><div class="stat-value">${r.duplicates}</div></div>
        <div class="card card-pad"><div class="stat-label">Unmatched</div><div class="stat-value" style="color:${r.unmatched ? 'var(--warn)' : 'inherit'}">${r.unmatched}</div></div>
        <div class="card card-pad"><div class="stat-label">Unreadable rows</div><div class="stat-value">${r.invalid}</div></div>
      </div>
      ${
        r.unmatchedList?.length
          ? `<div class="mt-16"><strong class="tiny">Could not match these rows:</strong>
             <ul class="tiny muted" style="margin:6px 0 0 18px;padding:0">
               ${r.unmatchedList
                 .map((u) => `<li>${esc(u.name || 'No name')}${u.email ? ` &lt;${esc(u.email)}&gt;` : ''}</li>`)
                 .join('')}
             </ul>
             <p class="tiny muted mt-8">These are in the Unmatched inbox — link them to the right person there.</p></div>`
          : ''
      }
      <p class="tiny muted mt-16">Scanned ${r.total_rows} row${r.total_rows === 1 ? '' : 's'} in total.</p>`,
    footer: `<button class="btn" data-close>Close</button>${
      r.unmatched ? '<a class="btn btn-primary" href="#/inbox" data-close>Review unmatched</a>' : '<button class="btn btn-primary" data-close>Done</button>'
    }`,
  })
  setTimeout(() => navigate('tracker', true), 0)
}

/* ---------------- inbox ---------------- */
async function renderInbox(el) {
  const { unmatched } = await api('/unmatched')
  const staffRes = await api('/staff')
  const staff = (staffRes.staff || []).filter((s) => s.active)

  if (!unmatched.length) {
    el.innerHTML = `<div class="card"><div class="empty">
      <div class="eicon">${ico('check')}</div>
      <h3>Nothing to review</h3>
      <p>Every response received so far has been matched to someone on the roster.</p>
    </div></div>`
    return
  }

  const opts = staff
    .map((s) => `<option value="${s.id}">${esc(s.full_name)} — ${esc(s.email)}</option>`)
    .join('')

  el.innerHTML = `
    ${notice('warn', `${unmatched.length} response${unmatched.length === 1 ? '' : 's'} need attention`, 'These were submitted through the form but could not be matched to a roster entry. Link each one to the right person, or ignore it if it is a test.')}
    <div class="card mt-16">
      <div class="table-wrap"><table>
        <thead><tr><th>Respondent</th><th>Received</th><th>Why it is here</th><th style="width:320px">Action</th></tr></thead>
        <tbody>${unmatched
          .map(
            (u) => `<tr>
              <td><div class="person">
                <span class="avatar">${esc(initials(u.full_name || u.email))}</span>
                <div><div class="pname">${esc(u.full_name || 'No name given')}</div>
                <div class="pmeta">${esc(u.email || 'No email')}</div></div>
              </div></td>
              <td class="tiny muted">${fmtDateTime(u.submitted_at)}</td>
              <td class="tiny muted">${
                u.reason === 'email_not_on_roster'
                  ? 'Email not on roster'
                  : u.reason === 'name_not_on_roster'
                  ? 'Name not on roster'
                  : 'No name or email'
              }</td>
              <td><div class="row" style="gap:6px;flex-wrap:nowrap">
                <select data-link-select="${u.id}" style="min-width:170px"><option value="">Link to…</option>${opts}</select>
                <button class="btn btn-sm btn-primary" data-link="${u.id}">Link</button>
                <button class="btn btn-sm btn-ghost" data-ignore="${u.id}">Ignore</button>
              </div></td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`

  $$('[data-link]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.link
      const sel = $(`[data-link-select="${id}"]`, el)
      if (!sel.value) return toast('Choose who to link this to', true)
      try {
        await api(`/unmatched/${id}/link`, { method: 'POST', body: JSON.stringify({ staff_id: Number(sel.value) }) })
        toast('Linked and recorded')
        await refreshBadges()
        navigate('inbox', true)
      } catch (e) {
        toast(e.message, true)
      }
    })
  )
  $$('[data-ignore]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/unmatched/${b.dataset.ignore}/ignore`, { method: 'POST' })
      toast('Dismissed')
      await refreshBadges()
      navigate('inbox', true)
    })
  )
}


async function renderProgrammes(el) {
  const period=Number(state.periodId)
  const [pr,sr,ar]=await Promise.all([api('/programmes?period='+period),api('/staff'),api('/programme-assignments?period='+period)])
  const programmes=pr.programmes||[], staff=sr.staff||[]
  el.innerHTML='<div class="card"><div class="card-head"><h3>Training programmes and assignments</h3></div><div class="card-body"><label class="field"><span>New programme</span><input id="pg-name" placeholder="Enter programme name"></label><button class="btn btn-primary" id="pg-add">Add programme</button><hr><label class="field"><span>Programme to assign</span><select id="pg-choice">'+programmes.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select></label><p>Select staff members (each can attend multiple programmes):</p><div style="max-height:220px;overflow:auto">'+staff.map(st=>'<label style="display:block;padding:5px"><input type="checkbox" class="pg-staff" value="'+st.id+'"> '+esc(st.full_name)+' — '+esc(st.email)+'</label>').join('')+'</div><button class="btn btn-primary mt-12" id="pg-assign">Assign selected staff</button></div></div><div class="card mt-16"><div class="card-head"><h3>Programme reporting status</h3></div><div class="table-wrap"><table><thead><tr><th>Programme</th><th>Assigned</th><th>Submitted</th><th>Outstanding</th><th></th></tr></thead><tbody>'+programmes.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+p.assigned+'</td><td>'+p.submitted+'</td><td><strong>'+p.pending+'</strong></td><td><button class="btn btn-sm pg-view" data-id="'+p.id+'">View staff</button></td></tr>').join('')+'</tbody></table></div></div><div id="pg-detail" class="mt-16"></div>'
  $('#pg-add').onclick=async()=>{try{await api('/programmes',{method:'POST',body:JSON.stringify({name:$('#pg-name').value.trim()})});toast('Programme created');renderProgrammes(el)}catch(e){toast(e.message,true)}}
  $('#pg-assign').onclick=async()=>{const programme_id=Number($('#pg-choice').value),staff_ids=Array.from(document.querySelectorAll('.pg-staff')).filter(x=>x.checked).map(x=>Number(x.value));try{const r=await api('/programme-assignments',{method:'POST',body:JSON.stringify({programme_id,staff_ids,period_id:period})});toast(r.added+' staff assignments added');renderProgrammes(el)}catch(e){toast(e.message,true)}}
  document.querySelectorAll('.pg-view').forEach(b=>b.onclick=async()=>{const data=await api('/programme-progress?period='+period+'&programme_id='+b.dataset.id);$('#pg-detail').innerHTML='<div class="card"><div class="card-head"><h3>Assigned staff: '+data.assigned+' · Submitted: '+data.submitted+' · Outstanding: '+data.pending+'</h3></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>'+data.rows.map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.email)+'</td><td>'+(x.submitted_at?'Submitted':'Outstanding')+'</td><td><button class="btn btn-sm pg-remove" data-id="'+x.id+'">Unassign</button></td></tr>').join('')+'</tbody></table></div></div>';document.querySelectorAll('.pg-remove').forEach(x=>x.onclick=async()=>{if(!confirm('Remove assignment? Existing submissions will be kept.'))return;await api('/programme-assignments/'+x.dataset.id,{method:'DELETE'});renderProgrammes(el)})})
}

/* ---------------- roster ---------------- */
async function renderTrainingHistory(el) {
  const params = new URLSearchParams()
  const hashQuery = location.hash.includes('?') ? location.hash.split('?').slice(1).join('?') : ''
  const routeParams = new URLSearchParams(hashQuery)
  const selectedStaff = routeParams.get('staff') || ''
  const selectedYear = routeParams.get('year') || ''
  if (selectedStaff) params.set('staff_id', selectedStaff)
  if (selectedYear) params.set('year', selectedYear)
  const data = await api('/training-history' + (params.toString() ? '?' + params.toString() : ''))
  const staff = data.staff || []
  const records = data.records || []
  const chosen = staff.find((s) => String(s.id) === String(selectedStaff))
  $('#topbar-actions').innerHTML = `<button class="btn" id="history-export">${ico('download', 15)} Export history</button>`
  el.innerHTML = `
    <div class="card mb-12">
      <div class="card-head"><div><h3>Find a staff member's training record</h3><p>View one person's complete history or review submissions across the organisation.</p></div></div>
      <div class="toolbar" style="padding:0 18px 16px;display:flex;gap:10px;flex-wrap:wrap">
        <label class="field" style="margin:0;min-width:240px;flex:1"><span>Staff member</span>
          <select id="history-staff"><option value="">All staff members</option>${staff.map((s) => `<option value="${s.id}"${String(s.id) === String(selectedStaff) ? ' selected' : ''}>${esc(s.full_name)} — ${esc(s.email)}</option>`).join('')}</select></label>
        <label class="field" style="margin:0;min-width:150px"><span>Submission year</span>
          <select id="history-year"><option value="">All years</option>${(data.years || []).map((y) => `<option value="${esc(y)}"${String(y) === String(selectedYear) ? ' selected' : ''}>${esc(y)}</option>`).join('')}</select></label>
        <div style="align-self:end"><button class="btn btn-primary" id="history-apply">Apply filters</button></div>
      </div>
    </div>
    <div class="grid grid-3 mb-12">
      <div class="card stat"><div class="stat-label">Training reports</div><div class="stat-value">${records.length}</div><div class="stat-foot">Matching submissions</div></div>
      <div class="card stat"><div class="stat-label">Staff members</div><div class="stat-value">${data.summary?.staff || 0}</div><div class="stat-foot">With recorded submissions</div></div>
      <div class="card stat"><div class="stat-label">Programmes recorded</div><div class="stat-value">${records.length}</div><div class="stat-foot">One record per staff/programme submission</div></div>
    </div>
    ${chosen ? `<div class="card mb-12"><div class="card-head"><div><h3>${esc(chosen.full_name)}</h3><p>${esc(chosen.email)}${chosen.team ? ' · ' + esc(chosen.team) : ''}</p></div><span class="badge badge-ok">Individual history</span></div></div>` : ''}
    <div class="card">
      <div class="card-head"><div><h3>${chosen ? 'Training history' : 'Organisation training records'}</h3><p>${selectedYear ? 'Filtered to ' + esc(selectedYear) : 'All available years'} · Most recent submissions first</p></div></div>
      ${records.length ? `<div class="table-wrap"><table><thead><tr><th>Staff member</th><th>Training programme</th><th>Reporting period</th><th>Training start date</th><th>Duration</th><th>Date submitted</th><th>Submission channel</th></tr></thead><tbody>${records.map((r) => `<tr>
        <td><div class="person"><span class="avatar">${esc(initials(r.full_name))}</span><div><div class="pname">${esc(r.full_name)}</div><div class="pmeta">${esc(r.email)}</div></div></div></td>
        <td><strong>${esc(r.training_programme || 'Unspecified programme')}</strong></td>
        <td class="tiny muted">${esc(r.period_name || '—')}</td>
        <td class="tiny muted">${r.training_start_date ? fmtDate(r.training_start_date) : '—'}</td>
        <td class="tiny muted">${r.duration_days ? esc(r.duration_days) + ' day' + (Number(r.duration_days) === 1 ? '' : 's') : '—'}</td>
        <td class="tiny muted">${fmtDateTime(r.submitted_at)}</td>
        <td class="tiny muted">${r.source === 'manual' ? 'Manual' : r.source === 'csv' ? 'Forms export' : 'Microsoft Forms'}</td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div class="eicon">${ico('file')}</div><h3>No training records found</h3><p>${chosen ? 'No reports have been recorded for this staff member under the selected filters.' : 'No training report submissions match the selected filters.'}</p></div>`}
    </div>`

  $('#history-apply').addEventListener('click', () => {
    const qs = new URLSearchParams()
    const sid = $('#history-staff').value, yr = $('#history-year').value
    if (sid) qs.set('staff', sid)
    if (yr) qs.set('year', yr)
    location.hash = '#/history' + (qs.toString() ? '?' + qs.toString() : '')
    renderTrainingHistory($('#view'))
  })
  $('#history-export').addEventListener('click', () => {
    const headers = ['Staff member', 'Email', 'Team', 'Training programme', 'Reporting period', 'Training start date', 'Duration (days)', 'Date submitted', 'Submission channel']
    const csv = [headers, ...records.map((r) => [r.full_name, r.email, r.team || '', r.training_programme || '', r.period_name || '', r.training_start_date || '', r.duration_days || '', r.submitted_at || '', r.source || ''])]
      .map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = 'staff-training-history.csv'; a.click(); URL.revokeObjectURL(url)
  })
}

async function renderRoster(el) {
  const { staff } = await api('/staff')
  state.staff = staff || []

  $('#topbar-actions').innerHTML = `
    <button class="btn" id="r-import">${ico('upload', 15)} Import list</button>
    <button class="btn btn-primary" id="r-add">${ico('plus', 15)} Add staff member</button>`

  $('#r-add').addEventListener('click', () => staffModal())
  $('#r-import').addEventListener('click', () => rosterImportModal())

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>${staff.length} staff member${staff.length === 1 ? '' : 's'}</h3>
        <p>Reports are matched by email address first, then by name.</p></div>
      </div>
      ${
        staff.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Role</th><th></th></tr></thead>
              <tbody>${staff
                .map(
                  (s) => `<tr>
                    <td><div class="person"><span class="avatar">${esc(initials(s.full_name))}</span>
                      <div><div class="pname">${esc(s.full_name)}</div>${
                        s.active ? '' : '<div class="pmeta">Inactive</div>'
                      }</div></div></td>
                    <td class="tiny muted">${esc(s.email)}</td>
                    <td class="tiny muted">${esc(s.team || '—')}</td>
                    <td class="tiny muted">${esc(s.role || '—')}</td>
                    <td style="text-align:right;white-space:nowrap">
                      <button class="btn btn-sm btn-ghost" data-history="${s.id}">History</button>
                      <button class="btn btn-sm btn-ghost" data-edit="${s.id}">Edit</button>
                      <button class="btn btn-sm btn-ghost" data-del="${s.id}">Remove</button>
                    </td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : `<div class="empty">
              <div class="eicon">${ico('roster')}</div>
              <h3>No staff yet</h3>
              <p>Add people individually, or import your staff list from a spreadsheet with name and email columns.</p>
              <button class="btn btn-primary" id="r-add2">Add staff member</button>
            </div>`
      }
    </div>`

  const add2 = $('#r-add2', el)
  if (add2) add2.addEventListener('click', () => staffModal())

  $$('[data-history]', el).forEach((b) => b.addEventListener('click', () => { location.hash = '#/history?staff=' + b.dataset.history; renderTrainingHistory($('#view')) }))
    $$('[data-edit]', el).forEach((b) =>
    b.addEventListener('click', () => staffModal(state.staff.find((s) => s.id === Number(b.dataset.edit))))
  )
  $$('[data-del]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const s = state.staff.find((x) => x.id === Number(b.dataset.del))
      if (!confirm(`Remove ${s.full_name} from the roster? Their submission records for all periods will also be deleted.`)) return
      await api('/staff/' + s.id, { method: 'DELETE' })
      toast('Removed')
      navigate('roster', true)
    })
  )
}

function staffModal(person) {
  const p = person || {}
  const m = modal({
    title: person ? 'Edit staff member' : 'Add staff member',
    body: `
      <label class="field"><span>Full name</span>
        <input type="text" id="s-name" value="${esc(p.full_name || '')}" placeholder="e.g. Amina Yusuf" /></label>
      <label class="field"><span>Email address</span>
        <input type="email" id="s-email" value="${esc(p.email || '')}" placeholder="name@organisation.org" />
        <small>This must match the email they use on the form. It is the most reliable way to match submissions.</small></label>
      <div class="grid grid-2">
        <label class="field"><span>Team</span>
          <input type="text" id="s-team" value="${esc(p.team || '')}" placeholder="e.g. Science" /></label>
        <label class="field"><span>Role</span>
          <input type="text" id="s-role" value="${esc(p.role || '')}" placeholder="e.g. Teacher" /></label>
      </div>
      ${
        person
          ? `<label class="field row" style="gap:8px"><input type="checkbox" id="s-active" style="width:auto" ${
              p.active ? 'checked' : ''
            } /><span style="margin:0">Active — still required to submit reports</span></label>`
          : ''
      }`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="s-save">${person ? 'Save changes' : 'Add to roster'}</button>`,
  })

  m.$('#s-save').addEventListener('click', async () => {
    const body = {
      full_name: m.$('#s-name').value.trim(),
      email: m.$('#s-email').value.trim(),
      team: m.$('#s-team').value.trim(),
      role: m.$('#s-role').value.trim(),
    }
    if (person && m.$('#s-active')) body.active = m.$('#s-active').checked ? 1 : 0
    try {
      if (person) await api('/staff/' + person.id, { method: 'PATCH', body: JSON.stringify(body) })
      else await api('/staff', { method: 'POST', body: JSON.stringify(body) })
      m.close()
      toast(person ? 'Saved' : 'Added to roster')
      navigate('roster', true)
    } catch (e) {
      toast(e.message, true)
    }
  })
}

function rosterImportModal() {
  const m = modal({
    title: 'Import staff list',
    body: `
      <p class="tiny muted mb-12">Paste a CSV, or upload a file. It needs a <strong>name</strong> column and an <strong>email</strong> column; <em>team</em> and <em>role</em> columns are optional.</p>
      <div class="row mb-12" style="gap:8px">
        <button class="btn btn-sm" id="pick-file">Choose file…</button>
        <span class="tiny muted" id="file-label">No file chosen</span>
      </div>
      <textarea id="csv" placeholder="full_name,email,team
Amina Yusuf,amina.yusuf@example.org,Science
David Okafor,david.okafor@example.org,Mathematics"></textarea>
      <input type="file" id="rf" accept=".csv,.tsv,.txt" hidden />`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ri-go">Import</button>`,
  })

  const fileEl = m.$('#rf')
  m.$('#pick-file').addEventListener('click', () => fileEl.click())
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0]
    if (!f) return
    m.$('#csv').value = await f.text()
    m.$('#file-label').textContent = f.name
  })

  m.$('#ri-go').addEventListener('click', async () => {
    const text = m.$('#csv').value.trim()
    if (!text) return toast('Paste your staff list first', true)
    try {
      const res = await fetch('/api/staff/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      m.close()
      toast(`${data.count} staff member${data.count === 1 ? '' : 's'} imported`)
      navigate('roster', true)
    } catch (e) {
      toast(e.message, true)
    }
  })
}

/* ---------------- forms connection (the heart of the app) ---------------- */
async function renderSetup(el) {
  if (!state.periodId) return renderNoPeriod(el)
  const period = currentPeriod()
  const webhookUrl = `${location.origin}/api/ingest/${period.webhook_token}`

  $('#topbar-actions').innerHTML = `
    <button class="btn" id="p-edit">${ico('edit', 15)} Edit period</button>
    <button class="btn btn-primary" id="p-new">${ico('plus', 15)} New period</button>`

  $('#p-new').addEventListener('click', () => periodModal())
  $('#p-edit').addEventListener('click', () => periodModal(period))

  el.innerHTML = `
    ${notice(
      'info',
      'Why this needs a small setup step',
      `A Microsoft Form is private to your organisation — nothing outside Microsoft 365 can read its responses directly, including from the share link. The reliable way to make submissions flow in automatically is a <strong>Power Automate flow</strong> that pushes each new response to this app. It takes about two minutes and only has to be done once per form.`
    )}

    <div class="card mt-16">
      <div class="card-head">
        <div><h3>Step 1 · Your secure intake address</h3>
        <p>Any JSON sent here is matched against the roster and recorded.</p></div>
        <span class="badge badge-brand badge-no-dot">${esc(period.status === 'open' ? 'Accepting' : 'Closed')}</span>
      </div>
      <div class="card-body">
        <div class="copybox">
          <code id="wh-url">${esc(webhookUrl)}</code>
          <button class="btn btn-sm" id="wh-copy">${ico('copy', 14)} Copy</button>
        </div>
        <p class="tiny muted mt-8">Treat this like a password — anyone with the address can post to it. If it is ever shared by mistake, rotate it below and update your flow.</p>
        <div class="row mt-12">
          <button class="btn btn-sm btn-ghost" id="wh-rotate">${ico('refresh', 14)} Rotate address</button>
          <button class="btn btn-sm btn-ghost" id="wh-test">${ico('zap', 14)} Send a test payload</button>
        </div>
        <div id="wh-result" class="mt-12"></div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Step 2 · Build the flow in Power Automate</h3>
      <p>Power Automate is included with Microsoft 365. If your organisation blocks it, use Step 3 instead.</p></div></div>
      <div class="card-body">
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div>
              <h4>Create the flow</h4>
              <p>Go to <a href="https://make.powerautomate.com" target="_blank" rel="noopener">make.powerautomate.com</a> → <em>Create</em> → <em>Automated cloud flow</em>. Name it something like “Training report → Tracker”.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div>
              <h4>Trigger: when a new response is submitted</h4>
              <p>Choose the <strong>Microsoft Forms</strong> connector → trigger <em>“When a new response is submitted”</em> → select the exact form staff use for their reports.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div>
              <h4>Get the response details</h4>
              <p>Add <strong>Microsoft Forms</strong> → <em>“Get response details”</em>. Set <em>Form Id</em> to the same form, and <em>Response Id</em> to the dynamic value <em>Response Id</em> from the trigger.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">4</div>
            <div>
              <h4>Send it to this tracker</h4>
              <p>Add an <strong>HTTP</strong> action → <em>POST</em>. Paste your intake address from Step 1 as the URI, set <em>Body</em> to the JSON below, and set the HTTP header <code>Content-Type</code> to <code>application/json</code>. Map the training programme answer using Microsoft Forms dynamic content.</p>
              <pre class="code" id="wh-body">{
  "email": "@{outputs('Get_response_details')?['body/responder']}",
  "full_name": "@{outputs('Get_response_details')?['body/responderName']}",
  "submitted_at": "@{utcNow()}",
  "response_id": "@{outputs('Get_response_details')?['body/responseId']}",
  "training_programme": "INSERT TRAINING PROGRAMME DYNAMIC CONTENT"
}</pre>
              <button class="btn btn-sm mt-8" id="wh-body-copy">${ico('copy', 14)} Copy JSON</button>
              <p class="tiny muted mt-8"><strong>Names must match your flow exactly.</strong> If your flow names the “Get response details” step differently, replace <span class="mono">Get_response_details</span> in the JSON with that step name. If the responder fields come back empty, insert them with the dynamic-content picker from that step and paste the rest of the JSON around them.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">5</div>
            <div>
              <h4>Turn it on and submit a real test</h4>
              <p>Save, then submit the actual form once yourself. The response should appear in your tracker within seconds. If it does not, use <em>Send a test payload</em> above — if that works, the problem is in the flow, not the tracker.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Step 3 · No Power Automate? Use the Forms export</h3>
      <p>Slightly less instant, but nothing to build.</p></div></div>
      <div class="card-body">
        <p class="tiny muted mb-12">In Microsoft Forms open the form → <em>Responses</em> → <em>Open in Excel</em>. Then import that workbook here — as often as you like. Duplicates are detected automatically, so re-importing is safe.</p>
        <button class="btn" id="setup-import">${ico('upload', 15)} Import a Forms export now</button>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Reporting periods</h3><p>Each period keeps its own record and its own intake address.</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Form link</th><th>Deadline</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
        <tbody>${state.periods
          .map(
            (p) => `<tr${p.id === Number(state.periodId) ? ' style="background:var(--brand-soft)"' : ''}>
              <td><strong>${esc(p.name)}</strong></td>
              <td class="tiny">${
                p.form_url
                  ? `<a href="${esc(p.form_url)}" target="_blank" rel="noopener">Open form</a>`
                  : '<span class="muted">Not set</span>'
              }</td>
              <td class="tiny muted">${p.due_date ? fmtDate(p.due_date) : '—'}</td>
              <td class="tiny num">${p.submitted ?? 0}</td>
              <td><span class="badge ${
                p.status === 'open' ? 'badge-ok' : 'badge-neutral'
              }">${p.status === 'open' ? 'Open' : 'Closed'}</span></td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-sm btn-ghost" data-pe="${p.id}">Edit</button>
                <button class="btn btn-sm btn-ghost" data-pt="${p.id}" title="Toggle open/closed">${
                  p.status === 'open' ? 'Close' : 'Reopen'
                }</button>
              </td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`

  $('#wh-copy').addEventListener('click', () => copyText(webhookUrl))
  $('#wh-body-copy').addEventListener('click', () => copyText($('#wh-body').textContent))
  $('#setup-import').addEventListener('click', () => importModal())

  $('#wh-rotate').addEventListener('click', async () => {
    if (!confirm('Rotate the intake address? Your existing Power Automate flow will stop working until you update it with the new address.')) return
    const r = await api(`/periods/${period.id}/rotate-token`, { method: 'POST' })
    toast('Address rotated — update your flow')
    navigate('setup', true)
  })

  $('#wh-test').addEventListener('click', () => testPayloadModal(period))

  $$('[data-pe]', el).forEach((b) =>
    b.addEventListener('click', () => periodModal(state.periods.find((p) => p.id === Number(b.dataset.pe))))
  )
  $$('[data-pt]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const p = state.periods.find((x) => x.id === Number(b.dataset.pt))
      await api('/periods/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({ status: p.status === 'open' ? 'closed' : 'open' }),
      })
      await reloadPeriods()
      navigate('setup', true)
    })
  )
}

function testPayloadModal(period) {
  const sample = JSON.stringify(
    {
      email: 'amina.yusuf@example.org',
      full_name: 'Amina Yusuf',
      submitted_at: new Date().toISOString(),
      response_id: 'test-' + Date.now(),
    },
    null,
    2
  )

  const m = modal({
    title: 'Test the connection',
    wide: true,
    body: `
      <p class="tiny muted mb-12">This runs the exact same matching logic as a real submission, but <strong>records nothing</strong>. Use it to confirm the intake address and payload shape work before you build the flow.</p>
      <label class="field"><span>Payload</span>
        <textarea id="t-body" style="min-height:150px">${esc(sample)}</textarea>
        <small>Put a real staff member's email here to check matching end to end.</small></label>
      <div id="t-result"></div>`,
    footer: `<button class="btn" data-close>Close</button><button class="btn btn-primary" id="t-go">Run test</button>`,
  })

  m.$('#t-go').addEventListener('click', async () => {
    const out = m.$('#t-result')
    let body
    try {
      body = JSON.parse(m.$('#t-body').value)
    } catch {
      out.innerHTML = notice('bad', 'Invalid JSON', 'That payload is not valid JSON.')
      return
    }
    try {
      const r = await api(`/ingest-test/${period.id}`, { method: 'POST', body: JSON.stringify(body) })
      out.innerHTML = notice(r.ok ? 'ok' : 'warn', r.ok ? 'Connection works' : 'Parsed, but not matched', esc(r.message))
    } catch (e) {
      out.innerHTML = notice('bad', 'Test failed', esc(e.message))
    }
  })
}

function periodModal(period) {
  const p = period || {}
  const m = modal({
    title: period ? 'Edit reporting period' : 'New reporting period',
    body: `
      <label class="field"><span>Period name</span>
        <input type="text" id="p-name" value="${esc(p.name || '')}" placeholder="e.g. Term 1 2026 — Induction Training" /></label>
      <label class="field"><span>Microsoft Form link (optional)</span>
        <input type="url" id="p-url" value="${esc(p.form_url || '')}" placeholder="https://forms.office.com/r/…" />
        <small>Stored for convenience so you can jump straight to the form. It cannot be used to read responses — that is what the intake address and Power Automate are for.</small></label>
      <div class="grid grid-2">
        <label class="field"><span>Deadline (optional)</span>
          <input type="date" id="p-due" value="${esc(p.due_date || '')}" /></label>
        <label class="field"><span>Status</span>
          <select id="p-status">
            <option value="open"${p.status !== 'closed' ? ' selected' : ''}>Open — accepting reports</option>
            <option value="closed"${p.status === 'closed' ? ' selected' : ''}>Closed</option>
          </select></label>
      </div>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="p-save">${period ? 'Save' : 'Create period'}</button>`,
  })

  m.$('#p-save').addEventListener('click', async () => {
    const body = {
      name: m.$('#p-name').value.trim(),
      form_url: m.$('#p-url').value.trim(),
      due_date: m.$('#p-due').value,
      status: m.$('#p-status').value,
    }
    if (!body.name) return toast('Give the period a name', true)
    try {
      if (period) {
        await api('/periods/' + period.id, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        const r = await api('/periods', { method: 'POST', body: JSON.stringify(body) })
        state.periodId = r.period.id
      }
      m.close()
      await reloadPeriods()
      toast(period ? 'Period updated' : 'Period created')
      navigate('setup', true)
    } catch (e) {
      toast(e.message, true)
    }
  })
}

async function reloadPeriods() {
  const { periods } = await api('/periods')
  state.periods = periods || []
  renderPeriodPicker()
}

/* ---------------- settings ---------------- */
async function renderSettings(el) {
  const { settings } = await api('/settings')
  state.settings = settings || {}

  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div><h3>Workspace</h3><p>How the tracker identifies itself</p></div></div>
        <div class="card-body">
          <label class="field"><span>Organisation or team name</span>
            <input type="text" id="st-org" value="${esc(settings.org_name || '')}" placeholder="e.g. Riverside Training Team" /></label>
          <label class="field"><span>Form owner email</span>
            <input type="email" id="st-owner" value="${esc(settings.form_owner_email || '')}" placeholder="Who maintains the Microsoft Form" />
            <small>Recorded for reference so the team knows where the form lives.</small></label>
          <button class="btn btn-primary" id="st-save">Save changes</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Access control</h3><p>Keep the tracker to your team</p></div></div>
        <div class="card-body">
          <div class="notice notice-info mb-12">
            <span class="nicon">${ico('info')}</span>
            <div>${settings.access_code
              ? 'An access code is active. Anyone opening the link must enter it once.'
              : 'No access code is set — anyone with the link can open the tracker.'}</div>
          </div>
          <label class="field"><span>${settings.access_code ? 'Change access code' : 'Set an access code'}</span>
            <input type="password" id="st-code" placeholder="Leave blank to keep unchanged" autocomplete="new-password" />
            <small>Shared with your team, not per-person. For per-person logins this app would need to sit behind your organisation's identity provider.</small></label>
          ${
            settings.access_code
              ? `<button class="btn" id="st-clear">Remove access code</button>`
              : ''
          }
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Sample data</h3><p>This install currently contains demonstration records</p></div></div>
      <div class="card-body">
        <div class="notice notice-warn mb-12">
          <span class="nicon">${ico('alert')}</span>
          <div><strong>The roster and submissions are examples</strong>
          Clear them before real use, then add your actual staff list and connect your form.</div>
        </div>
        <button class="btn btn-danger" id="st-reset">${ico('trash', 15)} Clear all sample data</button>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>Data</h3><p>Everything lives in this app's own database</p></div></div>
      <div class="card-body">
        <p class="tiny muted mb-12">The tracker stores only what it needs: staff names, emails, teams, and the fact that a report was submitted with a timestamp. It does not store the contents of the reports themselves — those stay in Microsoft Forms.</p>
        <div class="row">
          <button class="btn" id="st-export">${ico('download', 15)} Export current period</button>
          <button class="btn" id="st-pending">${ico('download', 15)} Download outstanding list</button>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><div><h3>How matching works</h3><p>Useful when something lands in the inbox</p></div></div>
      <div class="card-body">
        <div class="steps">
          <div class="step"><div class="step-num">1</div><div>
            <h4>Email address</h4>
            <p>A response is matched to whichever roster entry has the same email address — case-insensitive, and tolerant of “Name &lt;email&gt;” formatting.</p></div></div>
          <div class="step"><div class="step-num">2</div><div>
            <h4>Name, if no email matches</h4>
            <p>Falls back to the responder name, ignoring titles (Dr, Mrs…), accents, punctuation and “Surname, Firstname” ordering. Middle names and initials are tolerated.</p></div></div>
          <div class="step"><div class="step-num">3</div><div>
            <h4>Otherwise the inbox</h4>
            <p>If neither works the response is never discarded — it waits in Unmatched until you link it to a person.</p></div></div>
        </div>
      </div>
    </div>`

  $('#st-save').addEventListener('click', async () => {
    const body = {
      org_name: $('#st-org').value.trim(),
      form_owner_email: $('#st-owner').value.trim(),
    }
    const code = $('#st-code').value.trim()
    if (code) body.access_code = code
    try {
      await api('/settings', { method: 'POST', body: JSON.stringify(body) })
      toast('Settings saved')
      state.session.org_name = body.org_name
      if (body.org_name) $('#brand-org').textContent = body.org_name
      if (code) navigate('settings', true)
    } catch (e) {
      toast(e.message, true)
    }
  })

  const clearBtn = $('#st-clear')
  if (clearBtn)
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Remove the access code? Anyone with the link will be able to open the tracker.')) return
      await api('/settings', { method: 'POST', body: JSON.stringify({ access_code: '' }) })
      toast('Access code removed')
      navigate('settings', true)
    })

  $('#st-export').addEventListener('click', () => downloadFile(`/api/export.csv?period=${state.periodId}`))
  $('#st-pending').addEventListener('click', () => downloadFile(`/api/pending.csv?period=${state.periodId}`))

  $('#st-reset').addEventListener('click', () => confirmReset())
}

function confirmReset() {
  const m = modal({
    title: 'Clear all sample data?',
    body: `
      <div class="notice notice-bad mb-12">
        <span class="nicon">${ico('alert')}</span>
        <div><strong>This cannot be undone</strong>
        Every staff member, reporting period, submission record and unmatched response will be deleted.
        Your settings (organisation name and access code) are kept.</div>
      </div>
      <p class="tiny muted mb-12">Type <strong class="mono">DELETE</strong> below to confirm.</p>
      <input type="text" id="reset-confirm" placeholder="DELETE" autocomplete="off" />`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="reset-go" disabled>Clear everything</button>`,
  })

  const input = m.$('#reset-confirm')
  const go = m.$('#reset-go')
  input.addEventListener('input', () => {
    go.disabled = input.value.trim() !== 'DELETE'
  })

  go.addEventListener('click', async () => {
    go.disabled = true
    go.textContent = 'Clearing…'
    try {
      await api('/reset', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) })
      m.close()
      state.periodId = null
      await reloadPeriods()
      if (state.periods.length) state.periodId = state.periods[0].id
      toast('Sample data cleared — add your staff roster to begin')
      await refreshBadges()
      navigate('roster', true)
    } catch (e) {
      toast(e.message, true)
      go.disabled = false
      go.textContent = 'Clear everything'
    }
  })
}

/* ---------------- start ---------------- */
boot().catch((e) => {
  if (e.message === 'locked') return
  console.error(e)
  $('#gate').hidden = true
  $('#shell').hidden = false
  $('#view').innerHTML = `<div class="notice notice-bad"><span class="nicon">${ico('alert')}</span><div><strong>Could not start</strong>${esc(e.message)}</div></div>`
})
