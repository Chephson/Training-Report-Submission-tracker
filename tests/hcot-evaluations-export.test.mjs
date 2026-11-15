import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
test('evaluation export requires administrator and SQL filters for all five dimensions',()=>{
 const block=api.slice(api.indexOf("api.get('/hcot/evaluations/export'"),api.indexOf("/* HCOT Evaluations:"))
 assert.match(block,/isHcotCompetencyAdmin\(c,session.email\)/)
 for(const name of ['staff_id','division','department','cadre_id','group_id'])assert.ok(block.includes(name),name)
 assert.match(block,/EXISTS\(SELECT 1 FROM hcot_group_competencies/)
 assert.match(block,/hcot_cadre_group_scopes/)
 assert.match(block,/a.target_score/)
 assert.match(block,/hcot.evaluations.exported/)
 assert.doesNotMatch(block,/UPDATE hcot_competency_assessments|DELETE FROM hcot_competency_assessments/)
})
test('evaluations UI exports UTF-8 CSV with filters and qualitative levels',()=>{
 for(const id of ['hce-export-staff','hce-export-division','hce-export-department','hce-export-cadre','hce-export-group','hce-export-download'])assert.ok(ui.includes(id),id)
 assert.match(ui,/hcot\/evaluations\/export\?/)
 assert.match(ui,/text\/csv;charset=utf-8/)
 assert.match(ui,/competenceLevel\(x.score\)/)
 assert.match(ui,/competenceLevel\(x.target_score\)/)
})
