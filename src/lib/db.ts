import type { D1Database } from '@cloudflare/workers-types'

export type Env = { DB: D1Database }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY, value TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS periods (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, form_url TEXT,
     due_date TEXT, status TEXT NOT NULL DEFAULT 'open', webhook_token TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS staff (
     id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE, team TEXT, role TEXT,
     active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS staff_divisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS staff_departments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE,
     division_name TEXT NOT NULL COLLATE NOCASE,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(division_name, name))`,
  `CREATE TABLE IF NOT EXISTS staff_units (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE,
     division_name TEXT NOT NULL COLLATE NOCASE,
     department_name TEXT NOT NULL COLLATE NOCASE,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(division_name, department_name, name))`,
  `CREATE TABLE IF NOT EXISTS submissions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, period_id INTEGER NOT NULL,
     source TEXT NOT NULL DEFAULT 'form', form_response_id TEXT, matched_by TEXT,
     submitted_email TEXT, submitted_at TEXT NOT NULL, notes TEXT, raw_json TEXT,
     training_programme TEXT NOT NULL DEFAULT 'Unspecified training programme',
     training_start_date TEXT, duration_days REAL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
     FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_period ON submissions(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_staff ON submissions(staff_id)`,
  `CREATE TABLE IF NOT EXISTS programmes (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
     description TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS programme_assignments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, programme_id INTEGER NOT NULL,
     staff_id INTEGER NOT NULL, period_id INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(programme_id, staff_id, period_id),
     FOREIGN KEY(programme_id) REFERENCES programmes(id),
     FOREIGN KEY(staff_id) REFERENCES staff(id),
     FOREIGN KEY(period_id) REFERENCES periods(id))`,
  `CREATE INDEX IF NOT EXISTS idx_programme_assignments_period ON programme_assignments(period_id, programme_id)`,
  `CREATE TABLE IF NOT EXISTS hcot_training_plans (
     id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, start_date TEXT,
     end_date TEXT, location TEXT, provider TEXT, status TEXT NOT NULL DEFAULT 'draft',
     notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS hcot_participants (
     id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(plan_id,staff_id),
     FOREIGN KEY(plan_id) REFERENCES hcot_training_plans(id) ON DELETE CASCADE,
     FOREIGN KEY(staff_id) REFERENCES staff(id))`,
  `CREATE TABLE IF NOT EXISTS hcot_staff_links (
     hcot_staff_number TEXT PRIMARY KEY, tracker_staff_id INTEGER NOT NULL UNIQUE,
     verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(tracker_staff_id) REFERENCES staff(id))`,
  `CREATE TABLE IF NOT EXISTS hcot_mapping_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, hcot_staff_number TEXT NOT NULL, tracker_staff_id INTEGER NOT NULL, requested_by TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_hcot_mapping_requests_status ON hcot_mapping_requests(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS hcot_competencies (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'core',
     division TEXT, unit TEXT, description TEXT,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS hcot_staff_competencies (
     staff_id INTEGER NOT NULL, competency_id INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY(staff_id, competency_id),
     FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE,
     FOREIGN KEY(competency_id) REFERENCES hcot_competencies(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS hcot_cadres (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS hcot_cadre_competencies (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     cadre_id INTEGER NOT NULL, competency_id INTEGER NOT NULL,
     division TEXT, department TEXT, unit TEXT,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(cadre_id) REFERENCES hcot_cadres(id),
     FOREIGN KEY(competency_id) REFERENCES hcot_competencies(id) ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_hcot_cadre_competency_scope
     ON hcot_cadre_competencies(cadre_id,competency_id,COALESCE(division,''),COALESCE(department,''),COALESCE(unit,''))`,
  `CREATE TABLE IF NOT EXISTS hcot_competency_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS hcot_group_competencies (
    group_id INTEGER NOT NULL,
    competency_id INTEGER NOT NULL UNIQUE,
    PRIMARY KEY(group_id,competency_id),
    FOREIGN KEY(group_id) REFERENCES hcot_competency_groups(id),
    FOREIGN KEY(competency_id) REFERENCES hcot_competencies(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS hcot_cadre_groups (
    cadre_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY(cadre_id,group_id),
    FOREIGN KEY(cadre_id) REFERENCES hcot_cadres(id),
    FOREIGN KEY(group_id) REFERENCES hcot_competency_groups(id))`,
  `CREATE TABLE IF NOT EXISTS hcot_cadre_group_scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cadre_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    division TEXT,
    department TEXT,
    unit TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cadre_id) REFERENCES hcot_cadres(id),
    FOREIGN KEY(group_id) REFERENCES hcot_competency_groups(id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_hcot_cadre_group_scope
    ON hcot_cadre_group_scopes(cadre_id,group_id,COALESCE(division,''),COALESCE(department,''),COALESCE(unit,''))`,
  `CREATE TABLE IF NOT EXISTS hcot_line_manager_assignments (
     staff_id INTEGER PRIMARY KEY,
     manager_email TEXT NOT NULL COLLATE NOCASE,
     assigned_by TEXT NOT NULL,
     assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(staff_id) REFERENCES staff(id))`,
  `CREATE INDEX IF NOT EXISTS idx_hcot_line_manager_email ON hcot_line_manager_assignments(manager_email)`,
  `CREATE TABLE IF NOT EXISTS hcot_competency_assessments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     staff_id INTEGER NOT NULL,
     competency_id INTEGER NOT NULL,
     cycle TEXT NOT NULL,
     score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
     target_score INTEGER NOT NULL DEFAULT 70 CHECK(target_score BETWEEN 0 AND 100),
     assessor_email TEXT NOT NULL,
     notes TEXT,
     assessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(staff_id) REFERENCES staff(id),
     FOREIGN KEY(competency_id) REFERENCES hcot_competencies(id))`,
  `CREATE INDEX IF NOT EXISTS idx_hcot_assessments_staff_cycle ON hcot_competency_assessments(staff_id,cycle,assessed_at)`,
  `CREATE TABLE IF NOT EXISTS hcot_assessment_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     manager_email TEXT NOT NULL,
     cycle TEXT NOT NULL,
     requested_by TEXT NOT NULL,
     requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     status TEXT NOT NULL DEFAULT 'pending',
     CHECK(status IN ('pending','completed')))`,
  `CREATE TABLE IF NOT EXISTS hcot_assessment_request_staff (
     request_id INTEGER NOT NULL REFERENCES hcot_assessment_requests(id),
     staff_id INTEGER NOT NULL REFERENCES staff(id),
     PRIMARY KEY(request_id,staff_id))`,
  `CREATE TABLE IF NOT EXISTS hcot_assessment_email_log (
     request_id INTEGER PRIMARY KEY REFERENCES hcot_assessment_requests(id),
     status TEXT NOT NULL,
     attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     provider_reference TEXT,
     error_message TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_hcot_assessment_requests_manager ON hcot_assessment_requests(manager_email,status)`,
  `CREATE TABLE IF NOT EXISTS hcot_goals (
     id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
     scope TEXT NOT NULL DEFAULT 'unit', owner_label TEXT,
     target_date TEXT, measure TEXT, target_value TEXT,
     status TEXT NOT NULL DEFAULT 'draft',
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS hcot_reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
     staff_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
     rating INTEGER, notes TEXT, reviewed_at TEXT,
     UNIQUE(plan_id,staff_id),
     FOREIGN KEY(plan_id) REFERENCES hcot_training_plans(id),
     FOREIGN KEY(staff_id) REFERENCES staff(id))`,
  `CREATE TABLE IF NOT EXISTS hcot_cost_estimates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     plan_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
     currency TEXT NOT NULL DEFAULT 'NGN',
     allowance_amount REAL NOT NULL DEFAULT 0,
     transport_amount REAL NOT NULL DEFAULT 0,
     accommodation_amount REAL NOT NULL DEFAULT 0,
     course_fee_amount REAL NOT NULL DEFAULT 0,
     total_amount REAL NOT NULL DEFAULT 0,
     rate_basis TEXT NOT NULL DEFAULT 'unverified',
     status TEXT NOT NULL DEFAULT 'draft',
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(plan_id,staff_id),
     FOREIGN KEY(plan_id) REFERENCES hcot_training_plans(id),
     FOREIGN KEY(staff_id) REFERENCES staff(id))`,
  `CREATE TABLE IF NOT EXISTS unmatched (
     id INTEGER PRIMARY KEY AUTOINCREMENT, period_id INTEGER, email TEXT, full_name TEXT,
     submitted_at TEXT, reason TEXT, payload TEXT, source TEXT,
     resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     event TEXT NOT NULL, detail TEXT, actor TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts DESC)`,
]

let ready: Promise<void> | null = null

/** Create tables if missing (idempotent, memoised per isolate). */
export function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    for (const stmt of SCHEMA) await db.prepare(stmt).run()
    const staffCols = await db.prepare('PRAGMA table_info(staff)').all<{ name: string }>()
    if (!(staffCols.results ?? []).some(c => c.name === 'unit')) {
      await db.prepare('ALTER TABLE staff ADD COLUMN unit TEXT').run()
    }
    const cadreCols=await db.prepare('PRAGMA table_info(staff)').all<{name:string}>()
    if(!(cadreCols.results??[]).some(c=>c.name==='cadre_id')) await db.prepare('ALTER TABLE staff ADD COLUMN cadre_id INTEGER REFERENCES hcot_cadres(id)').run()
    const competencyCols=await db.prepare('PRAGMA table_info(hcot_competencies)').all<{name:string}>()
    if(!(competencyCols.results??[]).some(c=>c.name==='department')) await db.prepare('ALTER TABLE hcot_competencies ADD COLUMN department TEXT').run()
    // Upgrade existing installations without losing historical submissions.
    const cols = await db.prepare('PRAGMA table_info(submissions)').all<{ name: string }>()
    if (!(cols.results ?? []).some((c) => c.name === 'training_programme')) {
      await db.prepare("ALTER TABLE submissions ADD COLUMN training_programme TEXT NOT NULL DEFAULT 'Unspecified training programme'").run()
      await db.prepare("UPDATE submissions SET training_programme = COALESCE((SELECT name FROM periods WHERE periods.id = submissions.period_id), 'Unspecified training programme')").run()
    }
    const refreshedCols = await db.prepare('PRAGMA table_info(submissions)').all<{ name: string }>()
    if (!(refreshedCols.results ?? []).some((c) => c.name === 'training_start_date')) await db.prepare('ALTER TABLE submissions ADD COLUMN training_start_date TEXT').run()
    if (!(refreshedCols.results ?? []).some((c) => c.name === 'duration_days')) await db.prepare('ALTER TABLE submissions ADD COLUMN duration_days REAL').run()
    const sql = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='submissions'").first<{ sql: string }>()
    if (sql?.sql?.includes('UNIQUE (period_id, staff_id)')) {
      await db.prepare(`CREATE TABLE submissions_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, period_id INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'form', form_response_id TEXT, matched_by TEXT, submitted_email TEXT,
        submitted_at TEXT NOT NULL, notes TEXT, raw_json TEXT, training_programme TEXT NOT NULL DEFAULT 'Unspecified training programme',
        training_start_date TEXT, duration_days REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
        FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE)`).run()
      await db.prepare(`INSERT INTO submissions_v2 (id,staff_id,period_id,source,form_response_id,matched_by,submitted_email,submitted_at,notes,raw_json,training_programme,training_start_date,duration_days,created_at)
        SELECT id,staff_id,period_id,source,form_response_id,matched_by,submitted_email,submitted_at,notes,raw_json,training_programme,training_start_date,duration_days,created_at FROM submissions`).run()
      await db.prepare('DROP TABLE submissions').run()
      await db.prepare('ALTER TABLE submissions_v2 RENAME TO submissions').run()
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_period ON submissions(period_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_staff ON submissions(staff_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_period_staff_programme ON submissions(period_id, staff_id, training_programme)').run()
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function log(db: D1Database, event: string, detail = '', actor = 'system') {
  await db
    .prepare('INSERT INTO activity (event, detail, actor, ts) VALUES (?, ?, ?, ?)')
    .bind(event, detail, actor, new Date().toISOString())
    .run()
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return r?.value ?? fallback
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value, new Date().toISOString())
    .run()
}

/** A brand-new install gets one open period so the tracker is usable immediately. */
export async function ensureDefaultPeriod(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM periods').first<{ n: number }>()
  if ((row?.n ?? 0) > 0) return
  const year = new Date().getFullYear()
  await db
    .prepare('INSERT INTO periods (name, status, webhook_token) VALUES (?, ?, ?)')
    .bind(`Training Reports ${year}`, 'open', newToken())
    .run()
}
