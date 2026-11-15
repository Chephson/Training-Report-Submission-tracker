import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
const db=readFileSync('src/lib/db.ts','utf8')
const route=api.slice(api.indexOf("api.delete('/hcot/plans/:id'"),api.indexOf("api.get('/hcot/plans/:id/participants'"))
test('draft deletion is protected by HCOT admin middleware',()=>{
 assert.match(api,/api\.use\('\/hcot\/\*'/)
 assert.match(route,/plan\.status!=='draft'/)
 assert.match(route,/DELETE FROM hcot_training_plans/)
 assert.match(route,/status='draft'/)
 assert.match(route,/hcot\.plan\.deleted/)
})
test('draft deletion blocks linked review and cost records',()=>{
 assert.match(route,/hcot_reviews/)
 assert.match(route,/hcot_cost_estimates/)
 assert.match(route,/409/)
 assert.match(db,/FOREIGN KEY\(plan_id\) REFERENCES hcot_training_plans\(id\) ON DELETE CASCADE/)
})
test('admin UI offers delete draft with confirmation and refresh',()=>{
 assert.match(ui,/hcot-delete/)
 assert.match(ui,/window\.confirm\('Permanently delete draft training plan/)
 assert.match(ui,/method:'DELETE'/)
 assert.match(ui,/Draft training plan deleted/)
})

test('draft action handlers iterate querySelectorAll results, not a single element',()=>{
 assert.match(ui,/\$\$\('\.hcot-delete'\)\.forEach/)
 assert.match(ui,/\$\$\('\.hcot-edit'\)\.forEach/)
 assert.doesNotMatch(ui,/(?<!\$)\$\('\.hcot-delete'\)\.forEach/)
 assert.doesNotMatch(ui,/(?<!\$)\$\('\.hcot-edit'\)\.forEach/)
})
