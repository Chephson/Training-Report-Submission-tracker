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
import { previewHandshake } from './lib/hcot-handshake'
import { verifyAccessJwt } from './lib/hcot-access'
import { isHcotViewerRead } from './lib/hcot-roles'

export type Env = { DB: D1Database; HCOT_ACCESS_TEAM_DOMAIN?: string; HCOT_ACCESS_AUD?: string; HCOT_SETTINGS_ADMIN_EMAILS?: string }
const api = new Hono<{ Bindings: Env }>()

api.use('/*', cors({ origin: (origin, c) => { try { return new URL(origin).origin === new URL(c.req.url).origin ? origin : '' } catch { return '' } }, allowHeaders: ['Content-Type', 'X-Access-Code'] }))

/* Reject HCOT requests with missing Access configuration before any D1 work.
   The existing authentication middleware still validates the JWT and access code. */
api.use('/hcot/*', async (c, next) => {
  if (!c.env.HCOT_ACCESS_TEAM_DOMAIN?.trim() || !c.env.HCOT_ACCESS_AUD?.trim()) {
    return c.json({
      error: 'HCOT Access verification not configured.',
      code: 'HCOT_ACCESS_CONFIG_MISSING',
      environment_variables_required: ['HCOT_ACCESS_TEAM_DOMAIN', 'HCOT_ACCESS_AUD'],
      guidance: 'Configure both variables in the Cloudflare Pages environment serving this deployment, then redeploy.',
    }, 503)
  }
  const assertion = c.req.header('cf-access-jwt-assertion')
  const hasAccessCookie = (c.req.header('cookie') || '').split(';').some(part => part.trim().startsWith('CF_Authorization='))
  if (!assertion && !hasAccessCookie) return c.json({
    error: 'Cloudflare Access JWT not received in assertion header or authorization cookie.',
    code: 'HCOT_ACCESS_ASSERTION_MISSING',
    guidance: 'Check that the Access application protects the exact preview hostname and /api/hcot/* paths, and that the browser sends the Access session cookie. Do not disable Access.',
  }, 401)
  const identity = await verifyAccessJwt(c.req.raw, c.env)
  if (!identity) return c.json({
    error: 'Cloudflare Access JWT verification failed.',
    code: 'HCOT_ACCESS_ASSERTION_REJECTED',
    guidance: 'Check the Access application AUD, team domain, token validity and Access JWKS availability.',
  }, 401)
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
  if (path === '/login' || path === '/session' || path.startsWith('/ingest/')) return next()

  if (path === '/hcot' || path.startsWith('/hcot/')) {
    if (!c.env.HCOT_ACCESS_TEAM_DOMAIN?.trim() || !c.env.HCOT_ACCESS_AUD?.trim()) {
      return c.json({
        error: 'HCOT Access verification not configured.',
        code: 'HCOT_ACCESS_CONFIG_MISSING',
        environment_variables_required: ['HCOT_ACCESS_TEAM_DOMAIN', 'HCOT_ACCESS_AUD'],
        guidance: 'Configure both variables in the Cloudflare Pages environment serving this deployment, then redeploy.',
      }, 503)
    }
    const identity = await verifyAccessJwt(c.req.raw, c.env)
    if (!identity) return c.json({ error: 'Cloudflare Access authentication required.' }, 401)
  }

  // On a brand-new installation the settings table may not exist yet.
  // A missing table means first-time setup; other database errors fail closed.
  let code = ''
  try {
    code = await getSetting(c.env.DB, 'access_code')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/no such table:\s*settings\b/i.test(message)) {
      return c.json({ error: 'Tracker authorization unavailable.' }, 503)
    }
  }
  if (!code) {
    if (path.startsWith('/hcot/')) return c.json({ error: 'HCOT access is disabled until the tracker access code is configured.' }, 403)
    // On HCOT-enabled Preview, bootstrap may configure the first access code
    // through the separately verified Access-admin settings route only.
    // Do not expose other tracker endpoints before setup completes.
    if (c.env.HCOT_ACCESS_TEAM_DOMAIN || c.env.HCOT_ACCESS_AUD) {
      if (path === '/settings' && c.req.method.toUpperCase() === 'POST') return next()
      return c.json({ error: 'Tracker setup required before accessing this endpoint.', code: 'TRACKER_SETUP_REQUIRED' }, 403)
    }
    return next()
  }

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

/* P0: HCOT least-privilege authorization. The shared tracker access code is NOT a role.
   All HCOT requests first pass the verified Cloudflare Access JWT gate.
   Stage 1: verified HR viewers may read only explicitly allowlisted HCOT resources.
   Every other HCOT operation (including all writes) requires a named administrator. */
api.use('/hcot/*', async (c, next) => {
  const path = c.req.path.replace(/^\/api/, '')
  const method = c.req.method.toUpperCase()
  // Explicit allowlist, not a broad "all GET" exception. New endpoints fail closed.
  const viewerRead = isHcotViewerRead(method, path)
  if (viewerRead) return next()
  const configured = c.env.HCOT_SETTINGS_ADMIN_EMAILS
  const admins = (configured || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
  if (!admins.length) return c.json({ error: 'HCOT administrator authorization is not configured.' }, 503)
  const identity = await verifyAccessJwt(c.req.raw, c.env)
  if (!identity) return c.json({ error: 'Verified Cloudflare Access identity required.' }, 401)
  if (!admins.includes(identity.email.trim().toLowerCase())) return c.json({ error: 'HCOT administrator permission required.' }, 403)
  await next()
})

/* Schema/bootstrap writes occur only after authorization.
   Verified HCOT viewer requests remain strictly read-only, including middleware. */
api.use('/*', async (c, next) => {
  if (isHcotViewerRead(c.req.method, c.req.path.replace(/^\/api/, ''))) return next()
  await ensureSchema(c.env.DB)
  await next()
})

/* Do not let an otherwise read-only HCOT viewer request seed or rotate
   tracker data. Administrative operations keep the existing bootstrap path. */
api.use('/*', async (c, next) => {
  if (isHcotViewerRead(c.req.method, c.req.path.replace(/^\/api/, ''))) return next()
  // Seed first: sample data creates its own periods.
  await seedDemo(c.env.DB).catch(() => {})
  await ensureDefaultPeriod(c.env.DB)
  await ensureTokens(c.env.DB)
  await next()
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

/* ---------------- division-scoped staff directory ---------------- */
// Existing staff.team / staff.role store division / department respectively.
// Preserve staff IDs, historical reports and HCOT foreign keys.
api.get('/staff-directory/divisions', async c => {
  const rows = await c.env.DB.prepare(`SELECT name FROM staff_divisions UNION SELECT DISTINCT TRIM(team) AS name FROM staff WHERE team IS NOT NULL AND TRIM(team) <> '' ORDER BY name COLLATE NOCASE`).all<{name:string}>()
  return c.json({ options:(rows.results ?? []).map(r=>r.name) })
})
api.get('/staff-directory/departments', async c => {
  const division = String(c.req.query('division') ?? '').trim()
  if (!division) return c.json({ error:'Select a division first.' },400)
  const rows = await c.env.DB.prepare(`SELECT name FROM staff_departments WHERE division_name = ? COLLATE NOCASE UNION SELECT DISTINCT TRIM(role) AS name FROM staff WHERE team = ? COLLATE NOCASE AND role IS NOT NULL AND TRIM(role) <> '' ORDER BY name COLLATE NOCASE`).bind(division,division).all<{name:string}>()
  return c.json({ options:(rows.results ?? []).map(r=>r.name) })
})
api.get('/staff-directory/units', async c => {
  const division=String(c.req.query('division') ?? '').trim(), department=String(c.req.query('department') ?? '').trim()
  if(!division || !department) return c.json({options:[]})
  const rows=await c.env.DB.prepare(`SELECT name FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE UNION SELECT DISTINCT TRIM(unit) AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit IS NOT NULL AND TRIM(unit)<>'' ORDER BY name COLLATE NOCASE`).bind(division,department,division,department).all<{name:string}>()
  return c.json({options:(rows.results??[]).map(r=>r.name)})
})
api.post('/staff-directory/units', async c => {
  const b=await c.req.json<{division?:string;department?:string;name?:string}>()
  const division=String(b.division??'').trim(),department=String(b.department??'').trim(),name=String(b.name??'').trim()
  if(!division || !department || !name || name.length>120) return c.json({error:'Choose division, department and unit name (1–120 characters).'},400)
  const valid=await validateStaffDirectory(c.env.DB,division,department,null)
  if(valid) return c.json({error:valid},400)
  const exists=await c.env.DB.prepare(`SELECT name FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT unit AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE LIMIT 1`).bind(division,department,name,division,department,name).first()
  if(exists) return c.json({error:'Unit already exists in this department.'},409)
  await c.env.DB.prepare('INSERT INTO staff_units(division_name,department_name,name) VALUES(?,?,?)').bind(division,department,name).run()
  return c.json({ok:true},201)
})
api.patch('/staff-directory/units', async c => {
  const b=await c.req.json<{division?:string;department?:string;old_name?:string;name?:string}>()
  const division=String(b.division??'').trim(),department=String(b.department??'').trim(),old=String(b.old_name??'').trim(),name=String(b.name??'').trim()
  if(!division || !department || !old || !name || name.length>120) return c.json({error:'Division, department and valid unit names required.'},400)
  const exists=await c.env.DB.prepare(`SELECT name FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT unit AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE LIMIT 1`).bind(division,department,old,division,department,old).first()
  if(!exists) return c.json({error:'Unit not found in selected department.'},404)
  if(old.toLowerCase()!==name.toLowerCase()){
    const conflict=await c.env.DB.prepare(`SELECT name FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT unit AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE LIMIT 1`).bind(division,department,name,division,department,name).first()
    if(conflict) return c.json({error:'Unit already exists in this department.'},409)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE staff SET unit=? WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE').bind(name,division,department,old),
    c.env.DB.prepare('DELETE FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE').bind(division,department,old),
    c.env.DB.prepare('INSERT OR IGNORE INTO staff_units(division_name,department_name,name) VALUES(?,?,?)').bind(division,department,name)
  ])
  return c.json({ok:true})
})
api.delete('/staff-directory/units', async c => {
  const division=String(c.req.query('division')??'').trim(),department=String(c.req.query('department')??'').trim(),name=String(c.req.query('name')??'').trim()
  if(!division || !department || !name) return c.json({error:'Division, department and unit required.'},400)
  const used=await c.env.DB.prepare('SELECT id FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE LIMIT 1').bind(division,department,name).first()
  if(used) return c.json({error:'Reassign staff before deleting this unit.'},409)
  const result=await c.env.DB.prepare('DELETE FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE').bind(division,department,name).run()
  return result.meta.changes?c.json({ok:true}):c.json({error:'Unit not found.'},404)
})

api.post('/staff-directory/divisions', async c => {
  const {name:raw} = await c.req.json<{name?:string}>()
  const name=String(raw ?? '').trim()
  if (!name || name.length>120) return c.json({error:'Division name must contain 1–120 characters.'},400)
  const found=await c.env.DB.prepare(`SELECT name FROM staff_divisions WHERE name=? COLLATE NOCASE UNION SELECT team AS name FROM staff WHERE team=? COLLATE NOCASE LIMIT 1`).bind(name,name).first()
  if(found) return c.json({error:'Division already exists.'},409)
  await c.env.DB.prepare('INSERT INTO staff_divisions(name) VALUES(?)').bind(name).run()
  return c.json({ok:true},201)
})
api.post('/staff-directory/departments', async c => {
  const body=await c.req.json<{name?:string;division?:string}>()
  const name=String(body.name ?? '').trim(), division=String(body.division ?? '').trim()
  if(!name || name.length>120 || !division) return c.json({error:'Choose a division and enter a department name (1–120 characters).'},400)
  const valid=await c.env.DB.prepare(`SELECT name FROM staff_divisions WHERE name=? COLLATE NOCASE UNION SELECT team AS name FROM staff WHERE team=? COLLATE NOCASE LIMIT 1`).bind(division,division).first()
  if(!valid) return c.json({error:'Division does not exist.'},400)
  const found=await c.env.DB.prepare(`SELECT name FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT role AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE LIMIT 1`).bind(division,name,division,name).first()
  if(found) return c.json({error:'Department already exists in this division.'},409)
  await c.env.DB.prepare('INSERT INTO staff_departments(division_name,name) VALUES(?,?)').bind(division,name).run()
  return c.json({ok:true},201)
})
api.patch('/staff-directory/divisions', async c => {
  const b=await c.req.json<{old_name?:string;name?:string}>()
  const old=String(b.old_name ?? '').trim(),name=String(b.name ?? '').trim()
  if(!old || !name || name.length>120) return c.json({error:'Valid division names are required.'},400)
  const exists=await c.env.DB.prepare(`SELECT name FROM staff_divisions WHERE name=? COLLATE NOCASE UNION SELECT team AS name FROM staff WHERE team=? COLLATE NOCASE LIMIT 1`).bind(old,old).first()
  if(!exists) return c.json({error:'Division not found.'},404)
  if(old.toLowerCase()!==name.toLowerCase()){
    const conflict=await c.env.DB.prepare(`SELECT name FROM staff_divisions WHERE name=? COLLATE NOCASE UNION SELECT team AS name FROM staff WHERE team=? COLLATE NOCASE LIMIT 1`).bind(name,name).first()
    if(conflict) return c.json({error:'Division already exists.'},409)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE staff SET team=? WHERE team=? COLLATE NOCASE').bind(name,old),
    c.env.DB.prepare('UPDATE staff_departments SET division_name=? WHERE division_name=? COLLATE NOCASE').bind(name,old),
    c.env.DB.prepare('UPDATE staff_units SET division_name=? WHERE division_name=? COLLATE NOCASE').bind(name,old),
    c.env.DB.prepare('DELETE FROM staff_divisions WHERE name=? COLLATE NOCASE').bind(old),
    c.env.DB.prepare('INSERT OR IGNORE INTO staff_divisions(name) VALUES(?)').bind(name),
  ])
  return c.json({ok:true})
})
api.patch('/staff-directory/departments', async c => {
  const b=await c.req.json<{old_name?:string;name?:string;division?:string}>()
  const old=String(b.old_name ?? '').trim(),name=String(b.name ?? '').trim(),division=String(b.division ?? '').trim()
  if(!old || !name || name.length>120 || !division) return c.json({error:'Division and valid department names required.'},400)
  const exists=await c.env.DB.prepare(`SELECT name FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT role AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE LIMIT 1`).bind(division,old,division,old).first()
  if(!exists) return c.json({error:'Department not found in selected division.'},404)
  if(old.toLowerCase()!==name.toLowerCase()){
    const conflict=await c.env.DB.prepare(`SELECT name FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT role AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE LIMIT 1`).bind(division,name,division,name).first()
    if(conflict) return c.json({error:'Department already exists in this division.'},409)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE staff SET role=? WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE').bind(name,division,old),
    c.env.DB.prepare('DELETE FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE').bind(division,old),
    c.env.DB.prepare('UPDATE staff_units SET department_name=? WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE').bind(name,division,old),
    c.env.DB.prepare('INSERT OR IGNORE INTO staff_departments(division_name,name) VALUES(?,?)').bind(division,name),
  ])
  return c.json({ok:true})
})
api.delete('/staff-directory/divisions', async c => {
  const name=String(c.req.query('name') ?? '').trim()
  if(!name) return c.json({error:'Division name required.'},400)
  const used=await c.env.DB.prepare('SELECT id FROM staff WHERE team=? COLLATE NOCASE LIMIT 1').bind(name).first()
  const child=await c.env.DB.prepare('SELECT id FROM staff_departments WHERE division_name=? COLLATE NOCASE LIMIT 1').bind(name).first()
  const unitChild=await c.env.DB.prepare('SELECT id FROM staff_units WHERE division_name=? COLLATE NOCASE LIMIT 1').bind(name).first()
  if(used || child || unitChild) return c.json({error:'Reassign staff and remove linked departments and units before deleting this division.'},409)
  const res=await c.env.DB.prepare('DELETE FROM staff_divisions WHERE name=? COLLATE NOCASE').bind(name).run()
  return res.meta.changes ? c.json({ok:true}) : c.json({error:'Division not found.'},404)
})
api.delete('/staff-directory/departments', async c => {
  const name=String(c.req.query('name') ?? '').trim(),division=String(c.req.query('division') ?? '').trim()
  if(!name || !division) return c.json({error:'Division and department required.'},400)
  const used=await c.env.DB.prepare('SELECT id FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE LIMIT 1').bind(division,name).first()
  if(used) return c.json({error:'Reassign staff before deleting this department.'},409)
  const unitChild=await c.env.DB.prepare('SELECT id FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE LIMIT 1').bind(division,name).first()
  if(unitChild) return c.json({error:'Remove linked units before deleting this department.'},409)
  const res=await c.env.DB.prepare('DELETE FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE').bind(division,name).run()
  return res.meta.changes ? c.json({ok:true}) : c.json({error:'Department not found.'},404)
})

async function validateStaffDirectory(db:D1Database, division:string|null, department:string|null, unit:string|null=null){
  if(department && !division) return 'Select a division before choosing a department.'
  if(division){
    const valid=await db.prepare(`SELECT name FROM staff_divisions WHERE name=? COLLATE NOCASE UNION SELECT team AS name FROM staff WHERE team=? COLLATE NOCASE LIMIT 1`).bind(division,division).first()
    if(!valid) return 'Select a valid division from the directory.'
  }
  if(department){
    const valid=await db.prepare(`SELECT name FROM staff_departments WHERE division_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT role AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE LIMIT 1`).bind(division,department,division,department).first()
    if(!valid) return 'Department must belong to the selected division.'
  }
  if(unit){
    if(!division || !department) return 'Select a division and department before choosing a unit.'
    const valid=await db.prepare(`SELECT name FROM staff_units WHERE division_name=? COLLATE NOCASE AND department_name=? COLLATE NOCASE AND name=? COLLATE NOCASE UNION SELECT unit AS name FROM staff WHERE team=? COLLATE NOCASE AND role=? COLLATE NOCASE AND unit=? COLLATE NOCASE LIMIT 1`).bind(division,department,unit,division,department,unit).first()
    if(!valid) return 'Unit must belong to the selected department.'
  }
  return null
}

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
  const directoryError = await validateStaffDirectory(c.env.DB, b.team?.trim() || null, b.role?.trim() || null, b.unit?.trim() || null)
  if (directoryError) return c.json({ error: directoryError }, 400)
  await c.env.DB.prepare(
    'INSERT INTO staff (full_name, email, team, role, unit, active) VALUES (?, ?, ?, ?, ?, 1)'
  )
    .bind(b.full_name.trim(), email, b.team || null, b.role || null, b.unit || null)
    .run()
  return c.json({ ok: true }, 201)
})

api.patch('/staff/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<Partial<Staff>>()
  const cur = await c.env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first<Staff>()
  if (!cur) return c.json({ error: 'Staff member not found.' }, 404)
  const directoryError = await validateStaffDirectory(c.env.DB, b.team === undefined ? cur.team : b.team?.trim() || null, b.role === undefined ? cur.role : b.role?.trim() || null, b.unit === undefined ? cur.unit : b.unit?.trim() || null)
  if (directoryError) return c.json({ error: directoryError }, 400)
  await c.env.DB.prepare(
    'UPDATE staff SET full_name = ?, email = ?, team = ?, role = ?, unit = ?, active = ? WHERE id = ?'
  )
    .bind(
      b.full_name?.trim() || cur.full_name,
      normEmail(b.email) || cur.email,
      b.team === undefined ? cur.team : b.team || null,
      b.role === undefined ? cur.role : b.role || null,
      b.unit === undefined ? cur.unit : b.unit || null,
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
  const cTeam = find('division', 'team')
  const cRole = find('department', 'role')
  const cUnit = find('unit')
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
    const division = cTeam >= 0 ? (r[cTeam] || '').trim() : ''
    const department = cRole >= 0 ? (r[cRole] || '').trim() : ''
    // CSV import must not bypass the division/department relationship.
    // Existing legacy rows are still readable; imported values require a valid pair.
    const unit = cUnit >= 0 ? (r[cUnit] || '').trim() : ''
    const directoryError = await validateStaffDirectory(c.env.DB, division || null, department || null, unit || null)
    if (directoryError) {
      problems.push(`Row ${i + 2}: ${directoryError}`)
      skipped++
      continue
    }
    const res = await c.env.DB.prepare(
      `INSERT INTO staff (full_name, email, team, role, unit, active) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name,
         team = CASE WHEN ? = 1 THEN excluded.team ELSE staff.team END,
         role = CASE WHEN ? = 1 THEN excluded.role ELSE staff.role END,
         unit = CASE WHEN ? = 1 THEN excluded.unit ELSE staff.unit END`
    )
      .bind(name, email, division || null, department || null, unit || null, cTeam >= 0 ? 1 : 0, cRole >= 0 ? 1 : 0, cUnit >= 0 ? 1 : 0)
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

/* ---------------- programme catalogue and assignments ---------------- */
api.get('/programmes', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const rows = await c.env.DB.prepare(`SELECT p.*,
    (SELECT COUNT(DISTINCT a.staff_id) FROM programme_assignments a WHERE a.programme_id=p.id AND a.period_id=?) AS assigned,
    (SELECT COUNT(DISTINCT a.staff_id) FROM programme_assignments a WHERE a.programme_id=p.id AND a.period_id=?
      AND EXISTS (SELECT 1 FROM submissions s WHERE s.staff_id=a.staff_id AND s.period_id=a.period_id
      AND LOWER(TRIM(s.training_programme))=LOWER(TRIM(p.name)))) AS submitted
    FROM programmes p ORDER BY p.name COLLATE NOCASE`).bind(periodId,periodId).all()
  return c.json({ programmes: (rows.results || []).map((p: any) => ({ ...p, pending: Math.max(0, p.assigned-p.submitted) })) })
})

api.post('/programmes', async (c) => {
  const b = await c.req.json<{name?:string; description?:string}>()
  const name = b.name?.trim()
  if (!name) return c.json({error:'Programme name is required.'},400)
  const result = await c.env.DB.prepare('INSERT OR IGNORE INTO programmes (name,description) VALUES (?,?)').bind(name,b.description || null).run()
  if (!result.meta.changes) return c.json({error:'Programme already exists.'},409)
  return c.json({ok:true,id:result.meta.last_row_id},201)
})

api.patch('/programmes/:id', async (c) => {
  const id=Number(c.req.param('id'))
  const body=await c.req.json<{name?:string}>().catch(()=>({name:''}))
  const name=body.name?.trim()
  if (!name) return c.json({error:'Enter a programme name.'},400)
  const existing=await c.env.DB.prepare('SELECT id FROM programmes WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>?').bind(name,id).first()
  if (existing) return c.json({error:'Another programme already uses this name.'},409)
  const original=await c.env.DB.prepare('SELECT name FROM programmes WHERE id=?').bind(id).first<{name:string}>()
  if(!original)return c.json({error:'Programme not found.'},404)
  const result=await c.env.DB.prepare('UPDATE programmes SET name=? WHERE id=?').bind(name,id).run()
  // Keep previously matched reports linked after correcting a programme title.
  const updated=await c.env.DB.prepare('UPDATE submissions SET training_programme=? WHERE LOWER(TRIM(training_programme))=LOWER(TRIM(?))').bind(name,original.name).run()
  await log(c.env.DB,'programme.renamed',`Programme #${id}: "${original.name}" → "${name}"; updated ${updated.meta.changes||0} report labels`,'admin')
  return c.json({ok:true,updated_submissions:updated.meta.changes||0})
})

api.post('/programme-assignments/import', async (c) => {
  const periodId=Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const period=await c.env.DB.prepare('SELECT id FROM periods WHERE id=?').bind(periodId).first()
  if (!period) return c.json({error:'Select a valid reporting period.'},400)
  const ctype=c.req.header('content-type')||''
  let headers:string[]=[],rows:string[][]=[]
  try {
    if (ctype.includes('spreadsheetml')||ctype.includes('octet-stream')) {
      ;({headers,rows}=parseXlsx(new Uint8Array(await c.req.arrayBuffer())))
    } else { ;({headers,rows}=parseDelimited(await c.req.text())) }
  } catch { return c.json({error:'Unable to read the CSV/XLSX file.'},400) }
  if (rows.length>2000) return c.json({error:'Maximum 2,000 rows per import.'},400)
  const normal=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'')
  const cols=headers.map(normal)
  const col=(...names:string[])=>cols.findIndex(x=>names.includes(x))
  const progCol=col('trainingprogramme','programme','programname','programmename','trainingprogram')
  const emailCol=col('email','emailaddress','staffemail','staffemailaddress')
  const nameCol=col('staffname','fullname','name','staffmember')
  if (progCol<0||(emailCol<0&&nameCol<0)) return c.json({error:'File must contain Training Programme and Staff Email or Staff Name columns.'},400)
  const staffRows=await c.env.DB.prepare('SELECT id,email,full_name FROM staff').all<{id:number;email:string;full_name:string}>()
  const staff=staffRows.results||[]
  const normName=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase()
  let added=0,duplicates=0
  const errors:{row:number;reason:string}[]=[]
  const known=new Map<string,number>()
  const programmes=await c.env.DB.prepare('SELECT id,name FROM programmes').all<{id:number;name:string}>()
  for (const p of programmes.results||[]) known.set(normName(p.name),p.id)
  for (let i=0;i<rows.length;i++) {
    const r=rows[i],programme=(r[progCol]||'').trim(),email=emailCol>=0?(r[emailCol]||'').trim().toLowerCase():'',name=nameCol>=0?(r[nameCol]||'').trim():''
    if (!programme||(!email&&!name)){errors.push({row:i+2,reason:'Missing programme or staff identity'});continue}
    let matches=email?staff.filter(s=>s.email.trim().toLowerCase()===email):[]
    if (!matches.length&&name) matches=staff.filter(s=>normName(s.full_name)===normName(name))
    if (matches.length!==1){errors.push({row:i+2,reason:matches.length?'Ambiguous staff name':'Staff not found on roster'});continue}
    let programmeId=known.get(normName(programme))
    if (!programmeId) {
      const ins=await c.env.DB.prepare('INSERT OR IGNORE INTO programmes (name) VALUES (?)').bind(programme).run()
      if (ins.meta.changes) programmeId=Number(ins.meta.last_row_id)
      else {
        const found=await c.env.DB.prepare('SELECT id FROM programmes WHERE LOWER(TRIM(name))=LOWER(TRIM(?))').bind(programme).first<{id:number}>()
        programmeId=found?.id
      }
      if (!programmeId){errors.push({row:i+2,reason:'Could not create programme'});continue}
      known.set(normName(programme),programmeId)
    }
    const ins=await c.env.DB.prepare('INSERT OR IGNORE INTO programme_assignments (programme_id,staff_id,period_id) VALUES (?,?,?)').bind(programmeId,matches[0].id,periodId).run()
    if(ins.meta.changes)added++;else duplicates++
  }
  await log(c.env.DB,'programme.assignments.import',`Imported ${added} assignments for period #${periodId}`,'admin')
  return c.json({ok:true,total:rows.length,added,duplicates,errors})
})

api.get('/programme-assignments', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const rows = await c.env.DB.prepare(`SELECT a.id,a.programme_id,a.staff_id,a.period_id,
    p.name AS training_programme,st.full_name,st.email,st.team,
    (SELECT MIN(s.submitted_at) FROM submissions s WHERE s.staff_id=a.staff_id AND s.period_id=a.period_id
     AND LOWER(TRIM(s.training_programme))=LOWER(TRIM(p.name))) AS submitted_at
    FROM programme_assignments a JOIN programmes p ON p.id=a.programme_id
    JOIN staff st ON st.id=a.staff_id WHERE a.period_id=?
    ORDER BY p.name COLLATE NOCASE,st.full_name COLLATE NOCASE`).bind(periodId).all()
  return c.json({assignments:rows.results || []})
})

api.post('/programme-assignments', async (c) => {
  const b = await c.req.json<{programme_id?:number;staff_ids?:number[];period_id?:number}>()
  const periodId = b.period_id || (await defaultPeriod(c.env.DB))?.id
  if (!periodId || !b.programme_id || !Array.isArray(b.staff_ids) || !b.staff_ids.length)
    return c.json({error:'Select a programme, reporting period and staff members.'},400)
  const programme = await c.env.DB.prepare('SELECT id FROM programmes WHERE id=?').bind(b.programme_id).first()
  const period = await c.env.DB.prepare('SELECT id FROM periods WHERE id=?').bind(periodId).first()
  if (!programme || !period) return c.json({error:'Unknown programme or reporting period.'},404)
  let added=0
  for (const id of [...new Set(b.staff_ids.map(Number).filter(Number.isInteger))]) {
    const staff = await c.env.DB.prepare('SELECT id FROM staff WHERE id=?').bind(id).first()
    if (!staff) continue
    const res=await c.env.DB.prepare('INSERT OR IGNORE INTO programme_assignments (programme_id,staff_id,period_id) VALUES (?,?,?)')
      .bind(b.programme_id,id,periodId).run()
    added += res.meta.changes || 0
  }
  return c.json({ok:true,added})
})

api.delete('/programme-assignments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM programme_assignments WHERE id=?').bind(Number(c.req.param('id'))).run()
  return c.json({ok:true})
})

/* Per-staff outstanding reports across all assigned programmes in one period.
   Read-only; distinct programme assignments prevent duplicate rows inflating totals. */
api.get('/outstanding-programme-reports', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  if (!Number.isSafeInteger(periodId) || periodId <= 0) return c.json({error:'Select a valid reporting period.'},400)
  const period = await c.env.DB.prepare('SELECT id,name FROM periods WHERE id=?').bind(periodId).first()
  if (!period) return c.json({error:'Reporting period not found.'},404)
  const result = await c.env.DB.prepare(`SELECT st.id AS staff_id,st.full_name,st.email,st.team,
    p.id AS programme_id,p.name AS training_programme,
    CASE WHEN EXISTS (
      SELECT 1 FROM submissions s WHERE s.staff_id=a.staff_id AND s.period_id=a.period_id
      AND LOWER(TRIM(s.training_programme))=LOWER(TRIM(p.name))
    ) THEN 1 ELSE 0 END AS has_submitted
    FROM (SELECT DISTINCT staff_id,programme_id,period_id FROM programme_assignments WHERE period_id=?) a
    JOIN staff st ON st.id=a.staff_id JOIN programmes p ON p.id=a.programme_id
    ORDER BY st.full_name COLLATE NOCASE,p.name COLLATE NOCASE`).bind(periodId).all<{
      staff_id:number;full_name:string;email:string;team:string|null;
      programme_id:number;training_programme:string;has_submitted:number
    }>()
  const byStaff = new Map<number,{
    staff_id:number;full_name:string;email:string;team:string|null;
    assigned:number;submitted:number;pending:number;
    outstanding_programmes:{programme_id:number;training_programme:string}[]
  }>()
  for (const r of result.results || []) {
    let item = byStaff.get(r.staff_id)
    if (!item) {
      item = {staff_id:r.staff_id,full_name:r.full_name,email:r.email,team:r.team,
        assigned:0,submitted:0,pending:0,outstanding_programmes:[]}
      byStaff.set(r.staff_id,item)
    }
    item.assigned++
    if (r.has_submitted) item.submitted++
    else {
      item.pending++
      item.outstanding_programmes.push({programme_id:r.programme_id,training_programme:r.training_programme})
    }
  }
  const staff = [...byStaff.values()]
  return c.json({read_only:true,period,summary:{
    staff_assigned:staff.length,
    staff_with_outstanding:staff.filter(s=>s.pending>0).length,
    assigned_reports:staff.reduce((n,s)=>n+s.assigned,0),
    submitted_reports:staff.reduce((n,s)=>n+s.submitted,0),
    outstanding_reports:staff.reduce((n,s)=>n+s.pending,0)
  },staff})
})

api.get('/programme-progress', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const programmeId = Number(c.req.query('programme_id')) || 0
  if (!programmeId) return c.json({error:'Select a programme.'},400)
  const rows=await c.env.DB.prepare(`SELECT a.id,st.id AS staff_id,st.full_name,st.email,st.team,
    (SELECT MIN(s.submitted_at) FROM submissions s WHERE s.staff_id=a.staff_id AND s.period_id=a.period_id
      AND LOWER(TRIM(s.training_programme))=LOWER(TRIM(p.name))) AS submitted_at
    FROM programme_assignments a JOIN staff st ON st.id=a.staff_id
    JOIN programmes p ON p.id=a.programme_id
    WHERE a.period_id=? AND a.programme_id=? ORDER BY st.full_name COLLATE NOCASE`).bind(periodId,programmeId).all()
  const records=rows.results || []
  const submitted=records.filter((r:any)=>r.submitted_at).length
  return c.json({rows:records,assigned:records.length,submitted,pending:records.length-submitted})
})

api.get('/unassigned-submissions', async (c) => {
  const periodId = Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  const rows = await c.env.DB.prepare(`SELECT s.id, st.full_name, st.email, s.training_programme, s.submitted_at, s.source
    FROM submissions s JOIN staff st ON st.id=s.staff_id WHERE s.period_id=?
    AND NOT EXISTS (SELECT 1 FROM programme_assignments a JOIN programmes p ON p.id=a.programme_id
      WHERE a.period_id=s.period_id AND a.staff_id=s.staff_id
      AND LOWER(TRIM(p.name))=LOWER(TRIM(s.training_programme)))
    ORDER BY s.submitted_at DESC`).bind(periodId).all()
  return c.json({submissions:rows.results||[]})
})

/* HCOT planning module: intentionally isolated from production programme assignments.
   Publishing/synchronization is deferred until identity and authorization review. */
api.get('/hcot/plans', async c => {
  const plans=await c.env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM hcot_participants hp WHERE hp.plan_id=p.id) AS participant_count
    FROM hcot_training_plans p ORDER BY p.id DESC`).all()
  return c.json({plans:plans.results||[]})
})
api.post('/hcot/plans', async c => {
  const body=await c.req.json<{title?:string;start_date?:string;end_date?:string;location?:string;provider?:string;notes?:string}>().catch(()=>({}))
  const title=body.title?.trim()
  if(!title||title.length>250)return c.json({error:'Enter a training title (up to 250 characters).'},400)
  const result=await c.env.DB.prepare(`INSERT INTO hcot_training_plans
    (title,start_date,end_date,location,provider,notes) VALUES (?,?,?,?,?,?)`)
    .bind(title,body.start_date||null,body.end_date||null,body.location?.trim()||null,body.provider?.trim()||null,body.notes?.trim()||null).run()
  const actor = await verifyAccessJwt(c.req.raw, c.env)
  await log(c.env.DB,'hcot.plan.created',`Training plan #${result.meta.last_row_id}`,actor?.email || 'unknown')
  return c.json({ok:true,id:result.meta.last_row_id},201)
})
api.patch('/hcot/plans/:id', async c => {
  const id=Number(c.req.param('id'))
  const b=await c.req.json<{title?:string;start_date?:string;end_date?:string;location?:string;provider?:string;notes?:string}>().catch(()=>({}))
  if(!b.title?.trim())return c.json({error:'Training title is required.'},400)
  const result=await c.env.DB.prepare(`UPDATE hcot_training_plans SET title=?,start_date=?,end_date=?,location=?,provider=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'`)
    .bind(b.title.trim(),b.start_date||null,b.end_date||null,b.location||null,b.provider||null,b.notes||null,id).run()
  if(!result.meta.changes)return c.json({error:'Draft plan not found.'},404)
  const actor = await verifyAccessJwt(c.req.raw, c.env)
  await log(c.env.DB,'hcot.plan.updated',`Training plan #${id}`,actor!.email)
  return c.json({ok:true})
})
api.get('/hcot/plans/:id/participants', async c => {
  const rows=await c.env.DB.prepare(`SELECT st.id,st.full_name,st.email,st.team FROM hcot_participants hp JOIN staff st ON st.id=hp.staff_id WHERE hp.plan_id=? ORDER BY st.full_name COLLATE NOCASE`).bind(Number(c.req.param('id'))).all()
  return c.json({staff:rows.results||[]})
})
api.post('/hcot/plans/:id/participants', async c => {
  const id=Number(c.req.param('id'))
  const plan=await c.env.DB.prepare("SELECT id FROM hcot_training_plans WHERE id=? AND status='draft'").bind(id).first()
  if(!plan)return c.json({error:'Draft plan not found.'},404)
  const b=await c.req.json<{staff_ids?:number[]}>().catch(()=>({}))
  if(!Array.isArray(b.staff_ids)||b.staff_ids.length>500)return c.json({error:'Provide up to 500 staff IDs.'},400)
  if(b.staff_ids.some(value=>typeof value!=='number'||!Number.isSafeInteger(value)||value<=0))
    return c.json({error:'Every staff ID must be a positive integer from the Staff Roster.'},400)
  const ids=b.staff_ids
  if(new Set(ids).size!==ids.length)return c.json({error:'Duplicate staff IDs are not permitted.'},400)
  // Validate the complete batch before writing: never silently ignore unknown or inactive staff.
  for(const staffId of ids){
    const staff=await c.env.DB.prepare('SELECT id,active FROM staff WHERE id=?').bind(staffId).first<{id:number;active:number}>()
    if(!staff)return c.json({error:`Staff ID ${staffId} does not exist in the Staff Roster.`},400)
    if(Number(staff.active)!==1)return c.json({error:`Staff ID ${staffId} is inactive and cannot receive new assignments.`},400)
    const existing=await c.env.DB.prepare('SELECT 1 AS found FROM hcot_participants WHERE plan_id=? AND staff_id=?').bind(id,staffId).first()
    if(existing)return c.json({error:`Staff ID ${staffId} is already assigned to this plan.`},409)
  }
  let added=0
  for(const staffId of ids){
    const r=await c.env.DB.prepare('INSERT OR IGNORE INTO hcot_participants (plan_id,staff_id) SELECT ?,id FROM staff WHERE id=? AND active=1').bind(id,staffId).run()
    added+=r.meta.changes||0
  }
  return c.json({ok:true,added})
})

/* HCOT catalogue and planning records. No private HCOT archive data is seeded. */
api.get('/hcot/competencies', async c => {
  const rows=await c.env.DB.prepare('SELECT * FROM hcot_competencies ORDER BY name COLLATE NOCASE').all()
  return c.json({competencies:rows.results||[]})
})
api.post('/hcot/competencies', async c => {
  const b=await c.req.json<{name?:string;category?:string;division?:string;unit?:string;description?:string}>().catch(()=>({}))
  if(!b.name?.trim()||b.name.length>200)return c.json({error:'Enter a competency name (up to 200 characters).'},400)
  if(!['core','functional'].includes(b.category||'core'))return c.json({error:'Invalid competency category.'},400)
  const result=await c.env.DB.prepare('INSERT INTO hcot_competencies (name,category,division,unit,description) VALUES (?,?,?,?,?)')
    .bind(b.name.trim(),b.category||'core',b.division?.trim()||null,b.unit?.trim()||null,b.description?.trim()||null).run()
  return c.json({ok:true,id:result.meta.last_row_id},201)
})
api.get('/hcot/goals', async c => {
  const rows=await c.env.DB.prepare('SELECT * FROM hcot_goals ORDER BY id DESC').all()
  return c.json({goals:rows.results||[]})
})
api.post('/hcot/goals', async c => {
  const b=await c.req.json<{title?:string;scope?:string;owner_label?:string;target_date?:string;measure?:string;target_value?:string}>().catch(()=>({}))
  if(!b.title?.trim()||b.title.length>250)return c.json({error:'Enter a goal title (up to 250 characters).'},400)
  if(!['unit','individual'].includes(b.scope||'unit'))return c.json({error:'Invalid goal scope.'},400)
  const result=await c.env.DB.prepare('INSERT INTO hcot_goals (title,scope,owner_label,target_date,measure,target_value) VALUES (?,?,?,?,?,?)')
    .bind(b.title.trim(),b.scope||'unit',b.owner_label?.trim()||null,b.target_date||null,b.measure?.trim()||null,b.target_value?.trim()||null).run()
  return c.json({ok:true,id:result.meta.last_row_id},201)
})
api.get('/hcot/calendar', async c => {
  const year=(c.req.query('year')||String(new Date().getUTCFullYear())).trim()
  if(!/^\d{4}$/.test(year))return c.json({error:'Invalid year.'},400)
  const rows=await c.env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM hcot_participants h WHERE h.plan_id=p.id) AS participants
    FROM hcot_training_plans p WHERE substr(p.start_date,1,4)=? ORDER BY p.start_date,p.title`).bind(year).all()
  return c.json({plans:rows.results||[],year})
})
api.get('/hcot/reviews', async c => {
  const planId=Number(c.req.query('plan_id'))
  if(!Number.isInteger(planId)||planId<=0)return c.json({error:'Select a training plan.'},400)
  const rows=await c.env.DB.prepare(`SELECT hp.plan_id,hp.staff_id,st.full_name,st.email,
    hr.status,hr.rating,hr.notes,hr.reviewed_at
    FROM hcot_participants hp JOIN staff st ON st.id=hp.staff_id
    LEFT JOIN hcot_reviews hr ON hr.plan_id=hp.plan_id AND hr.staff_id=hp.staff_id
    WHERE hp.plan_id=? ORDER BY st.full_name COLLATE NOCASE`).bind(planId).all()
  return c.json({reviews:rows.results||[]})
})
/* Reviews remain read-only until verified supervisor identity and permissions are implemented. */

/* Read-only handshake: compare HCOT draft plans with tracker programmes and
   participant assignments. No records are modified by this endpoint. */
api.get('/hcot/identity-audit', async c => {
  const linked = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_staff_links').first<{n:number}>()
  const participants = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_participants').first<{n:number}>()
  const inactive = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_participants p JOIN staff s ON s.id=p.staff_id WHERE s.active=0').first<{n:number}>()
  const missing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_participants p LEFT JOIN staff s ON s.id=p.staff_id WHERE s.id IS NULL').first<{n:number}>()
  return c.json({verified_links:linked?.n||0,participant_records:participants?.n||0,inactive_participants:inactive?.n||0,missing_staff:missing?.n||0,read_only:true})
})

/* Staff mapping readiness is diagnostic only; no staff IDs or PII leave this endpoint. */
api.get('/hcot/mapping-readiness', async c => {
  const rows = await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM staff WHERE active=1) AS active_staff,
    (SELECT COUNT(*) FROM hcot_staff_links l JOIN staff s ON s.id=l.tracker_staff_id WHERE s.active=1) AS active_verified_links,
    (SELECT COUNT(*) FROM hcot_staff_links l LEFT JOIN staff s ON s.id=l.tracker_staff_id WHERE s.id IS NULL) AS orphan_links,
    (SELECT COUNT(*) FROM hcot_staff_links l JOIN staff s ON s.id=l.tracker_staff_id WHERE s.active=0) AS inactive_links,
    (SELECT COUNT(DISTINCT p.staff_id) FROM hcot_participants p LEFT JOIN hcot_staff_links l ON l.tracker_staff_id=p.staff_id WHERE l.tracker_staff_id IS NULL) AS unlinked_participants,
    (SELECT COUNT(*) FROM hcot_participants p JOIN staff s ON s.id=p.staff_id WHERE s.active=0) AS inactive_participant_assignments`).first<{active_staff:number;active_verified_links:number;orphan_links:number;inactive_links:number;unlinked_participants:number;inactive_participant_assignments:number}>()
  const summary=rows||{active_staff:0,active_verified_links:0,orphan_links:0,inactive_links:0,unlinked_participants:0,inactive_participant_assignments:0}
  return c.json({read_only:true,summary,ready_for_automatic_sync:false,
    reasons:['Staff identity links require independent verification','Role-based authorization and approval controls are not implemented']})
})

/* Plan-level identity exceptions; read-only, no employee names or emails. */
api.get('/hcot/mapping-exceptions', async c => {
  const rows=await c.env.DB.prepare(`SELECT p.id AS plan_id,p.title AS training_title,
    COUNT(hp.staff_id) AS participants,
    SUM(CASE WHEN hp.staff_id IS NOT NULL AND l.tracker_staff_id IS NULL THEN 1 ELSE 0 END) AS unverified,
    SUM(CASE WHEN hp.staff_id IS NOT NULL AND s.id IS NULL THEN 1 ELSE 0 END) AS missing,
    SUM(CASE WHEN hp.staff_id IS NOT NULL AND s.active=0 THEN 1 ELSE 0 END) AS inactive
    FROM hcot_training_plans p
    LEFT JOIN hcot_participants hp ON hp.plan_id=p.id
    LEFT JOIN staff s ON s.id=hp.staff_id
    LEFT JOIN hcot_staff_links l ON l.tracker_staff_id=hp.staff_id
    GROUP BY p.id,p.title ORDER BY p.id DESC`).all()
  return c.json({read_only:true,plans:(rows.results||[]).map(r=>({
    plan_id:r.plan_id,training_title:r.training_title,participants:Number(r.participants)||0,
    unverified:Number(r.unverified)||0,missing:Number(r.missing)||0,inactive:Number(r.inactive)||0
  }))})
})

/* Validate a proposed identity link without creating or changing records.
   Fail closed when the shared access gate is not configured. */
api.post('/hcot/mapping-validate', async c => {
  if (!(await getSetting(c.env.DB,'access_code'))) return c.json({error:'Access control must be configured before mapping review.'},403)
  const body=await c.req.json<{hcot_staff_number?:string;tracker_staff_id?:number}>().catch(()=>({}))
  const number=typeof body.hcot_staff_number==='string'?body.hcot_staff_number.trim():''
  const staffId=Number(body.tracker_staff_id)
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(number)||!Number.isSafeInteger(staffId)||staffId<=0)
    return c.json({error:'Provide a valid HCOT staff number and positive tracker staff ID.'},400)
  const staff=await c.env.DB.prepare('SELECT id,active FROM staff WHERE id=?').bind(staffId).first<{id:number;active:number}>()
  const byNumber=await c.env.DB.prepare('SELECT tracker_staff_id FROM hcot_staff_links WHERE hcot_staff_number=?').bind(number).first<{tracker_staff_id:number}>()
  const byStaff=await c.env.DB.prepare('SELECT hcot_staff_number FROM hcot_staff_links WHERE tracker_staff_id=?').bind(staffId).first<{hcot_staff_number:string}>()
  const issues:string[]=[]
  if(!staff)issues.push('staff_not_found')
  else if(Number(staff.active)!==1)issues.push('staff_inactive')
  if(byNumber&&byNumber.tracker_staff_id!==staffId)issues.push('staff_number_already_linked')
  if(byStaff&&byStaff.hcot_staff_number!==number)issues.push('tracker_staff_already_linked')
  return c.json({read_only:true,eligible_for_review:issues.length===0,already_linked:byNumber?.tracker_staff_id===staffId,
    issues,approval_required:true,link_created:false})
})

/* Explicitly approved identity links require a separate server-side administrator token.
   Never use the general tracker access code for this privileged operation. */
/* Security policy preview: no user-supplied identity can authorize a review.
   The actual write endpoints stay disabled until a trusted identity provider is integrated. */
/* Preview maker/checker eligibility without trusting a browser-provided role.
   This endpoint never authorizes or performs a mapping write. */
api.get('/hcot/mapping-requests', async c => {
  const rows=await c.env.DB.prepare(
    "SELECT id,status,created_at,reviewed_at FROM hcot_mapping_requests ORDER BY id DESC LIMIT 100"
  ).all()
  return c.json({read_only:true,requests:rows.results||[],approvals_enabled:false})
})

api.get('/hcot/access-session', async c => {
  const identity = await verifyAccessJwt(c.req.raw, c.env)
  if (!identity) return c.json({ error: 'Cloudflare Access authentication required.' }, 401)
  return c.json({
    authenticated: true,
    email: identity.email,
    role: (c.env.HCOT_SETTINGS_ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).includes(identity.email.trim().toLowerCase()) ? 'admin' : 'viewer',
    role_source: 'verified_access_identity_and_admin_allowlist',
    maker_enabled: false,
    checker_enabled: false,
    mapping_approval_enabled: false,
    automatic_sync_enabled: false
  })
})

api.get('/hcot/mapping-security', async c => {
  return c.json({
    approval_enabled:false,
    request_submission_enabled:false,
    identity_provider_configured:false,
    independent_checker_required:true,
    automatic_sync_enabled:false,
    reason:'Named identity and reviewer role must be verified server-side before approval writes.'
  })
})

api.get('/hcot/mapping-approval-status', async c => {
  const rows=await c.env.DB.prepare("SELECT status,COUNT(*) AS total FROM hcot_mapping_requests GROUP BY status").all<{status:string;total:number}>()
  const counts={pending:0,approved:0,rejected:0}
  for(const r of rows.results||[])if(r.status in counts)counts[r.status as keyof typeof counts]=Number(r.total)||0
  return c.json({read_only:true,approval_enabled:false,named_authentication:false,maker_checker_enabled:false,counts})
})

api.post('/hcot/mapping-approve', async c => {
  return c.json({error:'Approval unavailable: named maker/checker authentication and independent review are required.'},403)
})

api.get('/hcot/handshake-preview', async c => {
  const periodId=Number(c.req.query('period')) || (await defaultPeriod(c.env.DB))?.id || 0
  if(!Number.isInteger(periodId)||periodId<=0)return c.json({error:'Select a valid reporting period.'},400)
  const period=await c.env.DB.prepare('SELECT id,name FROM periods WHERE id=?').bind(periodId).first()
  if(!period)return c.json({error:'Reporting period not found.'},404)
  const plans=await c.env.DB.prepare('SELECT id,title,status FROM hcot_training_plans ORDER BY id DESC').all<{id:number;title:string;status:string}>()
  const programmes=await c.env.DB.prepare('SELECT id,name FROM programmes').all<{id:number;name:string}>()
  const assignments=await c.env.DB.prepare('SELECT programme_id,staff_id FROM programme_assignments WHERE period_id=?').bind(periodId).all<{programme_id:number;staff_id:number}>()
  const participants=await c.env.DB.prepare('SELECT plan_id,staff_id FROM hcot_participants').all<{plan_id:number;staff_id:number}>()
  const preview=previewHandshake(plans.results||[],programmes.results||[],participants.results||[],assignments.results||[])
  return c.json({period_id:periodId,...preview})
})

api.get('/hcot/cost-estimates', async c => {
  const rows=await c.env.DB.prepare(`SELECT ce.id,ce.plan_id,ce.staff_id,ce.currency,
    ce.allowance_amount,ce.transport_amount,ce.accommodation_amount,
    ce.course_fee_amount,ce.total_amount,ce.rate_basis,ce.status,
    p.title AS training_title,st.full_name AS staff_name
    FROM hcot_cost_estimates ce
    JOIN hcot_training_plans p ON p.id=ce.plan_id
    JOIN staff st ON st.id=ce.staff_id ORDER BY ce.id DESC`).all()
  return c.json({estimates:rows.results||[]})
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
  const distinctProgrammes = new Set(records.map((r: any) => String(r.training_programme ?? '').trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)).size
  return c.json({
    records,
    staff: staff.results ?? [],
    years: (years.results ?? []).map((r) => r.year).filter(Boolean),
    summary: { submissions: records.length, staff: distinctStaff, programmes: distinctProgrammes },
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
  // Bound webhook payload bytes before D1 access or JSON parsing.
  const maxBytes = 256 * 1024
  const declaredLength = Number(c.req.header('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return c.json({ error: 'Webhook payload too large.', code: 'INGEST_PAYLOAD_LIMIT' }, 413)
  const rawBody = await c.req.raw.text()
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) return c.json({ error: 'Webhook payload too large.', code: 'INGEST_PAYLOAD_LIMIT' }, 413)
  const period = await periodByToken(c.env.DB, c.req.param('token'))
  if (!period) return c.json({ error: 'Unknown webhook token.' }, 404)

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Body must be JSON.' }, 400)
  }

  // Reject oversized batches before processing any records to avoid partial ingestion.
  const list = Array.isArray(body) ? body : [body]
  if (list.length > 100) return c.json({ error: 'Maximum 100 responses per webhook request.', code: 'INGEST_BATCH_LIMIT' }, 413)
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
    programme: override.programme ?? detected.programme,
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
  // Never disclose the actual shared tracker access code to browser clients.
  // The UI only needs to know whether a code has been configured.
  for (const r of rows.results ?? []) out[r.key] = r.key === 'access_code' ? (r.value ? 'configured' : '') : r.value
  return c.json({ settings: out })
})

api.post('/settings', async (c) => {
  // Fail closed for HCOT-enabled Preview, including first-time setup when
  // the tracker access code has not yet been initialized in D1.
  if (c.env.HCOT_ACCESS_TEAM_DOMAIN || c.env.HCOT_ACCESS_AUD) {
    if (!c.env.HCOT_ACCESS_TEAM_DOMAIN?.trim() || !c.env.HCOT_ACCESS_AUD?.trim()) {
      return c.json({ error: 'HCOT Access configuration incomplete.' }, 503)
    }
    const admins = (c.env.HCOT_SETTINGS_ADMIN_EMAILS || '').split(',')
      .map(email => email.trim().toLowerCase()).filter(Boolean)
    if (!admins.length) return c.json({ error: 'Preview settings administrators are not configured.' }, 503)
    const identity = await verifyAccessJwt(c.req.raw, c.env)
    if (!identity) return c.json({ error: 'Cloudflare Access authentication required.' }, 401)
    if (!admins.includes(identity.email.trim().toLowerCase())) return c.json({ error: 'Settings administrator permission required.' }, 403)
  }
  const body = await c.req.json<Record<string, string>>().catch(() => ({} as Record<string, string>))
  const allowed = ['org_name', 'access_code', 'deadline_reminder_days', 'form_owner_email']
  // Never permit an empty access code to silently unlock an initialized tracker.
  if (Object.prototype.hasOwnProperty.call(body, 'access_code') && !String(body.access_code ?? '').trim()) {
    return c.json({ error: 'Access code cannot be empty. Use a separately approved recovery process.', code: 'ACCESS_CODE_REQUIRED' }, 400)
  }
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue
    await setSetting(c.env.DB, k, String(v ?? ''))
  }
  await log(c.env.DB, 'settings.updated', Object.keys(body).join(', '), 'admin')
  return c.json({ ok: true })
})

/** Wipe the sample data so a real rollout starts clean. */
/* P0: destructive reset is disabled; use a separately approved maintenance process. */
api.post('/reset', async c => c.json({
  error: 'Workspace reset is disabled for security. Use a separately approved maintenance process.',
  code: 'WORKSPACE_RESET_DISABLED'
}, 403))

api.get('/demo-status', async (c) => {
  const demo = await getSetting(c.env.DB, 'demo', '')
  const staff = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  return c.json({ demo: demo === '1', staff: staff?.n ?? 0 })
})

export default api
