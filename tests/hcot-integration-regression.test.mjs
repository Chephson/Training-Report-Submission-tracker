import test from 'node:test'
import assert from 'node:assert/strict'
import { previewHandshake } from '../src/lib/hcot-handshake.ts'

test('same employee assigned to two distinct training programmes is counted twice', () => {
  const result = previewHandshake(
    [{ id: 1, title: 'Cybersecurity', status: 'draft' }, { id: 2, title: 'Data Analytics', status: 'draft' }],
    [{ id: 11, name: 'Cybersecurity' }, { id: 12, name: 'Data Analytics' }],
    [{ plan_id: 1, staff_id: 7 }, { plan_id: 2, staff_id: 7 }],
    []
  )
  assert.equal(result.summary.matched, 2)
  assert.equal(result.summary.assignments_to_add, 2)
  assert.deepEqual(result.plans.map(p => p.staff_ids_to_assign), [[7], [7]])
})

test('existing assignments are not proposed again and repeated participants are deduplicated', () => {
  const result = previewHandshake(
    [{ id: 1, title: 'Regulatory Training', status: 'draft' }],
    [{ id: 21, name: 'Regulatory Training' }],
    [{ plan_id: 1, staff_id: 4 }, { plan_id: 1, staff_id: 4 }, { plan_id: 1, staff_id: 5 }],
    [{ programme_id: 21, staff_id: 4 }]
  )
  assert.equal(result.plans[0].participants, 2)
  assert.equal(result.plans[0].already_assigned, 1)
  assert.equal(result.plans[0].would_assign, 1)
  assert.deepEqual(result.plans[0].staff_ids_to_assign, [5])
})

test('unmatched and ambiguous programmes never propose assignments', () => {
  const result = previewHandshake(
    [{ id: 1, title: 'Unknown', status: 'draft' }, { id: 2, title: 'Safety', status: 'draft' }],
    [{ id: 31, name: 'Safety' }, { id: 32, name: ' safety ' }],
    [{ plan_id: 1, staff_id: 4 }, { plan_id: 2, staff_id: 5 }],
    []
  )
  assert.equal(result.summary.new_programmes, 1)
  assert.equal(result.summary.ambiguous, 1)
  assert.equal(result.summary.assignments_to_add, 0)
  assert.equal(result.summary.blocked_participants, 2)
  assert.deepEqual(result.plans.map(p => p.staff_ids_to_assign), [[], []])
})

test('preview leaves all input arrays and records unchanged', () => {
  const plans = [{ id: 1, title: 'Cybersecurity', status: 'draft' }]
  const programmes = [{ id: 1, name: 'Cybersecurity' }]
  const participants = [{ plan_id: 1, staff_id: 9 }]
  const assignments = [{ programme_id: 1, staff_id: 8 }]
  const before = JSON.stringify([plans, programmes, participants, assignments])
  previewHandshake(plans, programmes, participants, assignments)
  assert.equal(JSON.stringify([plans, programmes, participants, assignments]), before)
})
