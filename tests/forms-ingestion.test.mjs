import test from 'node:test'
import assert from 'node:assert/strict'
import { detectColumns, extractRecord, parseDelimited } from '../src/lib/core.ts'

test('Microsoft Forms CSV detects programme column and keeps separate course titles', () => {
  const csv = 'Responder email,Completion time,Training Programme,Response Id\n' +
    'staff@example.invalid,2026-10-01,Cybersecurity,1\n' +
    'staff@example.invalid,2026-10-02,Data Analytics,2\n'
  const { headers, rows } = parseDelimited(csv)
  const mapping = detectColumns(headers)
  assert.equal(mapping.programme, 2)
  assert.deepEqual(rows.map(row => row[mapping.programme]), ['Cybersecurity', 'Data Analytics'])
})

test('Power Automate payload extracts distinct programmes and submission metadata', () => {
  const a = extractRecord({ body: { email: 'STAFF@example.invalid', trainingProgramme: 'Cybersecurity',
    submittedAt: '2026-10-01T10:00:00Z', responseId: 'response-1', durationDays: 3 } })
  const b = extractRecord({ body: { email: 'STAFF@example.invalid', trainingProgramme: 'Data Analytics',
    submittedAt: '2026-10-02T10:00:00Z', responseId: 'response-2', durationDays: 2 } })
  assert.equal(a?.email, 'staff@example.invalid')
  assert.equal(a?.training_programme, 'Cybersecurity')
  assert.equal(a?.response_id, 'response-1')
  assert.equal(a?.duration_days, 3)
  assert.equal(b?.training_programme, 'Data Analytics')
  assert.equal(b?.response_id, 'response-2')
})

test('Forms column names identify programme attended', () => {
  const headers = ['Email Address', 'Name', 'Programme Attended', 'Completion Time']
  assert.equal(detectColumns(headers).programme, 2)
})
