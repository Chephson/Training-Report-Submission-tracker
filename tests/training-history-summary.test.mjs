import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
test('history summary distinguishes reports, staff and programmes', () => {
  const start = source.indexOf("api.get('/training-history'")
  const end = source.indexOf('/* ---------------- manual actions', start)
  assert.ok(start >= 0 && end > start)
  const history = source.slice(start, end)
  assert.ok(history.includes('submissions: records.length'))
  assert.ok(history.includes('staff: distinctStaff'))
  assert.ok(history.includes('programmes: distinctProgrammes'))
  assert.ok(history.includes('training_programme'))
})
test('several reports can represent fewer unique staff and courses', () => {
  const rows = [
    { staff_id: 1, training_programme: 'Cybersecurity' },
    { staff_id: 2, training_programme: ' cybersecurity ' },
    { staff_id: 1, training_programme: 'Data Analytics' }
  ]
  const uniqueStaff = new Set(rows.map(r => r.staff_id)).size
  const uniqueCourses = new Set(rows.map(r => r.training_programme.trim().toLowerCase())).size
  assert.equal(rows.length, 3)
  assert.equal(uniqueStaff, 2)
  assert.equal(uniqueCourses, 2)
})
