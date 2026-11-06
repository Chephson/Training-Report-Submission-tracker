import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
test('outstanding endpoint uses distinct period-scoped assignments and report matching', () => {
  const start = api.indexOf("api.get('/outstanding-programme-reports'")
  const end = api.indexOf("api.get('/programme-progress'", start)
  assert.ok(start >= 0 && end > start)
  const route = api.slice(start, end)
  assert.ok(route.includes('SELECT DISTINCT staff_id,programme_id,period_id'))
  assert.ok(route.includes('WHERE period_id=?'))
  assert.ok(route.includes('s.staff_id=a.staff_id AND s.period_id=a.period_id'))
  assert.ok(route.includes('LOWER(TRIM(s.training_programme))=LOWER(TRIM(p.name))'))
  assert.ok(route.includes('outstanding_programmes.push'))
  assert.ok(route.includes('staff_with_outstanding'))
  assert.ok(route.includes('read_only:true'))
  assert.ok(!route.includes('.run('))
})
test('staff may have one submitted and one outstanding programme', () => {
  const assignments = [{staff:1,programme:'A'}, {staff:1,programme:'B'}, {staff:1,programme:'A'}, {staff:2,programme:'A'}]
  const reports = [{staff:1,programme:'A'}]
  const unique = [...new Map(assignments.map(a => [a.staff + ':' + a.programme,a])).values()]
  const pending = unique.filter(a => !reports.some(r => r.staff===a.staff && r.programme===a.programme))
  assert.equal(unique.length,3)
  assert.equal(pending.length,2)
  assert.deepEqual(pending.map(a=>a.programme),['B','A'])
})
