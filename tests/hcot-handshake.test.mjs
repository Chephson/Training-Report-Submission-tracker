import test from 'node:test'
import assert from 'node:assert/strict'
import {previewHandshake} from '../src/lib/hcot-handshake.ts'

test('matches normalized programme titles and counts only missing assignments',()=>{
  const result=previewHandshake(
    [{id:1,title:'  Regulatory   Training ',status:'draft'}],
    [{id:9,name:'regulatory training'}],
    [{plan_id:1,staff_id:2},{plan_id:1,staff_id:3},{plan_id:1,staff_id:3}],
    [{programme_id:9,staff_id:2}]
  )
  assert.equal(result.summary.matched,1)
  assert.equal(result.summary.assignments_to_add,1)
  assert.deepEqual(result.plans[0].staff_ids_to_assign,[3])
})

test('does not auto-select ambiguous programme matches',()=>{
  const result=previewHandshake(
    [{id:1,title:'Safety',status:'draft'}],
    [{id:1,name:'Safety'},{id:2,name:' safety '}],
    [{plan_id:1,staff_id:7}],[]
  )
  assert.equal(result.summary.ambiguous,1)
  assert.equal(result.plans[0].programme_id,null)
})

test('does not mutate caller data',()=>{
  const plans=[{id:1,title:'New course',status:'draft'}]
  const participants=[{plan_id:1,staff_id:5}]
  const result=previewHandshake(plans,[],participants,[])
  assert.equal(result.summary.new_programmes,1)
  assert.deepEqual(plans,[{id:1,title:'New course',status:'draft'}])
  assert.deepEqual(participants,[{plan_id:1,staff_id:5}])
})
