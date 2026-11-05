import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { D1Database } from '@cloudflare/workers-types'
import {
  detectColumns,
  extractRecord,
  normEmail,
  parseDate,
  parseDelimited,
  parseXlsx,
  type Mapping,
} from './lib/core'
import {
  ensureDefaultPeriod,
  ensureSchema,
  getSetting,
  log,
  newToken,
  setSetting,
} from './lib/db'
import {
  defaultPeriod,
  ensureTokens,
  matchStaff,
  periodByToken,
  progressFor,
  recordResponse,
  type Period,
  type Staff,
} from './lib/ingest'

import { seedDemo } from './lib/seed'

export type Env = { DB: D1Database }
const api = new Hono<{ Bindings: Env }>()

api.use('/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'X-Access-Code'] }))

/* ---------------- schema + defaults on every request ---------------- */
api.use('/*', async (c, next) => {
  await ensureSchema(c.env.DB)
  // Seed first: the sample data creates its own periods, so the "create one
  // default period" step must not run ahead of it and leave an empty extra.
  await seedDemo(c.env.DB).catch(() => {})
  await ensureDefaultPeriod(c.env.DB)
  await ensureTokens(c.env.DB)
  await next()
})

/* ---------------- simple access gate ---------------- */
const PUBLIC_PATHS = ['/login', '/session', '/ingest/']

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

api.use('/*', async (c, next) => {
  const path = c.req.path.replace('/api', '')
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return next()

  const code = await getSetting(c.env.DB, 'access_code')
  if (!code) return next()

  const expected = await sha(`trk:${code}`)
  const header = c.req.header('x-access-code') || ''
  const query = c.req.query('key') || ''
  const cookie = readCookie(c.req.header('cookie') || '', 'trk_access')

  if (
    (header && (await sha(`trk:${header}`)) === expected) ||
    (query && (await sha(`trk:${query}`)) === expected) ||
    (cookie && cookie === expected)
  ) {
    return next()
  }
  return c.json({ error: 'locked', message: 'Access code required.' }, 401)
})

api.post('/login', async (c) => {
  const { code } = await c.req.json<{ code?: string }>()
  const stored = await getSetting(c.env.DB, 'access_code')
  if (!stored) return c.json({ ok: true })
  if (!code || (await sha(`trk:${code}`)) !== (await sha(`trk:${stored}`))) {
    return c.json({ ok: false, message: 'That access code is not correct.' }, 401)
  }
  const token = await sha(`trk:${stored}`)
  c.header(
    'Set-Cookie',
    `trk_access=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${
      c.req.url.startsWith('https') ? '; Secure' : ''
    }`
  )
  return c.json({ ok: true })
})

api.get('/session', async (c) => {
  const code = await getSetting(c.env.DB, 'access_code')
  return c.json({ locked: !!code, org_name: await getSetting(c.env.DB, 'org_name', '') })
})

/* ---------------- periods ---------------- */
api.get('/periods', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM submissions s WHERE s.period_id = p.id) AS submitted
       FROM periods p ORDER BY p.id DESC`
  ).all<Period & { submitted: number }>()
  return c.json({ periods: rows.results ?? [] })
})

api.post('/periods', async (c) => {
  const b = await c.req.json<Partial<Period>>()
  if (!b.name?.trim()) return c.json({ error: 'A period name is required.' }, 400)
  const res = await c.env.DB.prepare(
    'INSERT INTO periods (name, form_url, due_date, status, webhook_token) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(b.name.trim(), b.form_url ?? null, b.due_date ?? null, b.status ?? 'open', newToken())
    .run()
  await log(c.env.DB, 'period.created', b.name.trim(), 'admin')
  const row = await c.env.DB.prepare('SELECT * FROM periods WHERE id = ?')
    .bind(res.meta.last_row_id)
    .first<Period>()
  return c.json({ period: row }, 201)
})

api.patch('/periods/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<Partial<Period>>()
  const cur = await c.env.DB.prepare('SELECT * FROM periods WHERE id = ?').bind(id).first<Period>()
  if (!cur) return c.json({ error: 'Period not found.' }, 404)
  await c.env.DB.prepare(
    'UPDATE periods SET name = ?, form_url = ?, due_date = ?, status = ? WHERE id = ?'
  )
    .bind(
      b.name?.trim() || cur.name,
      b.form_url ?? cur.form_url,
      b.due_date ?? cur.due_date,
      b.status ?? cur.status,
      id
    )
    .run()
  return c.json({ ok: true })
})

api.post('/periods/:id/rotate-token', async (c) => {
  const id = Number(c.req.param('id'))
  const token = newToken()
  await c.env.DB.prepare('UPDATE periods SET webhook_token = ? WHERE id = ?').bind(token, id).run()
  await log(c.env.DB, 'period.token_rotated', `Period #${id}`, 'admin')
  return c.json({ ok: true, webhook_token: token })
})

api.delete('/periods/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM submissions WHERE period_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM periods WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/* ---------------- staff roster ---------------- */
api.get('/staff', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM staff ORDER BY full_name COLLATE NOCASE'
  ).all<Staff>()
  return c.json({ staff: rows.results ?? [] })
})

api.post('/staff', async (c) => {
  const b = await c.req.json<Partial<Staff>>()
  const email = normEmail(b.email)
  if (!b.full_name?.trim()) return c.json({ error: 'Full name is required.' }, 400)
  if (!email) return c.json({ error: 'A valid email address is required.' }, 400)
  const dupe = await c.env.DB.prepare('SELECT id FROM staff WHERE email = ?').bind(email).first()
  if (dupe) return c.json({ error: `${email} is already on the roster.` }, 409)
  await c.env.DB.prepare(
    'INSERT INTO staff (full_name, email, team, role, active) VALUES (?, ?, ?, ?, 1)'
  )
    .bind(b.full_name.trim(), email, b.team ?? null, b.role ?? null)
    .run()
  return c.json({ ok: true }, 201)
})

api.patch('/staff/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<Partial<Staff>>()
  const cur = await c.env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first<Staff>()
  if (!cur) return c.json({ error: 'Staff member not found.' }, 404)
  await c.env.DB.prepare(
    'UPDATE staff SET full_name = ?, email = ?, team = ?, role = ?, active = ? WHERE id = ?'
  )
    .bind(
      b.full_name?.trim() || cur.full_name,
      normEmail(b.email) || cur.email,
      b.team ?? cur.team,
      b.role ?? cur.role,
      b.active ?? cur.active,
      id
    )
    .run()
  return c.json({ ok: true })
})

api.delete('/staff/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM submissions WHERE staff_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM staff WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

api.post('/staff/import', async (c) => {
  const text = await c.req.text()
  const { headers, rows } = parseDelimited(text)
  if (!headers.length) return c.json({ error: 'That file looks empty.' }, 400)

  const lower = headers.map((h) => h.toLowerCase())
  const find = (...names: string[]) => lower.findIndex((h) => names.some((n) => h.includes(n)))
  const cName = find('full name', 'staff name', 'employee name', 'name')
  const cEmail = find('email', 'e-mail')
  const cTeam = find('team', 'department', 'unit', 'faculty', 'school')
  const cRole = find('role', 'position', 'job title', 'title')
  if (cName < 0 || cEmail < 0) {
    return c.json({ error: 'The file needs at least a name column and an email column.' }, 400)
  }

  let added = 0
  let skipped = 0
  const problems: string[] = []
  for (const [i, r] of rows.entries()) {
    const name = (r[cName] ?? '').trim()
    const email = normEmail(r[cEmail])
    if (!name || !email) {
      if (name || r[cEmail]) problems.push(`Row ${i + 2}: missing name or valid email`)
      skipped++
      continue
    }
    const res = await c.env.DB.prepare(
      `INSERT INTO staff (full_name, email, team, role, active) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name,
         team = COALESCE(excluded.team, staff.team), role = COALESCE(excluded.role, staff.role)`
    )
      .bind(name, email, cTeam >= 0 ? r[cTeam] || null : null, cRole >= 0 ? r[cRole] || null : null)
      .run()
    if (res.meta.changes) added++
  }
  await log(c.env.DB, 'staff.imported', `${added} rows from roster file`, 'admin')
  return c.json({ ok: true, count: added, skipped, problems: problems.slice(0, 25) })
})

/* ---------------- progress / dashboard ---------------- */
api.get('/progress', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id
  if (!periodId) return c.json({ error: 'No reporting period exists yet.' }, 400)
  const rows = await progressFor(c.env.DB, periodId, {
    team: c.req.query('team') || undefined,
    q: c.req.query('q') || undefined,
    status: c.req.query('status') || undefined,
  })
  const period = await c.env.DB.prepare('SELECT * FROM periods WHERE id = ?')
    .bind(periodId)
    .first<Period>()
  return c.json({ period, rows })
})

api.get('/overview', async (c) => {
  const db = c.env.DB
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(db))?.id || 0
  const period = periodId
    ? await db.prepare('SELECT * FROM periods WHERE id = ?').bind(periodId).first<Period>()
    : null

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS roster,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM submissions s WHERE s.staff_id = staff.id AND s.period_id = ?1)
                       THEN 1 ELSE 0 END) AS submitted
         FROM staff WHERE active = 1`
    )
    .bind(periodId)
    .first<{ roster: number; submitted: number }>()

  const teams = await db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(staff.team), ''), 'Unassigned') AS team,
              COUNT(*) AS roster,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM submissions s WHERE s.staff_id = staff.id AND s.period_id = ?1)
                       THEN 1 ELSE 0 END) AS submitted
         FROM staff WHERE active = 1
        GROUP BY 1 ORDER BY 1 COLLATE NOCASE`
    )
    .bind(periodId)
    .all<{ team: string; roster: number; submitted: number }>()

  const late = period?.due_date
    ? await db
        .prepare('SELECT COUNT(*) AS n FROM submissions WHERE period_id = ? AND submitted_at > ?')
        .bind(periodId, `${period.due_date}T23:59:59.999Z`)
        .first<{ n: number }>()
    : null

  const recent = await db
    .prepare(
      `SELECT s.submitted_at, s.source, s.matched_by, st.full_name, st.email, st.team
         FROM submissions s JOIN staff st ON st.id = s.staff_id
        WHERE s.period_id = ? ORDER BY s.submitted_at DESC LIMIT 8`
    )
    .bind(periodId)
    .all()

  const unmatched = await db
    .prepare('SELECT COUNT(*) AS n FROM unmatched WHERE resolved = 0')
    .first<{ n: number }>()

  const activity = await db
    .prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 12')
    .all()

  return c.json({
    period,
    stats: {
      roster: totals?.roster ?? 0,
      submitted: totals?.submitted ?? 0,
      pending: (totals?.roster ?? 0) - (totals?.submitted ?? 0),
      late: late?.n ?? 0,
      unmatched: unmatched?.n ?? 0,
    },
    teams: teams.results ?? [],
    recent: recent.results ?? [],
    activity: activity.results ?? [],
  })
})

/* ---------------- staff training history ---------------- */
api.get('/training-history', async (c) => {
  const db = c.env.DB
  const staffId = Number(c.req.query('staff_id')) || 0
  const year = (c.req.query('year') || '').trim()
  const where: string[] = []
  const binds: (string | number)[] = []
  if (staffId) { where.push('s.staff_id = ?'); binds.push(staffId) }
  if (year && /^\d{4}$/.test(year)) { where.push("strftime('%Y', s.submitted_at) = ?"); binds.push(year) }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const historyQuery = db.prepare(
    `SELECT s.id, s.staff_id, st.full_name, st.email, st.team, st.role,
            s.training_programme, s.training_start_date, s.duration_days, s.submitted_at, s.source, s.matched_by,
            s.period_id, p.name AS period_name
       FROM submissions s JOIN staff st ON st.id = s.staff_id
       LEFT JOIN periods p ON p.id = s.period_id
       ${filter}
      ORDER BY s.submitted_at DESC, st.full_name COLLATE NOCASE`
  )
  const rows = binds.length ? await historyQuery.bind(...binds).all() : await historyQuery.all()
  const years = await db.prepare(
    "SELECT DISTINCT strftime('%Y', submitted_at) AS year FROM submissions WHERE submitted_at IS NOT NULL ORDER BY year DESC"
  ).all<{ year: string }>()
  const staff = await db.prepare('SELECT id, full_name, email, team FROM staff ORDER BY full_name COLLATE NOCASE').all()
  const records = rows.results ?? []
  const distinctStaff = new Set(records.map((r: any) => r.staff_id)).size
  return c.json({
    records,
    staff: staff.results ?? [],
    years: (years.results ?? []).map((r) => r.year).filter(Boolean),
    summary: { submissions: records.length, staff: distinctStaff, programmes: records.length },
  })
})

/* ---------------- manual actions ---------------- */
api.post('/submissions/manual', async (c) => {
  const b = await c.req.json<{ staff_id?: number; period_id?: number; submitted_at?: string; training_programme?: string; training_start_date?: string; duration_days?: number }>()
  if (!b.staff_id) return c.json({ error: 'Pick a staff member.' }, 400)
  if (!b.training_programme?.trim()) return c.json({ error: 'Enter the training programme.' }, 400)
  const periodId = b.period_id || (await defaultPeriod(c.env.DB))?.id
  if (!periodId) return c.json({ error: 'No reporting period exists yet.' }, 400)
  const when = parseDate(b.submitted_at) || new Date().toISOString()
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM submissions WHERE staff_id = ? AND period_id = ? AND LOWER(TRIM(training_programme)) = LOWER(TRIM(?))'
  ).bind(b.staff_id, periodId, b.training_programme.trim()).first()
  if (duplicate) return c.json({ error: 'This staff member already has a submission for that training programme in this reporting period.' }, 409)
  const res = await c.env.DB.prepare(
    `INSERT INTO submissions (staff_id, period_id, source, matched_by, submitted_at, notes, training_programme, training_start_date, duration_days)
     VALUES (?, ?, 'manual', 'manual', ?, 'Marked manually', ?, ?, ?)`
  )
    .bind(b.staff_id, periodId, when, b.training_programme.trim(), b.training_start_date || null, Number(b.duration_days) > 0 ? Number(b.duration_days) : null)
    .run()
  await log(
    c.env.DB,
    'submission.manual',
    `Staff #${b.staff_id} marked for '${b.training_programme.trim()}' in period #${periodId}`,
    'admin'
  )
  return c.json({ ok: true, changes: res.meta.changes })
})

api.get('/submissions', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const rows = await c.env.DB.prepare(
    `SELECT s.*, st.full_name, st.email, st.team
       FROM submissions s JOIN staff st ON st.id = s.staff_id
      WHERE s.period_id = ? ORDER BY s.submitted_at DESC`
  )
    .bind(periodId)
    .all()
  return c.json({ submissions: rows.results ?? [] })
})

api.delete('/submissions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run()
  await log(c.env.DB, 'submission.removed', `Submission #${id} removed`, 'admin')
  return c.json({ ok: true })
})

/* ---------------- unmatched responses ---------------- */
api.get('/unmatched', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.*, p.name AS period_name FROM unmatched u
       LEFT JOIN periods p ON p.id = u.period_id
      WHERE u.resolved = 0 ORDER BY u.id DESC`
  ).all()
  return c.json({ unmatched: rows.results ?? [] })
})

api.post('/unmatched/:id/link', async (c) => {
  const id = Number(c.req.param('id'))
  const { staff_id } = await c.req.json<{ staff_id: number }>()
  const row = await c.env.DB.prepare('SELECT * FROM unmatched WHERE id = ?')
    .bind(id)
    .first<{ period_id: number; email: string | null; submitted_at: string | null; id: number }>()
  if (!row) return c.json({ error: 'Response not found.' }, 404)
  const periodId = row.period_id || (await defaultPeriod(c.env.DB))?.id
  if (!periodId) return c.json({ error: 'No reporting period exists yet.' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO submissions (staff_id, period_id, source, matched_by, submitted_email, submitted_at, notes, training_programme)
     VALUES (?, ?, 'form', 'manual', ?, ?, 'Linked from inbox', 'Unspecified training programme')`
  )
    .bind(staff_id, periodId, row.email, row.submitted_at || new Date().toISOString())
    .run()
  await c.env.DB.prepare('UPDATE unmatched SET resolved = 1 WHERE id = ?').bind(id).run()
  await log(c.env.DB, 'unmatched.linked', `Response #${id} linked to staff #${staff_id}`, 'admin')
  return c.json({ ok: true })
})

api.post('/unmatched/:id/ignore', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('UPDATE unmatched SET resolved = 1 WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/* ---------------- webhook ingest ---------------- */
api.post('/ingest/:token', async (c) => {
  const period = await periodByToken(c.env.DB, c.req.param('token'))
  if (!period) return c.json({ error: 'Unknown webhook token.' }, 404)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Body must be JSON.' }, 400)
  }

  const list = Array.isArray(body) ? body : [body]
  const results = []
  for (const item of list) {
    const rec = extractRecord(item)
    if (!rec) {
      results.push({ status: 'invalid', reason: 'Could not read this payload.' })
      continue
    }
    results.push(await recordResponse(c.env.DB, period.id, rec, 'form', 'power-automate'))
  }
  return c.json({ ok: true, received: results.length, results })
})

/** Setup-page tester: parses the payload and reports what WOULD happen, recording nothing. */
api.post('/ingest-test/:periodId', async (c) => {
  const periodId = Number(c.req.param('periodId'))
  const period = await c.env.DB.prepare('SELECT * FROM periods WHERE id = ?')
    .bind(periodId)
    .first<Period>()
  if (!period) return c.json({ error: 'Period not found.' }, 404)

  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Body must be JSON.' }, 400)

  const rec = extractRecord(body)
  if (!rec) return c.json({ error: 'Could not read that payload.' }, 400)
  if (!rec.email && !rec.full_name) {
    return c.json({
      ok: false,
      parsed: rec,
      message:
        'No email address or name was found. Check that the flow sends the responder email and name fields.',
    })
  }

  const staffRows = await c.env.DB.prepare('SELECT * FROM staff').all<Staff>()
  const match = matchStaff(staffRows.results ?? [], normEmail(rec.email), rec.full_name)

  if (!match) {
    return c.json({
      ok: false,
      parsed: rec,
      message: `Parsed correctly, but "${rec.full_name ?? rec.email}" is not on the roster, so it would land in the inbox as unmatched.`,
    })
  }

  const already = await c.env.DB.prepare(
    'SELECT id FROM submissions WHERE period_id = ? AND staff_id = ? AND LOWER(TRIM(training_programme)) = LOWER(TRIM(?))'
  )
    .bind(periodId, match.staff.id, rec.training_programme?.trim() || 'Unspecified training programme')
    .first()

  return c.json({
    ok: true,
    parsed: rec,
    matched: { name: match.staff.full_name, by: match.matched_by },
    already_recorded: !!already,
    message: already
      ? `Parsed correctly and matched ${match.staff.full_name} — this training programme is already recorded for this period, so it would be skipped as a duplicate.`
      : `Parsed correctly and matched ${match.staff.full_name} by ${match.matched_by}. A real submission for '${rec.training_programme || 'Unspecified training programme'}' would be recorded.`,
  })
})

/* ---------------- bulk import (CSV / XLSX from Forms) ---------------- */
type ImportReport = {
  total_rows: number
  recorded: number
  duplicates: number
  unmatched: number
  invalid: number
  mapping: Mapping
  headers: string[]
  unmatchedList: { name: string | null; email: string | null; when: string | null }[]
}

async function runImport(
  db: D1Database,
  periodId: number,
  headers: string[],
  rows: string[][],
  override: Mapping
): Promise<ImportReport> {
  const detected = detectColumns(headers)
  const mapping: Mapping = {
    email: override.email ?? detected.email,
    name: override.name ?? detected.name,
    time: override.time ?? detected.time,
    id: override.id ?? detected.id,
  }

  const report: ImportReport = {
    total_rows: rows.length,
    recorded: 0,
    duplicates: 0,
    unmatched: 0,
    invalid: 0,
    mapping,
    headers,
    unmatchedList: [],
  }

  for (const r of rows) {
    const email = mapping.email !== undefined ? normEmail(r[mapping.email]) : null
    const name = mapping.name !== undefined ? (r[mapping.name] ?? '').trim() || null : null
    const rawTime = mapping.time !== undefined ? r[mapping.time] : null

    const rec = {
      email,
      full_name: name,
      submitted_at: parseDate(rawTime) || new Date().toISOString(),
      response_id: mapping.id !== undefined ? r[mapping.id] ?? null : null,
      training_programme: mapping.programme !== undefined ? (r[mapping.programme] || '').trim() || null : null,
      training_start_date: null,
      duration_days: null,
      notes: 'Imported from Microsoft Forms export',
      raw: { row: r },
    }

    const out = await recordResponse(db, periodId, rec, 'csv', 'import')
    if (out.status === 'recorded') report.recorded++
    else if (out.status === 'duplicate') report.duplicates++
    else if (out.status === 'unmatched') {
      report.unmatched++
      if (report.unmatchedList.length < 20)
        report.unmatchedList.push({ name, email, when: rec.submitted_at })
    } else report.invalid++
  }
  await log(
    db,
    'import',
    `${report.recorded} recorded, ${report.duplicates} duplicates, ${report.unmatched} unmatched`,
    'admin'
  )
  return report
}

api.post('/import', async (c) => {
  const periodId =
    Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  if (!periodId) return c.json({ error: 'No reporting period exists yet.' }, 400)

  const override: Mapping = {
    email: c.req.query('email_col') ? Number(c.req.query('email_col')) : undefined,
    name: c.req.query('name_col') ? Number(c.req.query('name_col')) : undefined,
    time: c.req.query('time_col') ? Number(c.req.query('time_col')) : undefined,
  }

  const ctype = c.req.header('content-type') || ''
  let headers: string[] = []
  let rows: string[][] = []

  if (ctype.includes('spreadsheetml') || ctype.includes('octet-stream')) {
    const buf = new Uint8Array(await c.req.arrayBuffer())
    ;({ headers, rows } = parseXlsx(buf))
  } else {
    ;({ headers, rows } = parseDelimited(await c.req.text()))
  }

  if (!headers.length) return c.json({ error: 'No rows found in that file.' }, 400)
  const report = await runImport(c.env.DB, periodId, headers, rows, override)
  return c.json({ ok: true, report })
})

/** Column-preview endpoint used by the import wizard. */
api.post('/import/preview', async (c) => {
  const ctype = c.req.header('content-type') || ''
  let headers: string[] = []
  let rows: string[][] = []
  if (ctype.includes('spreadsheetml') || ctype.includes('octet-stream')) {
    const buf = new Uint8Array(await c.req.arrayBuffer())
    ;({ headers, rows } = parseXlsx(buf))
  } else {
    ;({ headers, rows } = parseDelimited(await c.req.text()))
  }
  return c.json({ headers, sample: rows.slice(0, 5), detected: detectColumns(headers), total: rows.length })
})

/* ---------------- exports ---------------- */
function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

api.get('/export.csv', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const period = await c.env.DB.prepare('SELECT * FROM periods WHERE id = ?')
    .bind(periodId)
    .first<Period>()
  const rows = await progressFor(c.env.DB, periodId)

  const header = ['Staff name', 'Email', 'Team', 'Role', 'Status', 'Submitted at', 'Source', 'Matched by']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.full_name,
        r.email,
        r.team ?? '',
        r.role ?? '',
        r.submitted_at ? 'Submitted' : 'Pending',
        r.submitted_at ?? '',
        r.source ?? '',
        r.matched_by ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }
  const name = (period?.name ?? 'reports').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-tracker.csv"`,
    },
  })
})

/** Chase list: only the people who have not submitted. */
api.get('/pending.csv', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const rows = await progressFor(c.env.DB, periodId, { status: 'pending' })
  const lines = ['Staff name,Email,Team,Reminder status']
  for (const r of rows) lines.push([r.full_name, r.email, r.team ?? '', 'Not yet submitted'].map(csvEscape).join(','))
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="not-yet-submitted.csv"',
    },
  })
})

api.get('/activity', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 100').all()
  return c.json({ activity: rows.results ?? [] })
})

/* ---------------- settings ---------------- */
api.get('/settings', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const out: Record<string, string> = {}
  for (const r of rows.results ?? []) out[r.key] = r.value
  return c.json({ settings: out })
})

api.post('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>()
  const allowed = ['org_name', 'access_code', 'deadline_reminder_days', 'form_owner_email']
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue
    await setSetting(c.env.DB, k, String(v ?? ''))
  }
  await log(c.env.DB, 'settings.updated', Object.keys(body).join(', '), 'admin')
  return c.json({ ok: true })
})

/** Wipe the sample data so a real rollout starts clean. */
api.post('/reset', async (c) => {
  const { confirm } = await c.req.json<{ confirm?: string }>().catch(() => ({ confirm: '' }))
  if (confirm !== 'DELETE') {
    return c.json({ error: 'Type DELETE to confirm.' }, 400)
  }
  const db = c.env.DB
  await db.prepare('DELETE FROM submissions').run()
  await db.prepare('DELETE FROM unmatched').run()
  await db.prepare('DELETE FROM staff').run()
  await db.prepare('DELETE FROM periods').run()
  await db.prepare('DELETE FROM activity').run()
  await db.prepare("UPDATE settings SET value = '1' WHERE key = 'seeded'").run()
  await setSetting(db, 'seeded', '1')
  await log(db, 'workspace.reset', 'All records cleared for a real rollout', 'admin')
  return c.json({ ok: true })
})

api.get('/demo-status', async (c) => {
  const demo = await getSetting(c.env.DB, 'demo', '')
  const staff = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  return c.json({ demo: demo === '1', staff: staff?.n ?? 0 })
})

export default api
