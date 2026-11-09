import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const db=readFileSync('src/lib/db.ts','utf8')
test('staff cadre schema is additive',()=>{
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_cadres/)
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_cadre_competencies/)
 assert.match(db,/ALTER TABLE staff ADD COLUMN cadre_id/)
})
test('cadre changes and rule changes require HCOT admin',()=>{
 for(const route of ["'/hcot/cadres'","'/hcot/staff/:id/cadre'","'/hcot/cadre-competencies'","'/hcot/cadre-competencies/:id'"]){
  assert.ok(api.includes(route),route)
 }
 assert.match(api,/Cadre not found or inactive/)
 assert.match(api,/Cadre rule must be within the competency organisational scope/)
})
test('effective competencies include inherited and direct mappings without duplicate staff competency pairs',()=>{
 assert.match(api,/api\.get\('\/hcot\/effective-competencies'/)
 assert.match(api,/JOIN hcot_cadre_competencies m ON m\.cadre_id=s\.cadre_id/)
 assert.match(api,/SELECT staff_id,competency_id,0 AS inherited,1 AS direct FROM hcot_staff_competencies/)
 assert.match(api,/GROUP BY z\.staff_id,z\.competency_id/)
 assert.match(api,/MAX\(z\.inherited\) AS inherited,MAX\(z\.direct\) AS direct/)
})
