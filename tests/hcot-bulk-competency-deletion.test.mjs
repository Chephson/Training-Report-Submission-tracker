import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
const db=readFileSync('src/lib/db.ts','utf8')
const route=api.slice(api.indexOf("api.post('/hcot/competencies/bulk-delete'"),api.indexOf("api.delete('/hcot/competency-groups/:id'"))
test('bulk deletion is admin-only and requires an exact commit confirmation',()=>{
  assert.match(route,/verifyAccessJwt/)
  assert.match(route,/isHcotCompetencyAdmin/)
  assert.match(route,/group_ids/)
  assert.match(route,/competency_ids/)
  assert.match(route,/if\(!body\.commit\)return c\.json\(\{ok:true,impact\}\)/)
  assert.match(route,/DELETE SELECTED COMPETENCIES/)
})
test('bulk deletion archives orphaned competencies and retains shared competencies',()=>{
  assert.match(route,/linkedToDeleted/)
  assert.match(route,/!groupSet\.has\(x\.group_id\)/)
  assert.match(route,/archiveIds\.add\(id\)/)
  assert.match(route,/shared_competencies_preserved/)
  assert.match(route,/UPDATE hcot_competencies SET archived_at=CURRENT_TIMESTAMP/)
  assert.doesNotMatch(route,/DELETE FROM hcot_competencies/)
  assert.doesNotMatch(route,/DELETE FROM hcot_competency_assessments/)
  assert.match(route,/await c\.env\.DB\.batch\(statements\)/)
  assert.match(route,/hcot\.competencies\.bulk_archived/)
})
test('library uses search, group filter, pagination, bulk selection and impact review',()=>{
  for(const id of ['hcot-library-search','hcot-library-group','hcot-library-page','hcot-library-prev','hcot-library-next','hcot-bulk-review','hcot-bulk-delete'])assert.ok(ui.includes(id),id)
  assert.match(ui,/perPage=12/)
  assert.match(ui,/competencies_to_archive/)
  assert.match(ui,/shared_competencies_preserved/)
})
test('archived competency metadata is maintained',()=>{
  assert.match(db,/ALTER TABLE hcot_competencies ADD COLUMN archived_at TEXT/)
  assert.match(db,/ALTER TABLE hcot_competencies ADD COLUMN archived_by TEXT/)
})
