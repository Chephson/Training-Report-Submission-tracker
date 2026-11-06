import test from 'node:test'
import assert from 'node:assert/strict'
import { recordResponse } from '../src/lib/ingest.ts'

function mockDatabase() {
  const submissions = []
  const activity = []
  const staff = [{ id: 7, full_name: 'Test Staff', email: 'test.staff@example.invalid', team: 'Test', role: null, active: 1 }]
  return {
    submissions, activity,
    prepare(sql) {
      let params = []
      const statement = {
        bind(...values) { params = values; return statement },
        async all() {
          if (sql.includes('FROM staff')) return { results: staff }
          throw new Error('Unexpected all query: ' + sql)
        },
        async first() {
          if (!sql.includes('FROM submissions')) throw new Error('Unexpected first query: ' + sql)
          const [periodId, staffId, programme] = params
          return submissions.find(s => s.period_id === periodId && s.staff_id === staffId &&
            s.training_programme.trim().toLowerCase() === programme.trim().toLowerCase()) ?? null
        },
        async run() {
          if (sql.includes('INSERT INTO submissions')) {
            const [staff_id, period_id, source, form_response_id, matched_by, submitted_email, submitted_at,
              notes, raw_json, training_programme, training_start_date, duration_days] = params
            submissions.push({ id: submissions.length + 1, staff_id, period_id, source, form_response_id,
              matched_by, submitted_email, submitted_at, notes, raw_json, training_programme,
              training_start_date, duration_days })
          } else if (sql.includes('UPDATE submissions SET submitted_at')) {
            const [submitted_at, id] = params
            const item = submissions.find(s => s.id === id)
            if (!item) throw new Error('Missing submission')
            item.submitted_at = submitted_at
          } else if (sql.includes('INSERT INTO activity')) {
            activity.push(params)
          } else throw new Error('Unexpected run query: ' + sql)
          return { success: true }
        },
      }
      return statement
    },
  }
}

function response(programme, date, id) {
  return {
    email: 'TEST.STAFF@example.invalid',
    full_name: 'Test Staff',
    submitted_at: date,
    response_id: id,
    training_programme: programme,
    training_start_date: '2026-10-01',
    duration_days: 2,
    notes: null,
    raw: { programme },
  }
}

test('same staff can submit two different programmes in the same period', async () => {
  const db = mockDatabase()
  assert.equal((await recordResponse(db, 1, response('Cybersecurity', '2026-10-10T10:00:00Z', 'r1'), 'form')).status, 'recorded')
  assert.equal((await recordResponse(db, 1, response('Data Analytics', '2026-10-11T10:00:00Z', 'r2'), 'form')).status, 'recorded')
  assert.equal(db.submissions.length, 2)
  assert.deepEqual(db.submissions.map(s => s.training_programme), ['Cybersecurity', 'Data Analytics'])
  assert.deepEqual(db.submissions.map(s => s.staff_id), [7, 7])
})

test('duplicate programme is not inserted again and earliest submission time is retained', async () => {
  const db = mockDatabase()
  await recordResponse(db, 1, response('Cybersecurity', '2026-10-12T10:00:00Z', 'r1'), 'form')
  const result = await recordResponse(db, 1, response(' cybersecurity ', '2026-10-10T10:00:00Z', 'r2'), 'form')
  assert.equal(result.status, 'duplicate')
  assert.equal(db.submissions.length, 1)
  assert.equal(db.submissions[0].submitted_at, '2026-10-10T10:00:00Z')
})

test('same programme in another reporting period is recorded separately', async () => {
  const db = mockDatabase()
  await recordResponse(db, 1, response('Cybersecurity', '2026-10-10T10:00:00Z', 'r1'), 'form')
  assert.equal((await recordResponse(db, 2, response('Cybersecurity', '2026-11-10T10:00:00Z', 'r2'), 'form')).status, 'recorded')
  assert.equal(db.submissions.length, 2)
})
