import type { D1Database } from '@cloudflare/workers-types'
import { log, newToken } from './db'
import { namesMatch, normEmail, type IngestRecord } from './core'

export type Staff = {
  id: number
  full_name: string
  email: string
  team: string | null
  role: string | null
  active: number
}

export type Period = {
  id: number
  name: string
  form_url: string | null
  due_date: string | null
  status: string
  webhook_token: string
  created_at: string
}

export type IngestOutcome = {
  status: 'recorded' | 'duplicate' | 'unmatched' | 'invalid'
  staff?: { id: number; full_name: string }
  matched_by?: string
  reason?: string
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** Find the roster entry a payload refers to: exact email first, then name. */
export function matchStaff(
  staff: Staff[],
  email: string | null,
  fullName: string | null
): { staff: Staff; matched_by: string } | null {
  if (email) {
    const hit = staff.find((s) => normEmail(s.email) === email)
    if (hit) return { staff: hit, matched_by: 'email' }
  }
  if (fullName) {
    const exact = staff.find((s) => namesMatch(s.full_name, fullName))
    if (exact) return { staff: exact, matched_by: 'name' }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Recording a single response
 * ------------------------------------------------------------------ */

export async function recordResponse(
  db: D1Database,
  periodId: number,
  rec: IngestRecord,
  source: string,
  actor = 'system'
): Promise<IngestOutcome> {
  const email = normEmail(rec.email)
  const name = rec.full_name?.trim() || null

  if (!email && !name) {
    await db
      .prepare(
        `INSERT INTO unmatched (period_id, email, full_name, submitted_at, reason, payload, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        periodId,
        null,
        null,
        rec.submitted_at,
        'no_email_or_name',
        JSON.stringify(rec.raw).slice(0, 4000),
        source
      )
      .run()
    return { status: 'invalid', reason: 'The response contained no email address and no name.' }
  }

  const staffRows = await db
    .prepare('SELECT id, full_name, email, team, role, active FROM staff')
    .all<Staff>()
  const match = matchStaff(staffRows.results ?? [], email, name)

  if (!match) {
    await db
      .prepare(
        `INSERT INTO unmatched (period_id, email, full_name, submitted_at, reason, payload, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        periodId,
        email,
        name,
        rec.submitted_at,
        email ? 'email_not_on_roster' : 'name_not_on_roster',
        JSON.stringify(rec.raw).slice(0, 4000),
        source
      )
      .run()
    await log(db, 'unmatched', `${name ?? '?'} <${email ?? 'no email'}> could not be matched`, actor)
    return {
      status: 'unmatched',
      reason: `"${name ?? email}" is not on the roster. Add them, or link the response from the Inbox.`,
    }
  }

  const programme = rec.training_programme?.trim() || 'Unspecified training programme'
  const existing = await db
    .prepare('SELECT id, submitted_at FROM submissions WHERE period_id = ? AND staff_id = ? AND LOWER(TRIM(training_programme)) = LOWER(TRIM(?))')
    .bind(periodId, match.staff.id, programme)
    .first<{ id: number; submitted_at: string }>()

  if (existing) {
    // keep the earliest genuine submission time
    if (rec.submitted_at < existing.submitted_at) {
      await db
        .prepare('UPDATE submissions SET submitted_at = ? WHERE id = ?')
        .bind(rec.submitted_at, existing.id)
        .run()
    }
    return {
      status: 'duplicate',
      staff: { id: match.staff.id, full_name: match.staff.full_name },
      matched_by: match.matched_by,
      reason: 'Already recorded for this period — kept the earliest submission time.',
    }
  }

  await db
    .prepare(
      `INSERT INTO submissions
         (staff_id, period_id, source, form_response_id, matched_by, submitted_email, submitted_at, notes, raw_json, training_programme, training_start_date, duration_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      match.staff.id,
      periodId,
      source,
      rec.response_id,
      match.matched_by,
      email,
      rec.submitted_at,
      rec.notes,
      JSON.stringify(rec.raw).slice(0, 4000),
      programme,
      rec.training_start_date,
      rec.duration_days
    )
    .run()

  await log(
    db,
    'submission',
    `${match.staff.full_name} submitted '${programme}' for period #${periodId} (${source}, matched by ${match.matched_by})`,
    actor
  )

  return {
    status: 'recorded',
    staff: { id: match.staff.id, full_name: match.staff.full_name },
    matched_by: match.matched_by,
  }
}

/* ------------------------------------------------------------------ *
 * Tokens / periods
 * ------------------------------------------------------------------ */

export async function periodByToken(db: D1Database, token: string): Promise<Period | null> {
  if (!token) return null
  const r = await db.prepare('SELECT * FROM periods WHERE webhook_token = ?').bind(token).first<Period>()
  return r ?? null
}

/** The single open period, or the most recent one. */
export async function defaultPeriod(db: D1Database): Promise<Period | null> {
  const open = await db
    .prepare("SELECT * FROM periods WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    .first<Period>()
  if (open) return open
  return (
    (await db.prepare('SELECT * FROM periods ORDER BY id DESC LIMIT 1').first<Period>()) ?? null
  )
}

/** Backfill tokens for rows created before tokens existed. */
export async function ensureTokens(db: D1Database) {
  const rows = await db
    .prepare("SELECT id FROM periods WHERE webhook_token IS NULL OR webhook_token = ''")
    .all<{ id: number }>()
  for (const r of rows.results ?? []) {
    await db.prepare('UPDATE periods SET webhook_token = ? WHERE id = ?').bind(newToken(), r.id).run()
  }
}

/* ------------------------------------------------------------------ *
 * Progress helpers
 * ------------------------------------------------------------------ */

export type ProgressRow = {
  staff_id: number
  full_name: string
  email: string
  team: string | null
  role: string | null
  active: number
  submitted_at: string | null
  source: string | null
  matched_by: string | null
  training_programmes?: string | null
}

export async function progressFor(
  db: D1Database,
  periodId: number,
  opts: { team?: string; q?: string; status?: string } = {}
): Promise<ProgressRow[]> {
  const where: string[] = ['s.active = 1']
  const binds: unknown[] = [periodId, periodId]

  if (opts.team) {
    where.push('s.team = ?')
    binds.push(opts.team)
  }
  if (opts.q) {
    where.push('(LOWER(s.full_name) LIKE ? OR LOWER(s.email) LIKE ?)')
    const like = `%${opts.q.toLowerCase()}%`
    binds.push(like, like)
  }
  if (opts.status === 'submitted') where.push('sb.submitted_at IS NOT NULL')
  if (opts.status === 'pending') where.push('sb.submitted_at IS NULL')

  const sql = `
    SELECT s.id AS staff_id, s.full_name, s.email, s.team, s.role, s.active,
           sb.submitted_at, sb.source, sb.matched_by, sb.training_programmes
      FROM staff s
      LEFT JOIN (SELECT staff_id, period_id, MAX(submitted_at) AS submitted_at,
                        MAX(source) AS source, MAX(matched_by) AS matched_by,
                        GROUP_CONCAT(DISTINCT training_programme) AS training_programmes
                   FROM submissions WHERE period_id = ? GROUP BY staff_id, period_id) sb
        ON sb.staff_id = s.id AND sb.period_id = ?
     WHERE ${where.join(' AND ')}
     ORDER BY sb.submitted_at IS NULL DESC, s.full_name COLLATE NOCASE`

  const res = await db.prepare(sql).bind(...binds).all<ProgressRow>()
  return res.results ?? []
}
