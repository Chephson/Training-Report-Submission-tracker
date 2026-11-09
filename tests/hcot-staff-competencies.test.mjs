import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const db=readFileSync('src/lib/db.ts','utf8')
const api=readFileSync('src/api.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
test('staff competency mapping has composite key and nullable department migration',()=>{
  assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_staff_competencies/)
  assert.match(db,/PRIMARY KEY\(staff_id, competency_id\)/)
  assert.match(db,/ALTER TABLE hcot_competencies ADD COLUMN department TEXT/)
})
test('mapping API validates active roster identity and organisational scope',()=>{
  for(const method of ['get','post','delete'])assert.ok(api.includes(`api.${method}('/hcot/competency-mappings'`))
  assert.match(api,/staff.active!==1/)
  assert.match(api,/Competency does not match the staff division, department or unit/)
  assert.match(api,/isHcotCompetencyAdmin/)
  assert.match(api,/INSERT OR IGNORE INTO hcot_staff_competencies/)
})
test('competency interface filters division department and optional units',()=>{
  assert.match(ui,/id="hcot-comp-dept"/)
  assert.match(ui,/id="hcot-comp-unit"/)
  assert.match(ui,/id="hcot-map-staff"/)
  assert.match(ui,/id="hcot-map-comp"/)
  assert.match(ui,/staffSelect.onchange/)
})
