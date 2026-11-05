import type { D1Database } from '@cloudflare/workers-types'
import { newToken, setSetting } from './db'

/**
 * A realistic sample roster so the tracker is immediately explorable.
 * Seeded once; Settings → "Clear all data" removes it permanently.
 */
const STAFF: [string, string, string, string][] = [
  // name, email, team, role
  ['Amina Yusuf', 'amina.yusuf@example.org', 'Science', 'Lead Trainer'],
  ['David Okafor', 'david.okafor@example.org', 'Science', 'Trainer'],
  ['Priya Raman', 'priya.raman@example.org', 'Science', 'Trainer'],
  ['Tom Whitfield', 'tom.whitfield@example.org', 'Mathematics', 'Lead Trainer'],
  ['Grace Mbeki', 'grace.mbeki@example.org', 'Mathematics', 'Trainer'],
  ['Daniel Kim', 'daniel.kim@example.org', 'Mathematics', 'Trainer'],
  ['Fatima Bello', 'fatima.bello@example.org', 'Literacy', 'Trainer'],
  ['Owen Pritchard', 'owen.pritchard@example.org', 'Literacy', 'Trainer'],
  ['Chloe Adeyemi', 'chloe.adeyemi@example.org', 'Literacy', 'Trainer'],
  ['Ravi Menon', 'ravi.menon@example.org', 'Vocational', 'Head of Department'],
  ['Sofia Álvarez', 'sofia.alvarez@example.org', 'Vocational', 'Trainer'],
  ['Joseph Nkemdi', 'joseph.nkemdi@example.org', 'Vocational', 'Trainer'],
  ['Hannah Levine', 'hannah.levine@example.org', 'Vocational', 'Trainer'],
  ['Ibrahim Sule', 'ibrahim.sule@example.org', 'Digital Skills', 'Trainer'],
  ['Mei Chen', 'mei.chen@example.org', 'Digital Skills', 'Trainer'],
  ['Peter Achebe', 'peter.achebe@example.org', 'Digital Skills', 'Trainer'],
  ['Lucy Bennett', 'lucy.bennett@example.org', 'Safeguarding', 'Trainer'],
  ['Ahmed Farouk', 'ahmed.farouk@example.org', 'Safeguarding', 'Trainer'],
  ['Nadia Haddad', 'nadia.haddad@example.org', 'Safeguarding', 'Trainer'],
  ['Sam Okonjo', 'sam.okonjo@example.org', 'Assessment', 'Trainer'],
  ['Emily Ross', 'emily.ross@example.org', 'Assessment', 'Trainer'],
  ['Kwame Asante', 'kwame.asante@example.org', 'Assessment', 'Trainer'],
  ['Tara Murphy', 'tara.murphy@example.org', 'Quality Assurance', 'Trainer'],
  ['Victor Nakamura', 'victor.nakamura@example.org', 'Quality Assurance', 'Trainer'],
]

// index into STAFF of people who have already submitted
const SUBMITTED: [number, number][] = [
  // [staff index, hours-ago]
  [0, 74], [1, 71], [2, 68], [4, 62], [6, 55], [5, 51], [8, 47], [7, 44],
  [10, 38], [11, 33], [9, 30], [13, 26], [14, 22], [16, 18], [17, 14], [15, 9],
  [19, 6], [20, 3], [21, 2],
]

export async function seedDemo(db: D1Database) {
  const seeded = await db
    .prepare("SELECT value FROM settings WHERE key = 'seeded'")
    .first<{ value: string }>()
  if (seeded) return
  const count = await db.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  if ((count?.n ?? 0) > 0) {
    await setSetting(db, 'seeded', '1')
    return
  }

  const year = new Date().getFullYear()
  const term = new Date().getMonth() < 4 ? 'Term 1' : new Date().getMonth() < 8 ? 'Term 2' : 'Term 3'

  const period = await db
    .prepare('INSERT INTO periods (name, form_url, due_date, status, webhook_token) VALUES (?, ?, ?, ?, ?)')
    .bind(
      `${term} ${year} · Individual Training Reports`,
      'https://forms.office.com/r/example-form-id',
      new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10),
      'open',
      newToken()
    )
    .run()
  const periodId = Number(period.meta.last_row_id)

  // an earlier, closed period so the period switcher has meaning
  await db
    .prepare('INSERT INTO periods (name, due_date, status, webhook_token) VALUES (?, ?, ?, ?)')
    .bind(
      `${new Date().getMonth() < 4 ? 'Term 3' : 'Term 1'} ${year - 1} · Refresher Training`,
      new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10),
      'closed',
      newToken()
    )
    .run()

  for (const [name, email, team, role] of STAFF) {
    await db
      .prepare('INSERT OR IGNORE INTO staff (full_name, email, team, role, active) VALUES (?, ?, ?, ?, 1)')
      .bind(name, email, team, role)
      .run()
  }

  const rows = await db.prepare('SELECT id, full_name, email FROM staff ORDER BY id').all<{
    id: number
    full_name: string
    email: string
  }>()
  const list = rows.results ?? []

  for (const [idx, hoursAgo] of SUBMITTED) {
    const person = list[idx]
    if (!person) continue
    const when = new Date(Date.now() - hoursAgo * 3600000).toISOString()
    await db
      .prepare(
        `INSERT OR IGNORE INTO submissions
           (staff_id, period_id, source, matched_by, submitted_email, submitted_at, notes)
         VALUES (?, ?, 'form', 'email', ?, ?, 'Seeded sample')`
      )
      .bind(person.id, periodId, person.email, when)
      .run()
  }

  await db
    .prepare(
      `INSERT INTO activity (event, detail, actor, ts) VALUES
         ('period.created', ?, 'admin', ?),
         ('import', 'Sample roster of ${STAFF.length} staff loaded', 'admin', ?)`
    )
    .bind(
      `${term} ${year} reporting period opened`,
      new Date(Date.now() - 90 * 3600000).toISOString(),
      new Date(Date.now() - 89 * 3600000).toISOString()
    )
    .run()

  await setSetting(db, 'seeded', '1')
  await setSetting(db, 'org_name', 'Training & Development Team')
  await setSetting(db, 'demo', '1')
}
