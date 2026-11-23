import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8'),ui=readFileSync('public/static/app.js','utf8')
test('goals view shows only selected staff and defaults to collapsed',()=>{
 assert.match(ui,/id="pg-view-staff"/)
 assert.match(ui,/class="card mt-12 pg-goal-card" data-staff/)
 assert.match(ui,/card\.hidden=!id\|\|card\.dataset\.staff!==id/)
})
test('goals CSV endpoint accepts each individual filter and restricts to admin',()=>{
 const route=api.slice(api.indexOf("api.get('/hcot/performance-goals/export'"),api.indexOf("api.post('/hcot/performance-goals/import'"))
 assert.match(route,/pgAdmin\(c\)/)
 for(const field of ['staff','division','department','unit','cadre'])assert.ok(route.includes(field))
 assert.match(route,/WHERE \$\{predicate\[filter\]\}/)
 assert.match(route,/hcot_performance_kpis/)
 assert.match(route,/hcot_performance_kpi_competencies/)
 assert.match(route,/text\/csv/)
 assert.match(ui,/id="pg-export-type"/)
 assert.match(ui,/id="pg-export-value"/)
 assert.match(ui,/pg-export-run/)
})
