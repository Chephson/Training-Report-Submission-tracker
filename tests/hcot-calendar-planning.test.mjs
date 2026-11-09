import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui=readFileSync('public/static/app.js','utf8')

test('HCOT planning and draft controls are confined to Calendar tab',()=>{
  assert.match(ui,/const planning=\$\('#hcot-calendar-planning'\)/)
  assert.match(ui,/if\(planning\) planning.hidden=section!=='calendar'/)
  assert.match(ui,/id="hcot-calendar-planning"/)
  assert.match(ui,/id="hcot-create"/)
  assert.match(ui,/id="hcot-participants" class="mt-16"><\/div><\/div>'/)
})

test('HCOT other sections and calendar continue to render',()=>{
  for(const section of ['calendar','competencies','goals','reviews','costing','handshake','identity']){
    assert.ok(ui.includes("section==='"+section+"'"),section)
  }
})
