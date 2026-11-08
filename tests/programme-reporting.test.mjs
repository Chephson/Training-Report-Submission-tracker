import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
test('programme reporting counts unique assigned employees and submitted employees', () => {
  const begin = source.indexOf("api.get('/programmes'")
  const end = source.indexOf("api.post('/programmes'", begin)
  assert.ok(begin >= 0 && end > begin)
  const handler = source.slice(begin, end)
  assert.equal(handler.split('COUNT(DISTINCT a.staff_id)').length - 1, 2)
  assert.ok(handler.includes('s.staff_id=a.staff_id'))
  assert.ok(handler.includes('s.period_id=a.period_id'))
  assert.ok(handler.includes('Math.max(0, p.assigned-p.submitted)'))
})
test('one employee attending two programmes counts once per programme', () => {
  const assignments = [
    { staff: 1, programme: 'Cybersecurity' },
    { staff: 1, programme: 'Data Analytics' },
    { staff: 1, programme: 'Cybersecurity' },
    { staff: 2, programme: 'Cybersecurity' },
  ]
  const reports = [{ staff: 1, programme: 'Cybersecurity' }, { staff: 1, programme: 'Data Analytics' }]
  const summary = name => {
    const staff = new Set(assignments.filter(a => a.programme === name).map(a => a.staff))
    const submitted = [...staff].filter(id => reports.some(r => r.staff === id && r.programme === name)).length
    return { assigned: staff.size, submitted, pending: Math.max(0, staff.size - submitted) }
  }
  assert.deepEqual(summary('Cybersecurity'), { assigned: 2, submitted: 1, pending: 1 })
  assert.deepEqual(summary('Data Analytics'), { assigned: 1, submitted: 1, pending: 0 })
})
