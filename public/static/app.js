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
  dashboard: { title: 'Dashboard', sub: 'Report submission progress by training programme', render: renderDashboard },
  tracker: { title: 'Submission tracker', sub: 'Filter outstanding and submitted reports by training programme', render: renderTracker },
  programmes: { title: 'Programme assignments', sub: 'Manage assignments and outstanding reports', render: renderProgrammes },
  outstanding: { title: 'Outstanding reports', sub: 'Track incomplete training reports for each employee and programme', render: renderOutstandingReports },
  hcot: { title: 'HCOT Training Monitor', sub: 'Training planning workspace (integration preview)', render: renderHCOT },
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

// Insert HCOT alongside the existing navigation without altering existing pages.
const hcotNav=document.querySelector('.nav')
if(hcotNav&&!hcotNav.querySelector('[data-view="hcot"]')){
  const link=document.createElement('a')
  link.href='#/hcot';link.dataset.view='hcot'
  link.innerHTML=ico('file',18)+'<span>HCOT Training Monitor</span>'
  const after=hcotNav.querySelector('[data-view="programmes"]')
  if(after)after.insertAdjacentElement('afterend',link);else hcotNav.appendChild(link)
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
  const [pr, overview, extra] = await Promise.all([api('/programmes?period='+state.periodId),api('/overview?period='+state.periodId),api('/unassigned-submissions?period='+state.periodId)])
  const programmes=pr.programmes||[]
  const unassigned=extra.submissions||[]
  const total=programmes.reduce((n,p)=>n+Number(p.assigned||0),0)
  const submitted=programmes.reduce((n,p)=>n+Number(p.submitted||0),0)
  const pending=total-submitted
  const rate=pct(submitted,total)
  $('#topbar-actions').innerHTML='<a class="btn btn-primary" href="#/tracker">View programme tracker</a><a class="btn" href="#/programmes">Manage assignments</a>'
  el.innerHTML=
    (overview.stats?.unmatched ? notice('warn',overview.stats.unmatched+' unmatched response(s)','Review Microsoft Forms submissions that could not be matched. <a href="#/inbox">Open unmatched responses</a>'):'')+
    '<div class="grid grid-4 mt-16">'+
    '<div class="card stat stat-accent"><div class="stat-label">Training programmes</div><div class="stat-value">'+programmes.length+'</div><div class="stat-foot">Registered programmes</div></div>'+
    '<div class="card stat"><div class="stat-label">Assigned reports</div><div class="stat-value">'+total+'</div><div class="stat-foot">Staff–programme assignments</div></div>'+
    '<div class="card stat"><div class="stat-label">Reports submitted</div><div class="stat-value">'+submitted+'</div><div class="stat-foot">Matched to assignments</div></div>'+
    '<div class="card stat '+(pending?'stat-warn':'')+'"><div class="stat-label">Outstanding reports</div><div class="stat-value">'+pending+'</div><div class="stat-foot">'+rate+'% completion</div></div></div>'+
    '<div class="card mt-16"><div class="card-head"><div><h3>Training programme submission progress</h3><p>Reporting period: '+esc(overview.period?.name||'Current')+' · Each assignment counts as one expected report</p></div><button class="btn btn-sm" id="dash-programme-csv">Export programme summary</button></div>'+
    '<div class="table-wrap"><table><thead><tr><th>Training programme</th><th>Assigned staff</th><th>Submitted</th><th>Outstanding</th><th>Completion</th><th></th></tr></thead><tbody>'+
    programmes.map(p=>{const rate=pct(p.submitted,p.assigned);return '<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+p.assigned+'</td><td>'+p.submitted+'</td><td><strong>'+p.pending+'</strong></td><td style="min-width:120px"><div class="bar"><span style="width:'+rate+'%"></span></div><small>'+rate+'%</small></td><td><a class="btn btn-sm" href="#/tracker?programme='+p.id+'&status=pending">Outstanding staff</a></td></tr>'}).join('')+
    (programmes.length?'':'<tr><td colspan="6">No training programmes registered. <a href="#/programmes">Add programmes and assign staff</a>.</td></tr>')+
    '</tbody></table></div></div>'+ 
    '<div class="card mt-16"><div class="card-head"><div><h3>Additional training reports received</h3><p>Reports without staff-programme assignments; outstanding counts remain unchanged.</p></div><strong>'+unassigned.length+' received</strong></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Training programme</th><th>Submitted</th><th>Source</th></tr></thead><tbody>'+unassigned.map(r=>'<tr><td>'+esc(r.full_name)+'</td><td>'+esc(r.training_programme)+'</td><td>'+esc(fmtDateTime(r.submitted_at))+'</td><td>'+esc(r.source)+'</td></tr>').join('')+(unassigned.length?'':'<tr><td colspan="4">No additional reports for this reporting period.</td></tr>')+'</tbody></table></div></div>'
  $('#dash-programme-csv').onclick=()=>downloadProgrammeCSV(programmes)
}
function downloadProgrammeCSV(programmes) {
  const rows=[['Training programme','Assigned staff','Submitted','Outstanding','Completion %'],...programmes.map(p=>[p.name,p.assigned,p.submitted,p.pending,pct(p.submitted,p.assigned)])]
  const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download='training-programme-progress.csv';a.click();URL.revokeObjectURL(url)
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
  const pr=await api('/programmes?period='+state.periodId)
  const programmes=pr.programmes||[]
  const params=new URLSearchParams(location.hash.split('?')[1]||'')
  let selected=Number(params.get('programme'))||0
  let status=params.get('status')||'all'
  $('#topbar-actions').innerHTML='<a class="btn btn-primary" href="#/programmes">Manage programme assignments</a>'
  el.innerHTML='<div class="card"><div class="toolbar" style="display:flex;gap:10px;flex-wrap:wrap">'+
    '<label class="field" style="min-width:250px;flex:1"><span>Training programme</span><select id="tr-programme"><option value="">All training programmes</option>'+programmes.map(p=>'<option value="'+p.id+'" '+(p.id===selected?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
    '<label class="field" style="min-width:150px"><span>Report status</span><select id="tr-status"><option value="all">All assigned</option><option value="pending" '+(status==='pending'?'selected':'')+'>Outstanding</option><option value="submitted" '+(status==='submitted'?'selected':'')+'>Submitted</option></select></label>'+
    '<label class="field" style="min-width:200px"><span>Search staff</span><input type="search" id="tr-search" placeholder="Name, email or team"></label>'+
    '<button class="btn" id="tr-export-programme">Export filtered CSV</button></div><div id="tr-programme-summary" class="card-body"></div><div id="tr-table"></div></div>'
  async function refresh(){
    const programmeId=Number($('#tr-programme').value),status=$('#tr-status').value,q=$('#tr-search').value.toLowerCase().trim()
    const selectedProgrammes=programmeId?programmes.filter(p=>p.id===programmeId):programmes
    const results=await Promise.all(selectedProgrammes.map(p=>api('/programme-progress?period='+state.periodId+'&programme_id='+p.id)))
    let rows=results.flatMap((d,i)=>(d.rows||[]).map(r=>({...r,programme:selectedProgrammes[i].name,programme_id:selectedProgrammes[i].id})))
    rows=rows.filter(r=>(status==='all'||(status==='submitted'?!!r.submitted_at:!r.submitted_at))&&(!q||[r.full_name,r.email,r.team,r.programme].some(x=>String(x||'').toLowerCase().includes(q))))
    const assigned=results.reduce((n,d)=>n+d.assigned,0),submitted=results.reduce((n,d)=>n+d.submitted,0)
    $('#tr-programme-summary').innerHTML='<strong>'+selectedProgrammes.length+' programme(s) · '+assigned+' assigned · '+submitted+' submitted · '+(assigned-submitted)+' outstanding</strong><p class="muted tiny">'+rows.length+' matching staff–programme assignments shown below</p>'
    $('#tr-table').innerHTML='<div class="table-wrap"><table><thead><tr><th>Training programme</th><th>Staff member</th><th>Email</th><th>Team</th><th>Report status</th><th>Date submitted</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.programme)+'</td><td><strong>'+esc(r.full_name)+'</strong></td><td>'+esc(r.email)+'</td><td>'+esc(r.team||'—')+'</td><td>'+(r.submitted_at?'Submitted':'Outstanding')+'</td><td>'+(r.submitted_at?fmtDateTime(r.submitted_at):'—')+'</td></tr>').join('')+(rows.length?'':'<tr><td colspan="6">No assignments match these filters.</td></tr>')+'</tbody></table></div>'
    $('#tr-export-programme').onclick=()=>{const cols=[['Training programme','Staff member','Email','Team','Status','Submitted at'],...rows.map(r=>[r.programme,r.full_name,r.email,r.team||'',r.submitted_at?'Submitted':'Outstanding',r.submitted_at||''])];const csv=cols.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='programme-report-status.csv';a.click();URL.revokeObjectURL(url)}
  }
  $('#tr-programme').onchange=refresh
  $('#tr-status').onchange=refresh
  $('#tr-search').oninput=refresh
  await refresh()
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


async function renderOutstandingReports(el) {
  const period = Number(state.periodId)
  const [report, catalogue] = await Promise.all([
    api('/outstanding-programme-reports?period=' + period),
    api('/programmes?period=' + period)
  ])
  const staff = report.staff || []
  const programmes = catalogue.programmes || []
  const summary = report.summary || {}
  el.innerHTML = '<div class="card"><div class="card-head"><h3>Outstanding training reports</h3></div><div class="card-body">' +
    '<p>Each assigned employee is counted once per programme. A staff member may have both submitted and outstanding reports.</p>' +
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">' +
    [['Assigned reports',summary.assigned_reports],['Submitted reports',summary.submitted_reports],['Outstanding reports',summary.outstanding_reports],['Staff with outstanding reports',summary.staff_with_outstanding]]
      .map(x=>'<div style="min-width:130px"><strong style="font-size:24px">'+Number(x[1]||0)+'</strong><div>'+esc(x[0])+'</div></div>').join('') + '</div>' +
    '<label class="field"><span>Search employee or team</span><input type="search" id="out-search" placeholder="Name, email or team"></label>' +
    '<label class="field"><span>Programme</span><select id="out-programme"><option value="">All programmes</option>'+programmes.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select></label>' +
    '<label class="field"><span>Submission status</span><select id="out-status"><option value="pending">Outstanding only</option><option value="all">All assignments</option><option value="submitted">Submitted only</option></select></label>' +
    '<button class="btn" id="out-export">Export filtered CSV</button>' +
    '<p id="out-count" aria-live="polite"></p><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Team</th><th>Programme</th><th>Status</th></tr></thead><tbody id="out-rows"></tbody></table></div></div></div>'
  const allRows = staff.flatMap(s => {
    return (s.outstanding_programmes||[]).map(p => ({name:s.full_name,email:s.email,team:s.team||'',programme:p.training_programme,programme_id:Number(p.programme_id),status:'Outstanding'}))

  })
  // The summary API exposes only pending programme names; submitted rows are not
  // reconstructed from totals because that would misidentify individual reports.
  $('#out-status').value='pending'
  $('#out-status').querySelector('option[value="all"]').disabled=true
  $('#out-status').querySelector('option[value="submitted"]').disabled=true
  const filtered = () => {
    const q=$('#out-search').value.trim().toLowerCase(), programme=$('#out-programme').value
    return allRows.filter(r=>(!q||[r.name,r.email,r.team].some(v=>String(v||'').toLowerCase().includes(q)))&&(!programme||r.programme_id===Number(programme)))
  }
  const draw = () => {
    const rows=filtered()
    $('#out-count').textContent=rows.length+' outstanding programme reports match the filters.'
    $('#out-rows').innerHTML=rows.length?rows.map(r=>'<tr><td>'+esc(r.name)+'<div>'+esc(r.email)+'</div></td><td>'+esc(r.team)+'</td><td>'+esc(r.programme)+'</td><td>Outstanding</td></tr>').join(''):'<tr><td colspan="4">No outstanding reports match your filters.</td></tr>'
  }
  $('#out-search').addEventListener('input',draw)
  $('#out-programme').addEventListener('change',draw)
  $('#out-export').onclick=()=>{
    const rows=[['Employee','Email','Team','Programme','Status'],...filtered().map(r=>[r.name,r.email,r.team,r.programme,r.status])]
    const csv=rows.map(row=>row.map(value=>{
      const safe=String(value??'').replace(/^\s*[=+@-]/,m=>"'"+m)
      return '"'+safe.replace(/"/g,'""')+'"'
    }).join(',')).join('\r\n')
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a');a.href=url;a.download='outstanding-reports-period-'+period+'.csv';a.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  draw()
}

async function renderProgrammes(el) {
  const period=Number(state.periodId)
  const [pr,sr,ar]=await Promise.all([api('/programmes?period='+period),api('/staff'),api('/programme-assignments?period='+period)])
  const programmes=pr.programmes||[], staff=sr.staff||[]
  el.innerHTML='<div class="card"><div class="card-head"><h3>Training programmes and assignments</h3></div><div class="card-body"><label class="field"><span>New programme</span><input id="pg-name" placeholder="Enter programme name"></label><button class="btn btn-primary" id="pg-add">Add programme</button><hr><label class="field"><span>Programme to assign</span><select id="pg-choice">'+programmes.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('')+'</select></label><p>Select staff members (each can attend multiple programmes):</p><label class="field"><span>Search staff by name or email</span><input id="pg-staff-search" type="search" placeholder="Type a name or email"></label><div style="max-height:220px;overflow:auto">'+staff.map(st=>'<label style="display:block;padding:5px"><input type="checkbox" class="pg-staff" value="'+st.id+'"> '+esc(st.full_name)+' — '+esc(st.email)+'</label>').join('')+'</div><button class="btn btn-primary mt-12" id="pg-assign">Assign selected staff</button></div></div><div class="card mt-16"><div class="card-head"><h3>Programme reporting status</h3></div><div class="table-wrap"><table><thead><tr><th>Programme</th><th>Assigned</th><th>Submitted</th><th>Outstanding</th><th></th></tr></thead><tbody>'+programmes.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+p.assigned+'</td><td>'+p.submitted+'</td><td><strong>'+p.pending+'</strong></td><td><button class="btn btn-sm pg-view" data-id="'+p.id+'">View staff</button></td></tr>').join('')+'</tbody></table></div></div><div id="pg-detail" class="mt-16"></div>'
  const toolsPanel=document.createElement('div')
  toolsPanel.className='card mt-16'
  toolsPanel.innerHTML='<div class="card-head"><h3>Programme administration</h3></div><div class="card-body"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn" id="pg-tab-import">Import staff assignments</button><button class="btn" id="pg-tab-rename">Edit programme name</button></div><div id="pg-tools-content"></div></div>'
  el.insertBefore(toolsPanel,el.querySelector('.card.mt-16'))
  const panel=$('#pg-tools-content')
  $('#pg-tab-import').onclick=()=>{
    panel.innerHTML='<p>Upload a CSV or XLSX file containing <strong>Training Programme</strong> and <strong>Staff Email</strong> (or <strong>Staff Name</strong>). New programme names will be created automatically. Existing assignments are not duplicated.</p><p><a id="pg-template" href="#">Download CSV template</a></p><label class="field"><span>Assignment file</span><input type="file" id="pg-import-file" accept=".csv,.xlsx"></label><button class="btn btn-primary" id="pg-import-run">Import assignments</button><div id="pg-import-result" class="mt-12"></div>'
    $('#pg-template').onclick=e=>{e.preventDefault();const blob=new Blob(['Training Programme,Staff Email,Staff Name\r\n'],{type:'text/csv'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='programme-assignments-template.csv';link.click();URL.revokeObjectURL(url)}
    $('#pg-import-run').onclick=async()=>{
      const file=$('#pg-import-file').files[0]
      if(!file){toast('Select a CSV or XLSX file',true);return}
      const btn=$('#pg-import-run');btn.disabled=true
      try {
        const res=await fetch('/api/programme-assignments/import?period='+period,{method:'POST',credentials:'same-origin',headers:{'Content-Type':/\\.xlsx$/i.test(file.name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv'},body:file})
        const data=await res.json()
        if(!res.ok)throw new Error(data.error||'Import failed')
        const box=$('#pg-import-result')
        box.innerHTML='<p><strong>'+data.added+' assignments added</strong>; '+data.duplicates+' already existed; '+data.errors.length+' rows need attention.</p>'+data.errors.slice(0,30).map(x=>'<p>Row '+x.row+': '+esc(x.reason)+'</p>').join('')+(data.errors.length>30?'<p>Only first 30 errors shown.</p>':'')+'<button class="btn" id="pg-import-refresh">Refresh programme counts</button>'
        $('#pg-import-refresh').onclick=()=>renderProgrammes(el)
      }catch(e){toast(e.message,true)}finally{btn.disabled=false}
    }
  }
  $('#pg-tab-rename').onclick=()=>{
    panel.innerHTML='<label class="field"><span>Select programme</span><select id="pg-rename-id">'+programmes.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select></label><label class="field"><span>New programme name</span><input id="pg-rename-name" placeholder="Enter corrected programme name"></label><button class="btn btn-primary" id="pg-rename-save">Save programme name</button><p class="muted">Existing assignments remain attached to the programme. Previously submitted reports keep their original programme text.</p>'
    $('#pg-rename-id').onchange=()=>{$('#pg-rename-name').value=programmes.find(x=>String(x.id)===$('#pg-rename-id').value)?.name||''}
    $('#pg-rename-id').onchange()
    $('#pg-rename-save').onclick=async()=>{try{await api('/programmes/'+$('#pg-rename-id').value,{method:'PATCH',body:JSON.stringify({name:$('#pg-rename-name').value})});toast('Programme name updated');renderProgrammes(el)}catch(e){toast(e.message,true)}}
  }
  $('#pg-tab-import').click()
  $('#pg-staff-search').oninput=e=>{const q=e.target.value.trim().toLowerCase();$('.pg-staff').forEach(x=>{const row=x.closest('label');row.style.display=row.textContent.toLowerCase().includes(q)?'block':'none'})}
  $('#pg-add').onclick=async()=>{try{await api('/programmes',{method:'POST',body:JSON.stringify({name:$('#pg-name').value.trim()})});toast('Programme created');renderProgrammes(el)}catch(e){toast(e.message,true)}}
  $('#pg-assign').onclick=async()=>{const programme_id=Number($('#pg-choice').value),staff_ids=Array.from(document.querySelectorAll('.pg-staff')).filter(x=>x.checked).map(x=>Number(x.value));try{const r=await api('/programme-assignments',{method:'POST',body:JSON.stringify({programme_id,staff_ids,period_id:period})});toast(r.added+' staff assignments added');renderProgrammes(el)}catch(e){toast(e.message,true)}}
  document.querySelectorAll('.pg-view').forEach(b=>b.onclick=async()=>{const data=await api('/programme-progress?period='+period+'&programme_id='+b.dataset.id);$('#pg-detail').innerHTML='<div class="card"><div class="card-head"><h3>Assigned staff: '+data.assigned+' · Submitted: '+data.submitted+' · Outstanding: '+data.pending+'</h3></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>'+data.rows.map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.email)+'</td><td>'+(x.submitted_at?'Submitted':'Outstanding')+'</td><td><button class="btn btn-sm pg-remove" data-id="'+x.id+'">Unassign</button></td></tr>').join('')+'</tbody></table></div></div>';document.querySelectorAll('.pg-remove').forEach(x=>x.onclick=async()=>{if(!confirm('Remove assignment? Existing submissions will be kept.'))return;await api('/programme-assignments/'+x.dataset.id,{method:'DELETE'});renderProgrammes(el)})})
}

/* HCOT phase 2: modular screens reuse existing cards, tables and form styles. */
async function renderHCOTSection(section) {
  const el=$('#hcot-extra')
  if(!el)return
  el.innerHTML='<div class="card"><div class="card-body">Loading HCOT records…</div></div>'
  try {
    if(section==='calendar'){
      const year=new Date().getFullYear()
      const data=await api('/hcot/calendar?year='+year)
      el.innerHTML='<div class="card"><div class="card-head"><h3>Training calendar — '+year+'</h3></div><div class="table-wrap"><table><thead><tr><th>Training</th><th>Dates</th><th>Location</th><th>Participants</th></tr></thead><tbody>'+
        (data.plans||[]).map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+esc(x.start_date||'—')+' – '+esc(x.end_date||'—')+'</td><td>'+esc(x.location||'—')+'</td><td>'+x.participants+'</td></tr>').join('')+
        (data.plans.length?'':'<tr><td colspan="4">No training plans scheduled for this year.</td></tr>')+'</tbody></table></div></div>'
    }else if(section==='competencies'){
      const data=await api('/hcot/competencies')
      el.innerHTML='<div class="card"><div class="card-head"><h3>Competency library</h3></div><div class="card-body"><label class="field"><span>Competency name</span><input id="hcot-comp-name"></label><label class="field"><span>Category</span><select id="hcot-comp-cat"><option value="core">Core</option><option value="functional">Functional</option></select></label><label class="field"><span>Division</span><input id="hcot-comp-div"></label><label class="field"><span>Unit</span><input id="hcot-comp-unit"></label><label class="field"><span>Description</span><textarea id="hcot-comp-desc"></textarea></label><button class="btn btn-primary" id="hcot-comp-add">Add competency</button></div><div class="table-wrap"><table><thead><tr><th>Competency</th><th>Category</th><th>Division / unit</th></tr></thead><tbody>'+
        data.competencies.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category)+'</td><td>'+esc([x.division,x.unit].filter(Boolean).join(' / ')||'Organisation-wide')+'</td></tr>').join('')+
        (data.competencies.length?'':'<tr><td colspan="3">No competencies entered.</td></tr>')+'</tbody></table></div></div>'
      $('#hcot-comp-add').onclick=async()=>{try{await api('/hcot/competencies',{method:'POST',body:JSON.stringify({name:$('#hcot-comp-name').value,category:$('#hcot-comp-cat').value,division:$('#hcot-comp-div').value,unit:$('#hcot-comp-unit').value,description:$('#hcot-comp-desc').value})});toast('Competency added');renderHCOTSection('competencies')}catch(e){toast(e.message,true)}}
    }else if(section==='goals'){
      const data=await api('/hcot/goals')
      el.innerHTML='<div class="card"><div class="card-head"><h3>Development goals</h3></div><div class="card-body"><label class="field"><span>Goal title</span><input id="hcot-goal-title"></label><label class="field"><span>Scope</span><select id="hcot-goal-scope"><option value="unit">Unit</option><option value="individual">Individual</option></select></label><label class="field"><span>Owner / unit label</span><input id="hcot-goal-owner"></label><label class="field"><span>Target date</span><input type="date" id="hcot-goal-date"></label><label class="field"><span>Measure / KPI</span><input id="hcot-goal-measure"></label><label class="field"><span>Target value</span><input id="hcot-goal-value"></label><button class="btn btn-primary" id="hcot-goal-add">Add draft goal</button></div><div class="table-wrap"><table><thead><tr><th>Goal</th><th>Scope</th><th>Owner</th><th>Target</th></tr></thead><tbody>'+
        data.goals.map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+esc(x.scope)+'</td><td>'+esc(x.owner_label||'—')+'</td><td>'+esc(x.target_date||'—')+'</td></tr>').join('')+
        (data.goals.length?'':'<tr><td colspan="4">No goals entered.</td></tr>')+'</tbody></table></div></div>'
      $('#hcot-goal-add').onclick=async()=>{try{await api('/hcot/goals',{method:'POST',body:JSON.stringify({title:$('#hcot-goal-title').value,scope:$('#hcot-goal-scope').value,owner_label:$('#hcot-goal-owner').value,target_date:$('#hcot-goal-date').value,measure:$('#hcot-goal-measure').value,target_value:$('#hcot-goal-value').value})});toast('Draft goal added');renderHCOTSection('goals')}catch(e){toast(e.message,true)}}
    }else if(section==='identity'){
      const [d,m,x,auditApproval]=await Promise.all([api('/hcot/identity-audit'),api('/hcot/mapping-readiness'),api('/hcot/mapping-exceptions'),api('/hcot/mapping-approval-status')])
      el.innerHTML='<div class="card"><div class="card-head"><h3>Staff identity integrity audit</h3></div><div class="card-body"><p>Read-only checks against the existing tracker staff roster. No records are synchronized or modified.</p><p><strong>'+d.verified_links+'</strong> verified staff links · <strong>'+d.participant_records+'</strong> HCOT participant records · <strong>'+d.inactive_participants+'</strong> inactive staff assignments · <strong>'+d.missing_staff+'</strong> missing staff references</p><p>Mapping readiness: '+m.summary.active_verified_links+' active verified links, '+m.summary.unlinked_participants+' unlinked participants, '+m.summary.orphan_links+' orphan links, '+m.summary.inactive_links+' inactive links. Automatic synchronization remains disabled.</p></div><div class="table-wrap"><table><thead><tr><th>Training plan</th><th>Participants</th><th>Unverified links</th><th>Missing staff</th><th>Inactive staff</th></tr></thead><tbody>'+(x.plans||[]).map(p=>'<tr><td>'+esc(p.training_title)+'</td><td>'+p.participants+'</td><td>'+p.unverified+'</td><td>'+p.missing+'</td><td>'+p.inactive+'</td></tr>').join('')+((x.plans||[]).length?'':'<tr><td colspan="5">No HCOT training plans yet.</td></tr>')+'</tbody></table></div></div>'
      el.insertAdjacentHTML('beforeend','<div class="card"><div class="card-head"><h3>Approval workflow readiness</h3></div><div class="card-body"><p>Pending: '+auditApproval.counts.pending+' · Approved: '+auditApproval.counts.approved+' · Rejected: '+auditApproval.counts.rejected+'</p><p>Named administrator authentication and independent maker/checker approval are not yet available. Mapping approvals remain blocked.</p></div></div>')
      el.insertAdjacentHTML('beforeend','<div class="card mt-16"><div class="card-head"><h3>Validate proposed staff mapping</h3></div><div class="card-body"><p>Review only. This does not create a link or change employee records.</p><label class="field"><span>HCOT staff number</span><input id="hcot-map-number" maxlength="64"></label><label class="field"><span>Tracker staff ID</span><input id="hcot-map-staff" type="number" min="1" step="1"></label><button class="btn" id="hcot-map-check">Check mapping</button><p id="hcot-map-result" role="status"></p></div></div>')
      $('#hcot-map-check').onclick=async()=>{
        const output=$('#hcot-map-result')
        output.textContent='Checking mapping…'
        try {
          const r=await api('/hcot/mapping-validate',{method:'POST',body:JSON.stringify({
            hcot_staff_number:$('#hcot-map-number').value,tracker_staff_id:Number($('#hcot-map-staff').value)
          })})
          output.textContent=r.issues.length?'Review required: '+r.issues.join(', '):r.already_linked?'Existing verified link found.':'No collisions found. Independent approval is still required.'
        }catch(e){output.textContent='Validation unavailable: '+e.message}
      }
    }else if(section==='handshake'){
      const period=Number(state.periodId)
      const data=await api('/hcot/handshake-preview?period='+period)
      const summary=data.summary||{}
      el.innerHTML='<div class="card"><div class="card-head"><h3>HCOT ↔ Tracker handshake preview</h3></div><div class="card-body"><p>This is a read-only reconciliation. It does not create programmes, change staff records, or assign participants.</p><p><strong>'+summary.plans+' plans</strong> · '+summary.matched+' matched programmes · '+summary.new_programmes+' new programme names · '+summary.ambiguous+' ambiguous matches · '+summary.assignments_to_add+' potential assignments · '+(summary.blocked_participants||0)+' participants blocked pending programme mapping</p></div><div class="table-wrap"><table><thead><tr><th>HCOT training</th><th>Programme match</th><th>Participants</th><th>Already assigned</th><th>Potential additions</th></tr></thead><tbody>'+
        data.plans.map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+esc(x.match_status.replace('_',' '))+'</td><td>'+x.participants+'</td><td>'+x.already_assigned+'</td><td>'+x.would_assign+'</td></tr>').join('')+
        (data.plans.length?'':'<tr><td colspan="5">No HCOT plans to reconcile.</td></tr>')+'</tbody></table></div></div>'
    }else if(section==='costing'){
      const data=await api('/hcot/cost-estimates')
      el.innerHTML='<div class="card"><div class="card-head"><h3>DTA / Estacode costing register</h3></div><div class="card-body"><p>Read-only register. No payment authorization or costing confirmation is enabled until approved rates, identity verification and segregation of duties are implemented.</p></div><div class="table-wrap"><table><thead><tr><th>Training</th><th>Staff</th><th>Currency</th><th>Estimated total</th><th>Status</th></tr></thead><tbody>'+
        data.estimates.map(x=>'<tr><td>'+esc(x.training_title)+'</td><td>'+esc(x.staff_name)+'</td><td>'+esc(x.currency)+'</td><td>'+Number(x.total_amount).toLocaleString()+'</td><td>'+esc(x.status)+'</td></tr>').join('')+
        (data.estimates.length?'':'<tr><td colspan="5">No cost estimates recorded.</td></tr>')+'</tbody></table></div></div>'
    }else if(section==='reviews'){
      const data=await api('/hcot/plans')
      el.innerHTML='<div class="card"><div class="card-head"><h3>Supervisor evaluations</h3></div><div class="card-body"><p class="muted">Read-only pending review register. Evaluation submission will be enabled after supervisor identity and permissions are verified.</p><label class="field"><span>Training plan</span><select id="hcot-review-plan"><option value="">Select a plan</option>'+data.plans.map(x=>'<option value="'+x.id+'">'+esc(x.title)+'</option>').join('')+'</select></label><div id="hcot-review-list"></div></div></div>'
      $('#hcot-review-plan').onchange=async()=>{const id=Number($('#hcot-review-plan').value);if(!id)return;const result=await api('/hcot/reviews?plan_id='+id);$('#hcot-review-list').innerHTML='<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Review status</th></tr></thead><tbody>'+result.reviews.map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.status||'Pending')+'</td></tr>').join('')+'</tbody></table></div>'}
    }
  }catch(e){el.innerHTML='<div class="notice notice-bad">'+esc(e.message)+'</div>'}
}

/* HCOT unified module: draft planning only until security and synchronization are validated. */
async function renderHCOT(el) {
  const [data,roster]=await Promise.all([api('/hcot/plans'),api('/staff')])
  const plans=data.plans||[],staff=roster.staff||[]
  el.innerHTML='<div class="card"><div class="card-body"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn hcot-tab" data-section="calendar">Calendar</button><button class="btn hcot-tab" data-section="competencies">Competencies</button><button class="btn hcot-tab" data-section="goals">Goals & KPIs</button><button class="btn hcot-tab" data-section="reviews">Evaluations</button><button class="btn hcot-tab" data-section="costing">Costing</button><button class="btn hcot-tab" data-section="handshake">Tracker handshake</button><button class="btn hcot-tab" data-section="identity">Staff identity audit</button></div></div></div><div id="hcot-extra" class="mt-16"></div><div class="card mt-16"><div class="card-head"><div><h3>HCOT Training Monitor — Training planning</h3><p>Unified workspace preview. Draft plans do not automatically create report assignments.</p></div></div><div class="card-body"><label class="field"><span>Training programme title</span><input id="hcot-title" placeholder="Enter training title"></label><div class="grid grid-2"><label class="field"><span>Start date</span><input id="hcot-start" type="date"></label><label class="field"><span>End date</span><input id="hcot-end" type="date"></label></div><label class="field"><span>Location</span><input id="hcot-location"></label><label class="field"><span>Provider</span><input id="hcot-provider"></label><button class="btn btn-primary" id="hcot-create">Create draft training plan</button></div></div>'+
  '<div class="card mt-16"><div class="card-head"><h3>HCOT draft training plans</h3></div><div class="table-wrap"><table><thead><tr><th>Training</th><th>Dates</th><th>Location</th><th>Participants</th><th></th></tr></thead><tbody>'+
  plans.map(p=>'<tr><td>'+esc(p.title)+'</td><td>'+esc(p.start_date||'—')+' – '+esc(p.end_date||'—')+'</td><td>'+esc(p.location||'—')+'</td><td>'+p.participant_count+'</td><td><button class="btn btn-sm hcot-manage" data-id="'+p.id+'">Manage participants</button></td></tr>').join('')+
  (plans.length?'':'<tr><td colspan="5">No draft training plans yet.</td></tr>')+'</tbody></table></div></div><div id="hcot-participants" class="mt-16"></div>'
  $$('.hcot-tab').forEach(btn=>btn.onclick=()=>renderHCOTSection(btn.dataset.section))
  renderHCOTSection('calendar')
  $('#hcot-create').onclick=async()=>{
    try {
      await api('/hcot/plans',{method:'POST',body:JSON.stringify({title:$('#hcot-title').value,start_date:$('#hcot-start').value,end_date:$('#hcot-end').value,location:$('#hcot-location').value,provider:$('#hcot-provider').value})})
      toast('Draft training plan created');renderHCOT(el)
    }catch(e){toast(e.message,true)}
  }
  $$('.hcot-manage').forEach(btn=>btn.onclick=async()=>{
    const id=Number(btn.dataset.id),participants=await api('/hcot/plans/'+id+'/participants')
    const selected=new Set((participants.staff||[]).map(x=>x.id))
    $('#hcot-participants').innerHTML='<div class="card"><div class="card-head"><h3>Participants — '+esc(plans.find(p=>p.id===id)?.title||'')+'</h3></div><div class="card-body"><label class="field"><span>Search staff</span><input id="hcot-search" type="search" placeholder="Name or email"></label><div style="max-height:230px;overflow:auto">'+staff.map(x=>'<label class="hcot-staff-row" style="display:block;padding:5px"><input type="checkbox" class="hcot-staff" value="'+x.id+'" '+(selected.has(x.id)?'checked disabled':'')+'> '+esc(x.full_name)+' — '+esc(x.email)+'</label>').join('')+'</div><button class="btn btn-primary mt-12" id="hcot-add">Add selected participants</button></div></div>'
    $('#hcot-search').oninput=e=>{const q=e.target.value.toLowerCase();$$('.hcot-staff-row').forEach(row=>row.style.display=row.textContent.toLowerCase().includes(q)?'block':'none')}
    $('#hcot-add').onclick=async()=>{try{const ids=$$('.hcot-staff').filter(x=>x.checked&&!x.disabled).map(x=>Number(x.value));const r=await api('/hcot/plans/'+id+'/participants',{method:'POST',body:JSON.stringify({staff_ids:ids})});toast(r.added+' participants added');renderHCOT(el)}catch(e){toast(e.message,true)}}
  })
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
