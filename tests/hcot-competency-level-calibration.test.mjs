import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8'),ui=readFileSync('public/static/app.js','utf8')
test('cadre dropdown shows names from canonical cadre directory, retaining IDs only as values',()=>{
 assert.match(ui,/cadreDirectory=\]await Promise\.all|cadreDirectory\]=await Promise\.all/)
 assert.match(ui,/cadre:\(cadreDirectory\.cadres\|\|\[\]\)/)
 assert.match(ui,/label:c\.name/)
})
test('administrator can recalibrate level target policy within fixed competence bands',()=>{
 const route=api.slice(api.indexOf("api.put('/hcot/competency-level-target-policy'"),api.indexOf("async function hcotMappedTarget"))
 assert.match(route,/isHcotCompetencyAdmin/)
 assert.match(route,/Number\.isInteger/)
 assert.match(route,/HCOT_SCORE_BANDS/)
 assert.match(route,/UPDATE hcot_mapping_competency_targets SET target_score/)
 assert.match(route,/await c\.env\.DB\.batch\(statements\)/)
 assert.doesNotMatch(route,/UPDATE hcot_competency_assessments/)
 assert.match(route,/recalibrated/)
})
test('CSV target importer uses saved level calibration rather than hard-coded defaults',()=>{
 assert.match(api,/const levelScores=await hcotLevelPolicy\(c\.env\.DB\)/)
 assert.match(api,/score=levelScores\[level\]/)
 assert.match(ui,/hct-policy-save/)
 assert.match(ui,/hct-policy-score/)
})
