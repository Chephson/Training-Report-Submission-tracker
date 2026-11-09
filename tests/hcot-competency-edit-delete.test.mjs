import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8'),ui=readFileSync('public/static/app.js','utf8')
test('competency update is admin-only and rejects incompatible existing mappings',()=>{
 assert.match(api,/api\.patch\('\/hcot\/competencies\/:id'/)
 assert.match(api,/isHcotCompetencyAdmin\(c,session\.email\)/)
 assert.match(api,/This change would conflict with existing staff assignments/)
 assert.match(api,/UPDATE hcot_competencies SET/)
})
test('competency delete is admin-only and protects staff mappings',()=>{
 assert.match(api,/api\.delete\('\/hcot\/competencies\/:id'/)
 assert.match(api,/Remove its staff assignments before deleting it/)
 assert.match(api,/DELETE FROM hcot_competencies WHERE id=\? AND NOT EXISTS/)
})
test('admin UI offers edit and delete with explicit confirmation',()=>{
 assert.match(ui,/hcot-comp-edit/)
 assert.match(ui,/hcot-comp-delete/)
 assert.match(ui,/method:'PATCH'/)
 assert.match(ui,/method:'DELETE'/)
 assert.match(ui,/confirm\('Delete competency/)
})
