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
/* Preview-only roster reset preflight. Read-only: never deletes data. */
api.get('/hcot/preview-roster-reset/preflight', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const counts=await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM staff) AS staff,
    (SELECT COUNT(*) FROM submissions) AS submissions,
    (SELECT COUNT(*) FROM programme_assignments) AS programme_assignments,
    (SELECT COUNT(*) FROM hcot_staff_links) AS hcot_staff_links,
    (SELECT COUNT(*) FROM hcot_mapping_requests) AS hcot_mapping_requests,
    (SELECT COUNT(*) FROM hcot_participants) AS hcot_participants,
    (SELECT COUNT(*) FROM hcot_staff_competencies) AS hcot_staff_competencies,
    (SELECT COUNT(*) FROM hcot_competency_assessments) AS hcot_competency_assessments,
    (SELECT COUNT(*) FROM hcot_goals) AS hcot_goals,
    (SELECT COUNT(*) FROM hcot_reviews) AS hcot_reviews`).first()
  return c.json({ok:true,read_only:true,counts,required_before_reset:['Confirm exact Preview D1 database binding','Create and verify a restorable D1 backup','Export and retain existing Staff Roster','Review dependent-record counts and choose deletion scope','Obtain explicit confirmation before destructive operation'],message:'No data has been deleted. A roster reset is not enabled by this endpoint.'})
})
/* Destructive reset: disabled unless explicitly enabled in the isolated Preview environment.
   A bookmark is a recovery reference, not a verified export; operators must independently
   verify a restorable backup/export before enabling this route. */
api.post('/hcot/preview-roster-reset/execute', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const hostname=new URL(c.req.url).hostname
  if(!/^[a-f0-9]{8}\.training-report-submission-tracker\.pages\.dev$/.test(hostname))
    return c.json({error:'Reset restricted to an immutable Preview deployment hostname.'},403)
  const env=c.env as Env & {HCOT_PREVIEW_ROSTER_RESET_ENABLED?:string;HCOT_PREVIEW_D1_DATABASE_ID?:string}
  if(env.HCOT_PREVIEW_ROSTER_RESET_ENABLED!=='true'||env.HCOT_PREVIEW_D1_DATABASE_ID!=='26b2a079-accf-4d05-bf1c-c1e8ca523e1e')
    return c.json({error:'Preview reset disabled or Preview database identity not confirmed.'},403)
  const b=await c.req.json<{confirmation?:string;backup_verified?:boolean;export_verified?:boolean;expected_staff_count?:number;expected_submissions_count?:number}>().catch(()=>({}))
  if(b.confirmation!=='RESET 21 PREVIEW TEST STAFF' || b.backup_verified!==true || b.export_verified!==true || b.expected_staff_count!==21 || b.expected_submissions_count!==16)
    return c.json({error:'Explicit reset confirmation, independently verified backup/export and expected record counts required.'},400)
  const current=await c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM staff) AS staff,(SELECT COUNT(*) FROM submissions) AS submissions').first<{staff:number;submissions:number}>()
  if(current?.staff!==21||current?.submissions!==16)return c.json({error:'Roster or submission counts changed. Reset cancelled; repeat preflight.',current},409)
  // D1 batch is transactional. Delete dependent rows before their referenced staff.
  const tables=['hcot_cost_estimates','hcot_reviews','hcot_participants','hcot_competency_assessments','hcot_staff_competencies','hcot_staff_links','hcot_mapping_requests','programme_assignments','submissions']
  const statements=tables.map(table=>c.env.DB.prepare('DELETE FROM '+table+' WHERE '+((table==='hcot_staff_links'||table==='hcot_mapping_requests')?'tracker_staff_id':'staff_id')+' IN (SELECT id FROM staff)'))
  statements.push(c.env.DB.prepare('DELETE FROM staff WHERE id IN (SELECT id FROM staff)'))
  // The final insert belongs to the same transaction; a failed deletion rolls back all changes.
  statements.push(c.env.DB.prepare('INSERT INTO activity(event,detail,actor) VALUES(?,?,?)').bind('hcot.preview_roster_reset',JSON.stringify({staff:21,submissions:16,scope:'staff_and_linked_records',preserved:['hcot_cadres','hcot_competencies','hcot_competency_groups','programmes','hcot_goals','organisational_directory']}),session.email))
  await c.env.DB.batch(statements)
  return c.json({ok:true,staff_deleted:21,submissions_deleted:16,preserved:['cadres','competency_library','programmes','organisational_directory','hcot_goals']})
})
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
  const cCadre = find('cadre')
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
    const cadreName = cCadre >= 0 ? (r[cCadre] || '').trim() : ''
    let cadreId: number | null = null
    if (cadreName) {
      const cadre = await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND active=1').bind(cadreName).first<{id:number}>()
      if (!cadre) {
        problems.push(`Row ${i + 2}: cadre "${cadreName}" does not exist or is inactive`)
        skipped++
        continue
      }
      cadreId = cadre.id
    }
    const directoryError = await validateStaffDirectory(c.env.DB, division || null, department || null, unit || null)
    if (directoryError) {
      problems.push(`Row ${i + 2}: ${directoryError}`)
      skipped++
      continue
    }
    const res = await c.env.DB.prepare(
      `INSERT INTO staff (full_name, email, team, role, unit, cadre_id, active) VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name,
         team = CASE WHEN ? = 1 THEN excluded.team ELSE staff.team END,
         role = CASE WHEN ? = 1 THEN excluded.role ELSE staff.role END,
         unit = CASE WHEN ? = 1 THEN excluded.unit ELSE staff.unit END,
         cadre_id = CASE WHEN ? = 1 THEN excluded.cadre_id ELSE staff.cadre_id END`
    )
      .bind(name, email, division || null, department || null, unit || null, cadreId, cTeam >= 0 ? 1 : 0, cRole >= 0 ? 1 : 0, cUnit >= 0 ? 1 : 0, cadreName ? 1 : 0)
      .run()
    if (res.meta.changes) added++
  }
  await log(c.env.DB, 'staff.imported', `${added} rows from roster file; ${skipped} skipped`, 'admin')
  if (added === 0 && skipped > 0) return c.json({ ok: false, error: `No staff imported. ${skipped} row(s) were rejected.`, count: 0, skipped, problems: problems.slice(0, 25) }, 422)
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
api.get('/hcot/competency-groups', async c => {
  const [groups,links,cadreLinks]=await Promise.all([
    c.env.DB.prepare('SELECT * FROM hcot_competency_groups ORDER BY name COLLATE NOCASE').all(),
    c.env.DB.prepare('SELECT group_id,competency_id FROM hcot_group_competencies').all(),
    c.env.DB.prepare(`SELECT cadre_id,group_id,NULL AS division,NULL AS department,NULL AS unit FROM hcot_cadre_groups UNION ALL SELECT cadre_id,group_id,division,department,unit FROM hcot_cadre_group_scopes`).all()
  ])
  return c.json({groups:groups.results||[],competencies:links.results||[],cadres:cadreLinks.results||[]})
})
api.post('/hcot/competency-groups', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{name?:string;description?:string}>().catch(()=>({}))
  const name=String(b.name||'').trim(),description=String(b.description||'').trim()
  if(!name||name.length>150||description.length>1000)return c.json({error:'Enter a valid group name (up to 150 characters).'},400)
  const duplicate=await c.env.DB.prepare('SELECT id FROM hcot_competency_groups WHERE LOWER(TRIM(name))=LOWER(TRIM(?))').bind(name).first()
  if(duplicate)return c.json({error:'A competency group with this name already exists. Select the existing group instead.'},409)
  try {const x=await c.env.DB.prepare('INSERT INTO hcot_competency_groups(name,description) VALUES (?,?)').bind(name,description||null).run();return c.json({ok:true,id:x.meta.last_row_id},201)}
  catch{return c.json({error:'Competency group already exists or could not be saved.'},409)}
})
api.post('/hcot/competency-groups/import', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const csv=await c.req.text()
  if(csv.length>1000000)return c.json({error:'CSV exceeds 1 MB.'},413)
  const {headers,rows}=parseDelimited(csv)
  const keys=['competency_group','group_description','competency_name','competency_category','cadre','division','department','unit']
  const indices=keys.map(k=>headers.findIndex(h=>h.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/\s+/g,'_')===k))
  if([0,2,3,4,5,6,7].some(i=>indices[i]<0))return c.json({error:'Required columns: competency_group, competency_name, competency_category, cadre, division, department, unit.'},400)
  if(!rows.length||rows.length>1000)return c.json({error:'Include 1–1000 data rows.'},400)
  const errors:string[]=[],prepared:{group:string;description:string;competencyId:number;cadreId:number;division:string|null;department:string|null;unit:string|null}[]=[]
  const groupCache=new Map<string,string>(),competencyCache=new Map<string,{id:number;category:string}>(),cadreCache=new Map<string,number>()
  for(const [i,row] of rows.entries()){
    const [group,description,competencyName,rawCategory,cadreName,div,dept,unt]=indices.map(idx=>idx<0?'':String(row[idx]||'').trim())
    const category=rawCategory.toLowerCase()
    if(!['core','functional'].includes(category)){errors.push(`Row ${i+2}: competency category must be Core or Functional.`);continue}
    if(!group||group.length>150||description.length>1000||!competencyName||!cadreName){errors.push(`Row ${i+2}: group, competency and cadre are required; group name must be at most 150 characters.`);continue}
    const key=group.trim().toLowerCase(),old=groupCache.get(key)
    if(old!==undefined&&old!==description){errors.push(`Row ${i+2}: conflicting descriptions for group "${group}".`);continue}
    groupCache.set(key,description)
    const compKey=competencyName.toLowerCase(),cadreKey=cadreName.toLowerCase()
    if(!competencyCache.has(compKey)){
      const comp=await c.env.DB.prepare('SELECT id,category FROM hcot_competencies WHERE LOWER(TRIM(name))=LOWER(TRIM(?))').bind(competencyName).all<{id:number;category:string}>()
      if(comp.results.length!==1){errors.push(`Row ${i+2}: competency "${competencyName}" must match exactly one existing competency.`);continue}
      competencyCache.set(compKey,comp.results[0])
    }
    if(competencyCache.get(compKey)!.category.toLowerCase()!==category){errors.push(`Row ${i+2}: category for competency ${competencyName} must match its existing classification (${competencyCache.get(compKey)!.category}).`);continue}
    if(!cadreCache.has(cadreKey)){
      const cadre=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE active=1 AND LOWER(TRIM(name))=LOWER(TRIM(?))').bind(cadreName).first<{id:number}>()
      if(!cadre){errors.push(`Row ${i+2}: cadre "${cadreName}" does not exist or is inactive.`);continue}
      cadreCache.set(cadreKey,cadre.id)
    }
    if((dept&&!div)||(unt&&!dept)){errors.push(`Row ${i+2}: division is required for department, and department is required for unit.`);continue}
    const scopeError=await validateStaffDirectory(c.env.DB,div||null,dept||null,unt||null)
    if(scopeError){errors.push(`Row ${i+2}: ${scopeError}`);continue}
    prepared.push({group,description,competencyId:competencyCache.get(compKey)!.id,cadreId:cadreCache.get(cadreKey)!,division:div||null,department:dept||null,unit:unt||null})
  }
  if(errors.length)return c.json({error:'Import rejected; no rows applied.',errors:errors.slice(0,100),error_count:errors.length},400)
  // Never silently move a competency already belonging to another group.
  const ownership=new Map<number,string>()
  for(const p of prepared){const prev=ownership.get(p.competencyId);if(prev&&prev!==p.group.toLowerCase())errors.push(`Competency ID ${p.competencyId} appears in multiple groups.`);ownership.set(p.competencyId,p.group.toLowerCase())}
  for(const [compId,groupKey] of ownership){
    const old=await c.env.DB.prepare('SELECT g.name FROM hcot_group_competencies gc JOIN hcot_competency_groups g ON g.id=gc.group_id WHERE gc.competency_id=?').bind(compId).first<{name:string}>()
    if(old&&old.name.toLowerCase()!==groupKey)errors.push(`Competency ID ${compId} is already assigned to group "${old.name}".`)
  }
  if(errors.length)return c.json({error:'Conflicting group assignments; no rows applied.',errors},409)
  const statements=[]
  for(const [group,description] of groupCache){
    const original=prepared.find(p=>p.group.toLowerCase()===group)!.group
    statements.push(c.env.DB.prepare('INSERT INTO hcot_competency_groups(name,description) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM hcot_competency_groups WHERE LOWER(TRIM(name))=LOWER(TRIM(?)))').bind(original,description||null,original))
  }
  await c.env.DB.batch(statements)
  const ids=new Map<string,number>()
  for(const p of prepared){const key=p.group.toLowerCase();if(!ids.has(key)){const found=await c.env.DB.prepare('SELECT id FROM hcot_competency_groups WHERE LOWER(TRIM(name))=LOWER(TRIM(?))').bind(p.group).first<{id:number}>();if(!found)return c.json({error:'Unable to resolve imported group.'},500);ids.set(key,found.id)}}
  const writes=[]
  for(const p of prepared){const gid=ids.get(p.group.toLowerCase())!
    writes.push(c.env.DB.prepare('INSERT OR IGNORE INTO hcot_group_competencies(group_id,competency_id) VALUES (?,?)').bind(gid,p.competencyId))
    if(!p.division&&!p.department&&!p.unit)writes.push(c.env.DB.prepare('INSERT OR IGNORE INTO hcot_cadre_groups(cadre_id,group_id) VALUES (?,?)').bind(p.cadreId,gid))
    else writes.push(c.env.DB.prepare('INSERT OR IGNORE INTO hcot_cadre_group_scopes(cadre_id,group_id,division,department,unit) VALUES (?,?,?,?,?)').bind(p.cadreId,gid,p.division,p.department,p.unit))
  }
  await c.env.DB.batch(writes)
  // Record the responsible administrator and import summary in the existing activity ledger.
  await log(c.env.DB,'hcot_competency_groups_import',JSON.stringify({rows:prepared.length,groups:ids.size,competencies:ownership.size,scope_mappings:prepared.filter(p=>p.division||p.department||p.unit).length,global_mappings:prepared.filter(p=>!p.division&&!p.department&&!p.unit).length}),session.email)
  return c.json({ok:true,rows:prepared.length,groups:ids.size,competencies:ownership.size})
})
api.post('/hcot/competency-groups/assign-competency', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{group_id?:number;competency_id?:number}>().catch(()=>({}))
  const gid=Number(b.group_id),cid=Number(b.competency_id)
  if(!Number.isSafeInteger(gid)||gid<=0||!Number.isSafeInteger(cid)||cid<=0)return c.json({error:'Select a group and competency.'},400)
  const group=await c.env.DB.prepare('SELECT id FROM hcot_competency_groups WHERE id=?').bind(gid).first()
  const comp=await c.env.DB.prepare('SELECT id FROM hcot_competencies WHERE id=?').bind(cid).first()
  if(!group||!comp)return c.json({error:'Group or competency not found.'},404)
  await c.env.DB.prepare('INSERT INTO hcot_group_competencies(group_id,competency_id) VALUES (?,?) ON CONFLICT(competency_id) DO UPDATE SET group_id=excluded.group_id').bind(gid,cid).run()
  return c.json({ok:true})
})
api.post('/hcot/competency-groups/assign-cadre', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{group_id?:number;cadre_id?:number;division?:string;department?:string;unit?:string}>().catch(()=>({}))
  const gid=Number(b.group_id),cid=Number(b.cadre_id)
  if(!Number.isSafeInteger(gid)||gid<=0||!Number.isSafeInteger(cid)||cid<=0)return c.json({error:'Select a group and cadre.'},400)
  const group=await c.env.DB.prepare('SELECT id FROM hcot_competency_groups WHERE id=?').bind(gid).first()
  const cadre=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE id=? AND active=1').bind(cid).first()
  if(!group||!cadre)return c.json({error:'Group or active cadre not found.'},404)
  const division=String(b.division||'').trim()||null,department=String(b.department||'').trim()||null,unit=String(b.unit||'').trim()||null
  const err=await validateStaffDirectory(c.env.DB,division,department,unit)
  if(err)return c.json({error:err},400)
  if(!division&&!department&&!unit){
    await c.env.DB.prepare('INSERT OR IGNORE INTO hcot_cadre_groups(cadre_id,group_id) VALUES (?,?)').bind(cid,gid).run()
  }else{
    await c.env.DB.prepare('INSERT OR IGNORE INTO hcot_cadre_group_scopes(cadre_id,group_id,division,department,unit) VALUES (?,?,?,?,?)').bind(cid,gid,division,department,unit).run()
  }
  return c.json({ok:true})
})
api.get('/hcot/competencies', async c => {
  const rows=await c.env.DB.prepare('SELECT * FROM hcot_competencies ORDER BY name COLLATE NOCASE').all()
  return c.json({competencies:rows.results||[]})
})
api.post('/hcot/competencies', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session || !(await isHcotCompetencyAdmin(c,session.email))) return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{name?:string;category?:string;division?:string;department?:string;unit?:string;description?:string}>().catch(()=>({}))
  const name=String(b.name??'').trim(),division=String(b.division??'').trim(),department=String(b.department??'').trim(),unit=String(b.unit??'').trim()
  if(!name||name.length>200)return c.json({error:'Enter a competency name (up to 200 characters).'},400)
  if(!['core','functional'].includes(b.category||'core'))return c.json({error:'Invalid competency category.'},400)
  const err=await validateStaffDirectory(c.env.DB,division||null,department||null,unit||null)
  if(err)return c.json({error:err},400)
  const result=await c.env.DB.prepare('INSERT INTO hcot_competencies (name,category,division,department,unit,description) VALUES (?,?,?,?,?,?)')
    .bind(name,b.category||'core',division||null,department||null,unit||null,b.description?.trim()||null).run()
  return c.json({ok:true,id:result.meta.last_row_id},201)
})

async function isHcotCompetencyAdmin(c:any,email:string):Promise<boolean>{
  const admins=(c.env.HCOT_SETTINGS_ADMIN_EMAILS||'').split(',').map((s:string)=>s.trim().toLowerCase()).filter(Boolean)
  return admins.includes(email.trim().toLowerCase())
}

/* Competency edits preserve IDs and existing staff assignments. */
api.patch('/hcot/competencies/:id', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session || !(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Invalid competency ID.'},400)
  const b=await c.req.json<{name?:string;category?:string;division?:string;department?:string;unit?:string;description?:string}>().catch(()=>({}))
  const name=String(b.name??'').trim(),division=String(b.division??'').trim(),department=String(b.department??'').trim(),unit=String(b.unit??'').trim()
  if(!name||name.length>200)return c.json({error:'Enter a competency name (up to 200 characters).'},400)
  if(!['core','functional'].includes(b.category||''))return c.json({error:'Invalid competency category.'},400)
  const err=await validateStaffDirectory(c.env.DB,division||null,department||null,unit||null)
  if(err)return c.json({error:err},400)
  const existing=await c.env.DB.prepare('SELECT id FROM hcot_competencies WHERE id=?').bind(id).first()
  if(!existing)return c.json({error:'Competency not found.'},404)
  const incompatible=await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM hcot_staff_competencies m JOIN staff s ON s.id=m.staff_id WHERE m.competency_id=? AND
    ((? IS NOT NULL AND LOWER(TRIM(COALESCE(s.team,'')))<>LOWER(?)) OR
     (? IS NOT NULL AND LOWER(TRIM(COALESCE(s.role,'')))<>LOWER(?)) OR
     (? IS NOT NULL AND LOWER(TRIM(COALESCE(s.unit,'')))<>LOWER(?)))`)
    .bind(id,division||null,division||null,department||null,department||null,unit||null,unit||null).first<{total:number}>()
  if(Number(incompatible?.total||0)>0)return c.json({error:'This change would conflict with existing staff assignments. Remove incompatible assignments before changing the organisational scope.'},409)
  await c.env.DB.prepare('UPDATE hcot_competencies SET name=?,category=?,division=?,department=?,unit=?,description=? WHERE id=?')
    .bind(name,b.category,division||null,department||null,unit||null,String(b.description??'').trim()||null,id).run()
  return c.json({ok:true,id})
})
api.delete('/hcot/competencies/:id', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session || !(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Invalid competency ID.'},400)
  const existing=await c.env.DB.prepare('SELECT id FROM hcot_competencies WHERE id=?').bind(id).first()
  if(!existing)return c.json({error:'Competency not found.'},404)
  const mapped=await c.env.DB.prepare('SELECT COUNT(*) AS total FROM hcot_staff_competencies WHERE competency_id=?').bind(id).first<{total:number}>()
  if(Number(mapped?.total||0)>0)return c.json({error:'This competency is assigned to staff. Remove its staff assignments before deleting it.'},409)
  await c.env.DB.prepare('DELETE FROM hcot_competencies WHERE id=? AND NOT EXISTS (SELECT 1 FROM hcot_staff_competencies WHERE competency_id=?)').bind(id,id).run()
  return c.json({ok:true})
})

/* Staff identities come exclusively from the central Staff Roster. */
// Cadre rules are evaluated dynamically; direct staff mappings remain separate.
api.get('/hcot/cadres', async c => {
  const rows=await c.env.DB.prepare('SELECT id,name,active FROM hcot_cadres ORDER BY name COLLATE NOCASE').all()
  return c.json({cadres:rows.results||[]})
})
api.post('/hcot/cadres', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{name?:string}>().catch(()=>({}))
  const name=String(b.name||'').trim()
  if(!name||name.length>120)return c.json({error:'Enter a valid cadre name.'},400)
  const exists=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE name=? COLLATE NOCASE').bind(name).first()
  if(exists)return c.json({error:'Cadre already exists.'},409)
  const result=await c.env.DB.prepare('INSERT INTO hcot_cadres(name) VALUES(?)').bind(name).run()
  return c.json({ok:true,id:result.meta.last_row_id},201)
})
api.patch('/hcot/cadres/:id', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  const body=await c.req.json<{name?:string}>().catch(()=>({}))
  const name=String(body.name||'').trim()
  if(!Number.isSafeInteger(id)||id<=0||!name||name.length>120)return c.json({error:'Valid cadre ID and name (1–120 characters) required.'},400)
  const existing=await c.env.DB.prepare('SELECT id,name FROM hcot_cadres WHERE id=?').bind(id).first<{id:number;name:string}>()
  if(!existing)return c.json({error:'Cadre not found.'},404)
  const duplicate=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE name=? COLLATE NOCASE AND id<>?').bind(name,id).first()
  if(duplicate)return c.json({error:'Another cadre already has this name.'},409)
  await c.env.DB.prepare('UPDATE hcot_cadres SET name=? WHERE id=?').bind(name,id).run()
  await log(c.env.DB,'hcot.cadre.renamed',JSON.stringify({id,previous_name:existing.name,new_name:name}),session.email)
  return c.json({ok:true,id,name})
})
api.delete('/hcot/cadres/:id', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Invalid cadre ID.'},400)
  const existing=await c.env.DB.prepare('SELECT id,name FROM hcot_cadres WHERE id=?').bind(id).first<{id:number;name:string}>()
  if(!existing)return c.json({error:'Cadre not found.'},404)
  const usage=await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM staff WHERE cadre_id=?) AS staff_count,
    (SELECT COUNT(*) FROM hcot_cadre_competencies WHERE cadre_id=?) AS competency_count,
    (SELECT COUNT(*) FROM hcot_cadre_groups WHERE cadre_id=?) AS group_count,
    (SELECT COUNT(*) FROM hcot_cadre_group_scopes WHERE cadre_id=?) AS scope_count`).bind(id,id,id,id).first<{staff_count:number;competency_count:number;group_count:number;scope_count:number}>()
  if(usage && Object.values(usage).some(n=>Number(n)>0))return c.json({error:'Cadre is in use. Reassign staff and remove its competency/group mappings before deletion.',usage},409)
  const removed=await c.env.DB.prepare('DELETE FROM hcot_cadres WHERE id=? AND NOT EXISTS(SELECT 1 FROM staff WHERE cadre_id=?) AND NOT EXISTS(SELECT 1 FROM hcot_cadre_competencies WHERE cadre_id=?) AND NOT EXISTS(SELECT 1 FROM hcot_cadre_groups WHERE cadre_id=?) AND NOT EXISTS(SELECT 1 FROM hcot_cadre_group_scopes WHERE cadre_id=?)').bind(id,id,id,id,id).run()
  if(!removed.meta.changes)return c.json({error:'Cadre became referenced and cannot be deleted.'},409)
  await log(c.env.DB,'hcot.cadre.deleted',JSON.stringify({id,name:existing.name}),session.email)
  return c.json({ok:true})
})
api.patch('/hcot/staff/:id/cadre', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  const b=await c.req.json<{cadre_id?:number|null}>().catch(()=>({}))
  if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Invalid staff ID.'},400)
  const staff=await c.env.DB.prepare('SELECT id FROM staff WHERE id=?').bind(id).first()
  if(!staff)return c.json({error:'Staff member not found.'},404)
  const cadreId=b.cadre_id===null?null:Number(b.cadre_id)
  if(cadreId!==null){
    if(!Number.isSafeInteger(cadreId)||cadreId<=0)return c.json({error:'Select a valid cadre.'},400)
    const cadre=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE id=? AND active=1').bind(cadreId).first()
    if(!cadre)return c.json({error:'Cadre not found or inactive.'},404)
  }
  await c.env.DB.prepare('UPDATE staff SET cadre_id=? WHERE id=?').bind(cadreId,id).run()
  return c.json({ok:true})
})
api.get('/hcot/cadre-competencies', async c => {
  const rows=await c.env.DB.prepare(`SELECT m.*,k.name AS cadre_name,p.name AS competency_name,p.category
    FROM hcot_cadre_competencies m JOIN hcot_cadres k ON k.id=m.cadre_id
    JOIN hcot_competencies p ON p.id=m.competency_id ORDER BY k.name COLLATE NOCASE,p.name COLLATE NOCASE`).all()
  return c.json({rules:rows.results||[]})
})
api.post('/hcot/cadre-competencies', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{cadre_id?:number;competency_id?:number;division?:string;department?:string;unit?:string}>().catch(()=>({}))
  const cadreId=Number(b.cadre_id),competencyId=Number(b.competency_id)
  if(!Number.isSafeInteger(cadreId)||cadreId<=0||!Number.isSafeInteger(competencyId)||competencyId<=0)return c.json({error:'Select cadre and competency.'},400)
  const cadre=await c.env.DB.prepare('SELECT id FROM hcot_cadres WHERE id=? AND active=1').bind(cadreId).first()
  const comp=await c.env.DB.prepare('SELECT id,division,department,unit FROM hcot_competencies WHERE id=?').bind(competencyId).first<{id:number;division:string|null;department:string|null;unit:string|null}>()
  if(!cadre||!comp)return c.json({error:'Cadre or competency not found.'},404)
  const division=String(b.division||'').trim()||null,department=String(b.department||'').trim()||null,unit=String(b.unit||'').trim()||null
  const err=await validateStaffDirectory(c.env.DB,division,department,unit)
  if(err)return c.json({error:err},400)
  const eq=(a:string|null,b:string|null)=>!a||!!b&&a.toLowerCase()===b.toLowerCase()
  if(!eq(comp.division,division)||!eq(comp.department,department)||!eq(comp.unit,unit))return c.json({error:'Cadre rule must be within the competency organisational scope.'},409)
  const result=await c.env.DB.prepare('INSERT OR IGNORE INTO hcot_cadre_competencies(cadre_id,competency_id,division,department,unit) VALUES(?,?,?,?,?)').bind(cadreId,competencyId,division,department,unit).run()
  return c.json({ok:true,created:(result.meta.changes||0)>0},201)
})
api.delete('/hcot/cadre-competencies/:id', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Invalid mapping ID.'},400)
  const result=await c.env.DB.prepare('DELETE FROM hcot_cadre_competencies WHERE id=?').bind(id).run()
  return c.json({ok:true,deleted:(result.meta.changes||0)>0})
})
// Bulk import accepts parsed CSV rows. Preview performs identical validation without writes.
api.post('/hcot/cadre-competencies/bulk', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const body=await c.req.json<{rows?:Array<Record<string,unknown>>;commit?:boolean}>().catch(()=>({}))
  if(!Array.isArray(body.rows)||body.rows.length===0||body.rows.length>500)return c.json({error:'Supply 1–500 competency rows.'},400)
  const cadres=(await c.env.DB.prepare('SELECT id,name FROM hcot_cadres WHERE active=1').all<{id:number;name:string}>()).results||[]
  const existing=(await c.env.DB.prepare('SELECT id,name,category,division,department,unit FROM hcot_competencies').all<{id:number;name:string;category:string;division:string|null;department:string|null;unit:string|null}>()).results||[]
  const norm=(x:unknown)=>String(x??'').trim()
  const key=(x:unknown)=>norm(x).toLowerCase()
  const errors:Array<{row:number;error:string}>=[],planned:Array<{name:string;category:string;description:string;cadreId:number;division:string|null;department:string|null;unit:string|null;existingId:number|null}>=[]
  const seen=new Set<string>()
  for(let i=0;i<body.rows.length;i++){
    const row=body.rows[i]||{},name=norm(row.competency_name),category=key(row.category),cadreName=key(row.cadre)
    const division=norm(row.division)||null,department=norm(row.department)||null,unit=norm(row.unit)||null,description=norm(row.description)
    const cadre=cadres.find(x=>key(x.name)===cadreName)
    const issues:string[]=[]
    if(!name||name.length>200)issues.push('Invalid competency name')
    if(!['core','functional'].includes(category))issues.push('Category must be core or functional')
    if(!cadre)issues.push('Cadre not found in the active cadre directory')
    if(description.length>2000)issues.push('Description exceeds 2000 characters')
    const directoryError=await validateStaffDirectory(c.env.DB,division,department,unit)
    if(directoryError)issues.push(directoryError)
    const matching=existing.filter(x=>key(x.name)===key(name))
    const same=matching.find(x=>key(x.category)===category&&key(x.division)===key(division)&&key(x.department)===key(department)&&key(x.unit)===key(unit))
    if(matching.length&&!same)issues.push('Competency name already exists with a different category or scope; resolve manually')
    const unique=[key(name),category,cadreName,key(division),key(department),key(unit)].join('|')
    if(seen.has(unique))issues.push('Duplicate row in upload')
    seen.add(unique)
    if(issues.length)errors.push({row:i+2,error:issues.join('; ')})
    else planned.push({name,category,description,cadreId:cadre!.id,division,department,unit,existingId:same?.id||null})
  }
  if(errors.length)return c.json({ok:false,valid:false,errors,total:body.rows.length},422)
  if(body.commit!==true)return c.json({ok:true,valid:true,preview:planned.map((x,i)=>({row:i+2,competency:x.name,cadre:cadres.find(c=>c.id===x.cadreId)?.name,action:x.existingId?'reuse competency':'create competency',division:x.division,department:x.department,unit:x.unit})),total:planned.length})
  // One D1 batch is transactional: a failed statement rolls back the entire import.
  const statements=[]
  for(const p of planned){
    if(!p.existingId){
      statements.push(c.env.DB.prepare('INSERT INTO hcot_competencies(name,category,division,department,unit,description) VALUES(?,?,?,?,?,?)').bind(p.name,p.category,p.division,p.department,p.unit,p.description||null))
    }
    statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO hcot_cadre_competencies(cadre_id,competency_id,division,department,unit)
      SELECT ?,id,?,?,? FROM hcot_competencies WHERE name=? COLLATE NOCASE AND category=?
      AND COALESCE(division,'')=? AND COALESCE(department,'')=? AND COALESCE(unit,'')=?
      ORDER BY id LIMIT 1`).bind(p.cadreId,p.division,p.department,p.unit,p.name,p.category,p.division||'',p.department||'',p.unit||''))
  }
  await c.env.DB.batch(statements)
  return c.json({ok:true,created_or_reused:planned.length})
})

// Assessment eligibility is derived live from cadre mappings, not copied to staff records.

/* Manager identity comes exclusively from verified Cloudflare Access, never a client-supplied email. */
async function requireAssessmentManager(c:any){
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session)return {error:'Cloudflare Access authentication required.',status:401}
  const email=session.email.trim().toLowerCase()
  const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_line_manager_assignments a JOIN staff s ON s.id=a.staff_id WHERE a.manager_email=? AND s.active=1').bind(email).first<{n:number}>()
  if(!count||count.n<1)return {error:'No active staff are assigned to this line manager.',status:403}
  return {email}
}
async function isAssignedToManager(c:any,staffId:number,email:string){
  const row=await c.env.DB.prepare('SELECT 1 AS found FROM hcot_line_manager_assignments a JOIN staff s ON s.id=a.staff_id WHERE a.staff_id=? AND a.manager_email=? AND s.active=1').bind(staffId,email).first()
  return !!row
}
api.get('/hcot/line-manager/my-staff', async c=>{
  const manager=await requireAssessmentManager(c)
  if(manager.error)return c.json({error:manager.error},manager.status as 401|403)
  const result=await c.env.DB.prepare('SELECT s.id,s.full_name,s.email,s.team AS division,s.role AS department,s.unit,s.cadre_id FROM staff s JOIN hcot_line_manager_assignments a ON a.staff_id=s.id WHERE a.manager_email=? AND s.active=1 ORDER BY s.full_name COLLATE NOCASE').bind(manager.email).all()
  return c.json({staff:result.results||[]})
})
api.get('/hcot/line-manager/assignments', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const rows=await c.env.DB.prepare('SELECT a.staff_id,a.manager_email,a.assigned_by,a.assigned_at,s.full_name,s.email AS staff_email FROM hcot_line_manager_assignments a JOIN staff s ON s.id=a.staff_id ORDER BY a.manager_email,s.full_name').all()
  return c.json({assignments:rows.results||[]})
})
api.post('/hcot/line-manager/assignments', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{staff_id?:number;manager_email?:string}>().catch(()=>({}))
  const staffId=Number(b.staff_id),email=String(b.manager_email||'').trim().toLowerCase()
  if(!Number.isSafeInteger(staffId)||staffId<1||!/^\S+@\S+\.\S+$/.test(email))return c.json({error:'Valid staff ID and manager email are required.'},400)
  const staff=await c.env.DB.prepare('SELECT id,email,active FROM staff WHERE id=?').bind(staffId).first<{id:number;email:string;active:number}>()
  if(!staff||Number(staff.active)!==1)return c.json({error:'Select an active employee from the Staff Roster.'},400)
  if(staff.email.trim().toLowerCase()===email)return c.json({error:'Employees cannot assess themselves.'},400)
  await c.env.DB.prepare('INSERT INTO hcot_line_manager_assignments(staff_id,manager_email,assigned_by) VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET manager_email=excluded.manager_email,assigned_by=excluded.assigned_by,assigned_at=CURRENT_TIMESTAMP').bind(staffId,email,session.email).run()
  await log(c.env.DB,'hcot_line_manager_assignment',JSON.stringify({staff_id:staffId,manager_email:email}),session.email)
  return c.json({ok:true})
})
api.delete('/hcot/line-manager/assignments/:staffId', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('staffId'))
  if(!Number.isSafeInteger(id)||id<1)return c.json({error:'Invalid staff ID.'},400)
  await c.env.DB.prepare('DELETE FROM hcot_line_manager_assignments WHERE staff_id=?').bind(id).run()
  await log(c.env.DB,'hcot_line_manager_unassignment',String(id),session.email)
  return c.json({ok:true})
})
api.post('/hcot/line-manager/assignments/import', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const csv=await c.req.text()
  if(csv.length>1000000)return c.json({error:'CSV exceeds 1 MB.'},413)
  const {headers,rows}=parseDelimited(csv)
  const norm=(x:string)=>x.trim().toLowerCase().replace(/\s+/g,'_')
  const staffIndex=headers.findIndex(h=>norm(h)==='staff_email'),managerIndex=headers.findIndex(h=>norm(h)==='manager_email')
  if(staffIndex<0||managerIndex<0)return c.json({error:'Required CSV columns: staff_email,manager_email.'},400)
  if(!rows.length||rows.length>1000)return c.json({error:'Provide 1–1000 rows.'},400)
  const errors:string[]=[],prepared:{id:number;email:string}[]=[],seen=new Set<number>()
  for(const [index,row] of rows.entries()){
    const staffEmail=String(row[staffIndex]||'').trim().toLowerCase(),email=String(row[managerIndex]||'').trim().toLowerCase()
    if(!/^\S+@\S+\.\S+$/.test(email)||staffEmail===email){errors.push('Row '+(index+2)+': invalid manager email or self-assignment.');continue}
    const matches=await c.env.DB.prepare('SELECT id FROM staff WHERE LOWER(TRIM(email))=? AND active=1').bind(staffEmail).all<{id:number}>()
    if(matches.results.length!==1){errors.push('Row '+(index+2)+': staff email must identify exactly one active roster record.');continue}
    const id=matches.results[0].id
    if(seen.has(id)){errors.push('Row '+(index+2)+': duplicate staff assignment in CSV.');continue}
    seen.add(id);prepared.push({id,email})
  }
  if(errors.length)return c.json({error:'Import rejected; no assignments applied.',errors,error_count:errors.length},400)
  await c.env.DB.batch(prepared.map(x=>c.env.DB.prepare('INSERT INTO hcot_line_manager_assignments(staff_id,manager_email,assigned_by) VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET manager_email=excluded.manager_email,assigned_by=excluded.assigned_by,assigned_at=CURRENT_TIMESTAMP').bind(x.id,x.email,session.email)))
  await log(c.env.DB,'hcot_line_manager_bulk_import',JSON.stringify({count:prepared.length}),session.email)
  return c.json({ok:true,count:prepared.length})
})
/* HCOT Evaluations: cross-manager reporting and explicit in-app assessment requests. */
api.get('/hcot/evaluations/competency-report', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const [assessments,managers,requests]=await Promise.all([
    c.env.DB.prepare(`SELECT a.id,a.staff_id,s.full_name,s.email AS staff_email,a.competency_id,p.name AS competency_name,
      a.cycle,a.score,a.target_score,a.notes,a.assessor_email,a.assessed_at,
      (a.target_score-a.score) AS score_gap
      FROM hcot_competency_assessments a JOIN staff s ON s.id=a.staff_id
      JOIN hcot_competencies p ON p.id=a.competency_id
      ORDER BY a.assessed_at DESC,a.id DESC LIMIT 5000`).all(),
    c.env.DB.prepare(`SELECT a.manager_email,COUNT(*) AS staff_count FROM hcot_line_manager_assignments a
      JOIN staff s ON s.id=a.staff_id WHERE s.active=1 GROUP BY a.manager_email ORDER BY a.manager_email`).all(),
    c.env.DB.prepare(`SELECT r.*,GROUP_CONCAT(s.full_name, ', ') AS staff_names,e.status AS email_status FROM hcot_assessment_requests r LEFT JOIN hcot_assessment_request_staff t ON t.request_id=r.id LEFT JOIN staff s ON s.id=t.staff_id LEFT JOIN hcot_assessment_email_log e ON e.request_id=r.id GROUP BY r.id ORDER BY r.requested_at DESC,r.id DESC LIMIT 500`).all()
  ])
  return c.json({assessments:assessments.results||[],managers:managers.results||[],requests:requests.results||[]})
})
api.get('/hcot/evaluations/manager-staff', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const rows=await c.env.DB.prepare(`SELECT a.manager_email,s.id AS staff_id,s.full_name,s.email AS staff_email
    FROM hcot_line_manager_assignments a JOIN staff s ON s.id=a.staff_id
    WHERE s.active=1 ORDER BY a.manager_email,s.full_name COLLATE NOCASE`).all()
  return c.json({assignments:rows.results||[]})
})
api.post('/hcot/evaluations/assessment-requests', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return c.json({error:'HCOT administrator access required.'},403)
  const body=await c.req.json<{manager_emails?:string[];cycle?:string;staff_ids?:number[]}>().catch(()=>({}))
  const cycle=String(body.cycle||'').trim()
  const emails=[...new Set((Array.isArray(body.manager_emails)?body.manager_emails:[]).map(x=>String(x).trim().toLowerCase()))]
  const ids=[...new Set((Array.isArray(body.staff_ids)?body.staff_ids:[]).map(Number))]
  if(!cycle||cycle.length>80||!emails.length||emails.length>200||ids.length>1000||ids.some(id=>!Number.isSafeInteger(id)||id<1))
    return c.json({error:'Provide a cycle, 1–200 managers and valid staff selections.'},400)
  const rows=await c.env.DB.prepare(`SELECT a.manager_email,s.id AS staff_id,s.full_name
    FROM hcot_line_manager_assignments a JOIN staff s ON s.id=a.staff_id WHERE s.active=1`).all<{manager_email:string;staff_id:number;full_name:string}>()
  const assignments=rows.results||[]
  const byManager=new Map<string,typeof assignments>()
  for(const row of assignments){const key=row.manager_email.trim().toLowerCase();byManager.set(key,[...(byManager.get(key)||[]),row])}
  if(emails.some(email=>!byManager.has(email)))return c.json({error:'Every selected manager must have active assigned staff.'},400)
  const targets=ids.length?assignments.filter(x=>ids.includes(x.staff_id)):assignments.filter(x=>emails.includes(x.manager_email.trim().toLowerCase()))
  if(ids.length&&targets.length!==ids.length)return c.json({error:'One or more selected staff are not active or mapped to a line manager.'},400)
  if(ids.length&&targets.some(x=>!emails.includes(x.manager_email.trim().toLowerCase())))return c.json({error:'Selected staff must belong to the selected line managers.'},400)
  const existing=await c.env.DB.prepare('SELECT id,manager_email FROM hcot_assessment_requests WHERE cycle=? AND status=?').bind(cycle,'pending').all<{id:number;manager_email:string}>()
  const pending=new Map((existing.results||[]).map(x=>[x.manager_email.trim().toLowerCase(),x.id]))
  const outcomes:{manager_email:string;request_id:number;staff_count:number}[]=[]
  for(const email of emails){
    const selected=targets.filter(x=>x.manager_email.trim().toLowerCase()===email)
    if(!selected.length)continue
    const prior=pending.get(email)
    if(prior&&!ids.length){outcomes.push({manager_email:email,request_id:prior,staff_count:selected.length});continue}
    const created=await c.env.DB.prepare('INSERT INTO hcot_assessment_requests(manager_email,cycle,requested_by) VALUES(?,?,?)').bind(email,cycle,session.email).run()
    const requestId=Number(created.meta.last_row_id)
    await c.env.DB.batch(selected.map(x=>c.env.DB.prepare('INSERT INTO hcot_assessment_request_staff(request_id,staff_id) VALUES(?,?)').bind(requestId,x.staff_id)))
    outcomes.push({manager_email:email,request_id:requestId,staff_count:selected.length})
  }
  await log(c.env.DB,'hcot.assessment.requested',JSON.stringify({cycle,requests:outcomes.map(x=>({manager:x.manager_email,id:x.request_id}))}),session.email)
  return c.json({ok:true,created:outcomes.filter(x=>!pending.has(x.manager_email)||ids.length>0).length,results:outcomes})
})
api.get('/hcot/line-manager/assessment-requests', async c=>{
  const manager=await requireAssessmentManager(c)
  if(manager.error)return c.json({error:manager.error},manager.status as 401|403)
  const requests=await c.env.DB.prepare('SELECT r.id,r.cycle,r.requested_at,r.status, GROUP_CONCAT(s.full_name, ', ') AS staff_names FROM hcot_assessment_requests r LEFT JOIN hcot_assessment_request_staff t ON t.request_id=r.id LEFT JOIN staff s ON s.id=t.staff_id WHERE r.manager_email=? GROUP BY r.id ORDER BY r.requested_at DESC,r.id DESC LIMIT 100').bind(manager.email).all()
  return c.json({requests:requests.results||[]})
})
api.get('/hcot/competency-assessments', async c => {
  const manager=await requireAssessmentManager(c)
  if(manager.error)return c.json({error:manager.error},manager.status as 401|403)
  const staffId=Number(c.req.query('staff_id'))
  if(!Number.isSafeInteger(staffId)||staffId<=0)return c.json({error:'Select a staff member.'},400)
  if(!(await isAssignedToManager(c,staffId,manager.email!)))return c.json({error:'Staff member is not assigned to this line manager.'},403)
  const staff=await c.env.DB.prepare('SELECT id,full_name,email,team,role,unit,cadre_id FROM staff WHERE id=?').bind(staffId).first()
  if(!staff)return c.json({error:'Staff member not found.'},404)
  const eligible=await c.env.DB.prepare(`WITH inherited AS (
      SELECT m.competency_id,1 AS inherited,0 AS direct
      FROM staff s JOIN hcot_cadre_competencies m ON m.cadre_id=s.cadre_id
      WHERE s.id=? AND s.active=1
      AND (m.division IS NULL OR LOWER(TRIM(m.division))=LOWER(TRIM(COALESCE(s.team,''))))
      AND (m.department IS NULL OR LOWER(TRIM(m.department))=LOWER(TRIM(COALESCE(s.role,''))))
      AND (m.unit IS NULL OR LOWER(TRIM(m.unit))=LOWER(TRIM(COALESCE(s.unit,''))))
    ), group_inherited AS (
      SELECT gc.competency_id,1 AS inherited,0 AS direct
      FROM staff s
      JOIN hcot_group_competencies gc ON 1=1
      WHERE s.id=? AND s.active=1 AND (
        EXISTS(SELECT 1 FROM hcot_cadre_groups cg WHERE cg.cadre_id=s.cadre_id AND cg.group_id=gc.group_id)
        OR EXISTS(SELECT 1 FROM hcot_cadre_group_scopes gs WHERE gs.cadre_id=s.cadre_id AND gs.group_id=gc.group_id
          AND (gs.division IS NULL OR LOWER(TRIM(gs.division))=LOWER(TRIM(COALESCE(s.team,''))))
          AND (gs.department IS NULL OR LOWER(TRIM(gs.department))=LOWER(TRIM(COALESCE(s.role,''))))
          AND (gs.unit IS NULL OR LOWER(TRIM(gs.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))
      )
    ), direct AS (
      SELECT d.competency_id,0 AS inherited,1 AS direct
      FROM hcot_staff_competencies d JOIN staff s ON s.id=d.staff_id
      WHERE d.staff_id=? AND s.active=1
    ), combined AS (SELECT * FROM inherited UNION ALL SELECT * FROM group_inherited UNION ALL SELECT * FROM direct)
    SELECT p.id,p.name,p.category,MAX(z.inherited) AS inherited,MAX(z.direct) AS direct,gg.group_id,g.name AS group_name
    FROM combined z JOIN hcot_competencies p ON p.id=z.competency_id
    LEFT JOIN hcot_group_competencies gg ON gg.competency_id=p.id
    LEFT JOIN hcot_competency_groups g ON g.id=gg.group_id
    GROUP BY p.id,p.name,p.category,gg.group_id,g.name ORDER BY p.name COLLATE NOCASE`).bind(staffId,staffId,staffId).all()
  const linkedGroups=await c.env.DB.prepare(`SELECT DISTINCT g.id,g.name FROM hcot_competency_groups g
    JOIN staff s ON s.id=?
    WHERE s.active=1 AND (
      EXISTS(SELECT 1 FROM hcot_cadre_groups cg WHERE cg.group_id=g.id AND cg.cadre_id=s.cadre_id)
      OR EXISTS(SELECT 1 FROM hcot_cadre_group_scopes gs WHERE gs.group_id=g.id AND gs.cadre_id=s.cadre_id
        AND (gs.division IS NULL OR LOWER(TRIM(gs.division))=LOWER(TRIM(COALESCE(s.team,''))))
        AND (gs.department IS NULL OR LOWER(TRIM(gs.department))=LOWER(TRIM(COALESCE(s.role,''))))
        AND (gs.unit IS NULL OR LOWER(TRIM(gs.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))
    ) ORDER BY g.name COLLATE NOCASE`).bind(staffId).all()
  const history=await c.env.DB.prepare(`SELECT a.*,p.name AS competency_name,p.category FROM hcot_competency_assessments a
    JOIN hcot_competencies p ON p.id=a.competency_id WHERE a.staff_id=?
    ORDER BY a.assessed_at DESC,a.id DESC LIMIT 500`).bind(staffId).all()
  const pgMatches=await c.env.DB.prepare(`SELECT DISTINCT m.competency_id,p.name AS competency_name,k.title AS kpi_title,g.title AS goal_title,g.cycle
    FROM hcot_performance_kpi_competencies m JOIN hcot_performance_kpis k ON k.id=m.kpi_id
    JOIN hcot_performance_goals g ON g.id=k.goal_id JOIN hcot_competencies p ON p.id=m.competency_id
    WHERE g.staff_id=? AND m.status='approved' ORDER BY g.cycle,g.title,k.title`).bind(staffId).all()
  const pgCount=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_performance_goals WHERE staff_id=?').bind(staffId).first<{n:number}>()
  return c.json({staff,competencies:eligible.results||[],groups:linkedGroups.results||[],assessments:history.results||[],performance_matches:pgMatches.results||[],performance_goals_assigned:(pgCount?.n||0)>0})
})
api.post('/hcot/competency-assessments', async c => {
  const manager=await requireAssessmentManager(c)
  if(manager.error)return c.json({error:manager.error},manager.status as 401|403)
  const b=await c.req.json<{staff_id?:number;competency_id?:number;cycle?:string;score?:number;target_score?:number;notes?:string}>().catch(()=>({}))
  const staffId=Number(b.staff_id),competencyId=Number(b.competency_id),score=Number(b.score),target=b.target_score===undefined?70:Number(b.target_score)
  const cycle=String(b.cycle||'').trim(),notes=String(b.notes||'').trim()
  if(!Number.isSafeInteger(staffId)||staffId<=0||!Number.isSafeInteger(competencyId)||competencyId<=0)return c.json({error:'Select staff and competency.'},400)
  if(!Number.isInteger(score)||score<0||score>100||!Number.isInteger(target)||target<0||target>100)return c.json({error:'Scores and targets must be whole numbers from 0 to 100.'},400)
  if(!cycle||cycle.length>80||notes.length>2000)return c.json({error:'Invalid assessment cycle or notes.'},400)
  if(!(await isAssignedToManager(c,staffId,manager.email!)))return c.json({error:'Staff member is not assigned to this line manager.'},403)
  const eligible=await c.env.DB.prepare(`SELECT 1 AS eligible FROM staff s
    WHERE s.id=? AND s.active=1 AND (
      EXISTS(SELECT 1 FROM hcot_staff_competencies d WHERE d.staff_id=s.id AND d.competency_id=?)
      OR EXISTS(SELECT 1 FROM hcot_cadre_competencies m WHERE m.cadre_id=s.cadre_id AND m.competency_id=?
        AND (m.division IS NULL OR LOWER(TRIM(m.division))=LOWER(TRIM(COALESCE(s.team,''))))
        AND (m.department IS NULL OR LOWER(TRIM(m.department))=LOWER(TRIM(COALESCE(s.role,''))))
        AND (m.unit IS NULL OR LOWER(TRIM(m.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))
      OR EXISTS(SELECT 1 FROM hcot_group_competencies gc
        WHERE gc.competency_id=? AND (
          EXISTS(SELECT 1 FROM hcot_cadre_groups cg WHERE cg.cadre_id=s.cadre_id AND cg.group_id=gc.group_id)
          OR EXISTS(SELECT 1 FROM hcot_cadre_group_scopes gs WHERE gs.cadre_id=s.cadre_id AND gs.group_id=gc.group_id
            AND (gs.division IS NULL OR LOWER(TRIM(gs.division))=LOWER(TRIM(COALESCE(s.team,''))))
            AND (gs.department IS NULL OR LOWER(TRIM(gs.department))=LOWER(TRIM(COALESCE(s.role,''))))
            AND (gs.unit IS NULL OR LOWER(TRIM(gs.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))
        ))
    ) LIMIT 1`).bind(staffId,competencyId,competencyId,competencyId).first()
  if(!eligible)return c.json({error:'Competency is not currently mapped to this staff member.'},409)
  const goalCount=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_performance_goals WHERE staff_id=? AND cycle=?').bind(staffId,cycle).first<{n:number}>()
  if((goalCount?.n||0)>0){
    const approved=await c.env.DB.prepare(`SELECT 1 AS ok FROM hcot_performance_kpi_competencies m
      JOIN hcot_performance_kpis k ON k.id=m.kpi_id JOIN hcot_performance_goals g ON g.id=k.goal_id
      WHERE g.staff_id=? AND g.cycle=? AND m.competency_id=? AND m.status='approved' LIMIT 1`).bind(staffId,cycle,competencyId).first()
    if(!approved)return c.json({error:'Competency is not approved for the staff performance goals in this assessment cycle.'},409)
  }
  const result=await c.env.DB.prepare(`INSERT INTO hcot_competency_assessments(staff_id,competency_id,cycle,score,target_score,assessor_email,notes)
    VALUES(?,?,?,?,?,?,?)`).bind(staffId,competencyId,cycle,score,target,manager.email,notes||null).run()
  return c.json({ok:true,id:result.meta.last_row_id},201)
})

api.get('/hcot/effective-competencies', async c => {
  const rows=await c.env.DB.prepare(`WITH inherited AS (
      SELECT s.id AS staff_id,m.competency_id,1 AS inherited,0 AS direct
      FROM staff s JOIN hcot_cadre_competencies m ON m.cadre_id=s.cadre_id
      WHERE s.active=1
      AND (m.division IS NULL OR LOWER(TRIM(m.division))=LOWER(TRIM(COALESCE(s.team,''))))
      AND (m.department IS NULL OR LOWER(TRIM(m.department))=LOWER(TRIM(COALESCE(s.role,''))))
      AND (m.unit IS NULL OR LOWER(TRIM(m.unit))=LOWER(TRIM(COALESCE(s.unit,''))))
    ), combined AS (
      SELECT * FROM inherited UNION ALL
      SELECT staff_id,competency_id,0 AS inherited,1 AS direct FROM hcot_staff_competencies
    )
    SELECT z.staff_id,z.competency_id,MAX(z.inherited) AS inherited,MAX(z.direct) AS direct,
      s.full_name,s.email,s.cadre_id,p.name AS competency_name,p.category
    FROM combined z JOIN staff s ON s.id=z.staff_id JOIN hcot_competencies p ON p.id=z.competency_id
    GROUP BY z.staff_id,z.competency_id ORDER BY s.full_name COLLATE NOCASE,p.name COLLATE NOCASE`).all()
  return c.json({mappings:rows.results||[]})
})

api.get('/hcot/competency-staff', async c => {
  const rows=await c.env.DB.prepare(`SELECT s.id,s.full_name,s.email,s.team AS division,s.role AS department,s.unit,s.active,s.cadre_id,k.name AS cadre_name
    FROM staff s LEFT JOIN hcot_cadres k ON k.id=s.cadre_id ORDER BY s.full_name COLLATE NOCASE`).all()
  return c.json({staff:rows.results||[]})
})
api.get('/hcot/competency-mappings', async c => {
  const rows=await c.env.DB.prepare(`SELECT m.staff_id,m.competency_id,s.full_name,s.email,c.name AS competency_name
    FROM hcot_staff_competencies m JOIN staff s ON s.id=m.staff_id
    JOIN hcot_competencies c ON c.id=m.competency_id ORDER BY s.full_name COLLATE NOCASE,c.name COLLATE NOCASE`).all()
  return c.json({mappings:rows.results||[]})
})
api.post('/hcot/competency-mappings', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session || !(await isHcotCompetencyAdmin(c,session.email))) return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{staff_id?:number;competency_id?:number}>().catch(()=>({}))
  const staffId=Number(b.staff_id),competencyId=Number(b.competency_id)
  if(!Number.isSafeInteger(staffId)||staffId<=0||!Number.isSafeInteger(competencyId)||competencyId<=0)return c.json({error:'Select staff and competency.'},400)
  const staff=await c.env.DB.prepare('SELECT id,team,role,unit,active FROM staff WHERE id=?').bind(staffId).first<{id:number;team:string|null;role:string|null;unit:string|null;active:number}>()
  if(!staff||staff.active!==1)return c.json({error:'Select an active staff member from the Staff Roster.'},400)
  const comp=await c.env.DB.prepare('SELECT id,division,department,unit FROM hcot_competencies WHERE id=?').bind(competencyId).first<{id:number;division:string|null;department:string|null;unit:string|null}>()
  if(!comp)return c.json({error:'Competency not found.'},404)
  const eq=(a:string|null,b:string|null)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase()
  if((comp.division&&!eq(comp.division,staff.team))||(comp.department&&!eq(comp.department,staff.role))||(comp.unit&&!eq(comp.unit,staff.unit)))return c.json({error:'Competency does not match the staff division, department or unit.'},409)
  const result=await c.env.DB.prepare('INSERT OR IGNORE INTO hcot_staff_competencies(staff_id,competency_id) VALUES(?,?)').bind(staffId,competencyId).run()
  return c.json({ok:true,created:(result.meta.changes||0)>0})
})
api.delete('/hcot/competency-mappings', async c => {
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session || !(await isHcotCompetencyAdmin(c,session.email))) return c.json({error:'HCOT administrator access required.'},403)
  const staffId=Number(c.req.query('staff_id')),competencyId=Number(c.req.query('competency_id'))
  if(!Number.isSafeInteger(staffId)||staffId<=0||!Number.isSafeInteger(competencyId)||competencyId<=0)return c.json({error:'Valid staff and competency IDs required.'},400)
  const result=await c.env.DB.prepare('DELETE FROM hcot_staff_competencies WHERE staff_id=? AND competency_id=?').bind(staffId,competencyId).run()
  return c.json({ok:true,removed:(result.meta.changes||0)>0})
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

/* Performance Goals: suggestions are reviewable, and only approved matches enter the manager workflow. */
const pgWords=(value:string)=>new Set(String(value||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['the','and','for','with','from','that','this','within','each','goal','kpi','achieve','improve','ensure','target','staff','performance'].includes(w)))
const pgRelated:Record<string,string[]>={
  customer:['service','client','complaint','relationship','satisfaction','communication','empathy'],
  complaint:['resolution','customer','service','communication','problem'],
  report:['reporting','analysis','data','accuracy','writing'],
  data:['analysis','analytics','reporting','accuracy','digital'],
  safety:['risk','compliance','health','hse','incident'],
  regulatory:['regulation','compliance','policy','legal'],
  delivery:['project','planning','execution','management'],
  budget:['finance','financial','cost','planning'],
  team:['leadership','collaboration','communication'],
  deadline:['time','planning','organisation','management']
}
function pgScore(kpi:string,competency:string){
  const kw=pgWords(kpi),cw=pgWords(competency)
  let score=0
  for(const w of kw)for(const c of cw){
    if(w===c)score+=4
    else if(w.length>4&&c.length>4&&(w.startsWith(c)||c.startsWith(w)))score+=3
    else if((pgRelated[w]||[]).includes(c)||(pgRelated[c]||[]).includes(w))score+=2
  }
  return score
}
async function pgEligible(db:D1Database,staffId:number){
  const result=await db.prepare(`SELECT DISTINCT p.id,p.name FROM hcot_competencies p JOIN staff s ON s.id=? AND s.active=1
    WHERE EXISTS(SELECT 1 FROM hcot_staff_competencies d WHERE d.staff_id=s.id AND d.competency_id=p.id)
    OR EXISTS(SELECT 1 FROM hcot_cadre_competencies m WHERE m.cadre_id=s.cadre_id AND m.competency_id=p.id
      AND (m.division IS NULL OR LOWER(TRIM(m.division))=LOWER(TRIM(COALESCE(s.team,''))))
      AND (m.department IS NULL OR LOWER(TRIM(m.department))=LOWER(TRIM(COALESCE(s.role,''))))
      AND (m.unit IS NULL OR LOWER(TRIM(m.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))
    OR EXISTS(SELECT 1 FROM hcot_group_competencies gc WHERE gc.competency_id=p.id AND (
      EXISTS(SELECT 1 FROM hcot_cadre_groups cg WHERE cg.cadre_id=s.cadre_id AND cg.group_id=gc.group_id)
      OR EXISTS(SELECT 1 FROM hcot_cadre_group_scopes gs WHERE gs.cadre_id=s.cadre_id AND gs.group_id=gc.group_id
        AND (gs.division IS NULL OR LOWER(TRIM(gs.division))=LOWER(TRIM(COALESCE(s.team,''))))
        AND (gs.department IS NULL OR LOWER(TRIM(gs.department))=LOWER(TRIM(COALESCE(s.role,''))))
        AND (gs.unit IS NULL OR LOWER(TRIM(gs.unit))=LOWER(TRIM(COALESCE(s.unit,'')))))))`).bind(staffId).all<{id:number;name:string}>()
  return result.results||[]
}
async function pgAdmin(c:any){
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session||!(await isHcotCompetencyAdmin(c,session.email)))return null
  return session.email.trim().toLowerCase()
}
async function pgSuggest(db:D1Database,kpiId:number,staffId:number,title:string){
  const eligible=await pgEligible(db,staffId)
  const matches=eligible.map(p=>({id:p.id,score:pgScore(title,p.name)})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score).slice(0,8)
  if(matches.length)await db.batch(matches.map(m=>db.prepare("INSERT OR IGNORE INTO hcot_performance_kpi_competencies(kpi_id,competency_id,match_score) VALUES(?,?,?)").bind(kpiId,m.id,m.score)))
  return matches.length
}
api.get('/hcot/performance-goals', async c=>{
  const session=await verifyAccessJwt(c.req.raw,c.env)
  if(!session)return c.json({error:'Authentication required.'},401)
  const admin=await isHcotCompetencyAdmin(c,session.email)
  const manager=session.email.trim().toLowerCase()
  const staffId=Number(c.req.query('staff_id')||0)
  if(!admin&&(!Number.isSafeInteger(staffId)||staffId<1||!(await isAssignedToManager(c,staffId,manager))))return c.json({error:'Staff not assigned to line manager.'},403)
  const goals=await c.env.DB.prepare(`SELECT g.*,s.full_name,s.email AS staff_email FROM hcot_performance_goals g
    JOIN staff s ON s.id=g.staff_id WHERE (?=1 OR g.staff_id=?) ORDER BY s.full_name,g.cycle,g.id`).bind(admin?1:0,staffId).all()
  const kpis=await c.env.DB.prepare(`SELECT k.*,g.staff_id FROM hcot_performance_kpis k JOIN hcot_performance_goals g ON g.id=k.goal_id
    WHERE (?=1 OR g.staff_id=?) ORDER BY k.id`).bind(admin?1:0,staffId).all()
  const matches=await c.env.DB.prepare(`SELECT m.*,p.name AS competency_name FROM hcot_performance_kpi_competencies m
    JOIN hcot_performance_kpis k ON k.id=m.kpi_id JOIN hcot_performance_goals g ON g.id=k.goal_id
    JOIN hcot_competencies p ON p.id=m.competency_id WHERE (?=1 OR g.staff_id=?) ORDER BY m.match_score DESC,p.name`).bind(admin?1:0,staffId).all()
  return c.json({goals:goals.results||[],kpis:kpis.results||[],matches:matches.results||[],admin})
})
api.post('/hcot/performance-goals/import', async c=>{
  const actor=await pgAdmin(c)
  if(!actor)return c.json({error:'HCOT administrator access required.'},403)
  const body=await c.req.json<{rows?:Array<{staff_email?:string;goal_title?:string;kpi_title?:string;kpi_target?:string;target_date?:string;assessment_cycle?:string}>}>().catch(()=>({}))
  const rows=body.rows
  if(!Array.isArray(rows)||!rows.length||rows.length>300)return c.json({error:'Provide 1–300 KPI rows.'},400)
  const roster=await c.env.DB.prepare('SELECT id,email FROM staff WHERE active=1').all<{id:number;email:string}>()
  const staffByEmail=new Map((roster.results||[]).map(x=>[x.email.toLowerCase(),x.id]))
  const parsed=[] as Array<{staffId:number;goal:string;kpi:string;target:string|null;date:string|null;cycle:string}>
  const errors:string[]=[]
  for(let i=0;i<rows.length;i++){
    const r=rows[i]||{},staffId=staffByEmail.get(String(r.staff_email||'').trim().toLowerCase())
    const goal=String(r.goal_title||'').trim(),kpi=String(r.kpi_title||'').trim(),cycle=String(r.assessment_cycle||'').trim()
    const date=String(r.target_date||'').trim(),target=String(r.kpi_target||'').trim()
    if(!staffId||!goal||!kpi||!cycle||goal.length>250||kpi.length>500||cycle.length>80||target.length>250||(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)))errors.push('Row '+(i+2)+': invalid staff, goal, KPI, cycle, length or date.')
    else parsed.push({staffId,goal,kpi,target:target||null,date:date||null,cycle})
  }
  if(errors.length)return c.json({error:'Import rejected; no rows applied.',errors},400)
  const statements=[]
  for(const r of parsed){
    statements.push(c.env.DB.prepare('INSERT INTO hcot_performance_goals(staff_id,title,cycle,target_date,created_by) VALUES(?,?,?,?,?) ON CONFLICT(staff_id,title,cycle) DO NOTHING').bind(r.staffId,r.goal,r.cycle,r.date,actor))
    statements.push(c.env.DB.prepare(`INSERT INTO hcot_performance_kpis(goal_id,title,target_value)
      SELECT id,?,? FROM hcot_performance_goals WHERE staff_id=? AND title=? AND cycle=?
      ON CONFLICT(goal_id,title) DO NOTHING`).bind(r.kpi,r.target,r.staffId,r.goal,r.cycle))
  }
  await c.env.DB.batch(statements)
  let suggested=0
  for(const r of parsed){
    const kpi=await c.env.DB.prepare(`SELECT k.id FROM hcot_performance_kpis k JOIN hcot_performance_goals g ON g.id=k.goal_id
      WHERE g.staff_id=? AND g.title=? AND g.cycle=? AND k.title=?`).bind(r.staffId,r.goal,r.cycle,r.kpi).first<{id:number}>()
    if(kpi)suggested+=await pgSuggest(c.env.DB,kpi.id,r.staffId,r.kpi+' '+r.goal)
  }
  return c.json({ok:true,rows:parsed.length,suggestions:suggested,review_required:true})
})
api.get('/hcot/performance-goals/eligible', async c=>{
  const actor=await pgAdmin(c)
  if(!actor)return c.json({error:'HCOT administrator access required.'},403)
  const staffId=Number(c.req.query('staff_id'))
  if(!Number.isSafeInteger(staffId)||staffId<1)return c.json({error:'Select staff.'},400)
  return c.json({competencies:await pgEligible(c.env.DB,staffId)})
})
api.patch('/hcot/performance-goals/goal/:id', async c=>{
  const actor=await pgAdmin(c)
  if(!actor)return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  const b=await c.req.json<{title?:string;cycle?:string;target_date?:string|null}>().catch(()=>({}))
  const title=String(b.title||'').trim(),cycle=String(b.cycle||'').trim(),date=String(b.target_date||'').trim()
  if(!Number.isSafeInteger(id)||id<1||!title||!cycle||title.length>250||cycle.length>80||(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)))return c.json({error:'Invalid goal details.'},400)
  const existing=await c.env.DB.prepare('SELECT id,staff_id,cycle FROM hcot_performance_goals WHERE id=?').bind(id).first<{id:number;staff_id:number;cycle:string}>()
  if(!existing)return c.json({error:'Goal not found.'},404)
  if(existing.cycle!==cycle){
    const history=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM hcot_competency_assessments WHERE staff_id=? AND cycle=?').bind(existing.staff_id,existing.cycle).first<{n:number}>()
    if((history?.n||0)>0)return c.json({error:'Assessment history exists for this cycle. Keep the cycle unchanged to preserve assessment links.'},409)
  }
  const duplicate=await c.env.DB.prepare('SELECT id FROM hcot_performance_goals WHERE staff_id=? AND title=? AND cycle=? AND id<>?').bind(existing.staff_id,title,cycle,id).first()
  if(duplicate)return c.json({error:'Another goal already uses this title and cycle for the staff member.'},409)
  await c.env.DB.prepare('UPDATE hcot_performance_goals SET title=?,cycle=?,target_date=? WHERE id=?').bind(title,cycle,date||null,id).run()
  return c.json({ok:true})
})
api.patch('/hcot/performance-goals/kpi/:id', async c=>{
  const actor=await pgAdmin(c)
  if(!actor)return c.json({error:'HCOT administrator access required.'},403)
  const id=Number(c.req.param('id'))
  const b=await c.req.json<{title?:string;target_value?:string|null}>().catch(()=>({}))
  const title=String(b.title||'').trim(),target=String(b.target_value||'').trim()
  if(!Number.isSafeInteger(id)||id<1||!title||title.length>500||target.length>250)return c.json({error:'Invalid KPI details.'},400)
  const existing=await c.env.DB.prepare('SELECT id,goal_id,title FROM hcot_performance_kpis WHERE id=?').bind(id).first<{id:number;goal_id:number;title:string}>()
  if(!existing)return c.json({error:'KPI not found.'},404)
  const duplicate=await c.env.DB.prepare('SELECT id FROM hcot_performance_kpis WHERE goal_id=? AND title=? AND id<>?').bind(existing.goal_id,title,id).first()
  if(duplicate)return c.json({error:'Another KPI under this goal already has this title.'},409)
  await c.env.DB.prepare('UPDATE hcot_performance_kpis SET title=?,target_value=? WHERE id=?').bind(title,target||null,id).run()
  if(existing.title!==title){
    await c.env.DB.prepare("UPDATE hcot_performance_kpi_competencies SET status='suggested',reviewed_by=NULL,reviewed_at=NULL WHERE kpi_id=? AND status='approved'").bind(id).run()
    const staff=await c.env.DB.prepare('SELECT staff_id FROM hcot_performance_goals WHERE id=?').bind(existing.goal_id).first<{staff_id:number}>()
    if(staff)await pgSuggest(c.env.DB,id,staff.staff_id,title)
  }
  return c.json({ok:true,review_required:existing.title!==title})
})
api.post('/hcot/performance-goals/review', async c=>{
  const actor=await pgAdmin(c)
  if(!actor)return c.json({error:'HCOT administrator access required.'},403)
  const b=await c.req.json<{kpi_id?:number;competency_id?:number;status?:string}>().catch(()=>({}))
  const kpiId=Number(b.kpi_id),compId=Number(b.competency_id)
  if(!Number.isSafeInteger(kpiId)||kpiId<1||!Number.isSafeInteger(compId)||compId<1||!['approved','rejected'].includes(String(b.status)))return c.json({error:'Invalid review.'},400)
  const kpi=await c.env.DB.prepare(`SELECT g.staff_id FROM hcot_performance_kpis k JOIN hcot_performance_goals g ON g.id=k.goal_id WHERE k.id=?`).bind(kpiId).first<{staff_id:number}>()
  if(!kpi)return c.json({error:'KPI not found.'},404)
  const eligible=await pgEligible(c.env.DB,kpi.staff_id)
  if(!eligible.some(x=>x.id===compId))return c.json({error:'Competency is not mapped to this staff.'},409)
  await c.env.DB.prepare(`INSERT INTO hcot_performance_kpi_competencies(kpi_id,competency_id,status,reviewed_by,reviewed_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(kpi_id,competency_id) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP`).bind(kpiId,compId,b.status,actor).run()
  return c.json({ok:true})
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
