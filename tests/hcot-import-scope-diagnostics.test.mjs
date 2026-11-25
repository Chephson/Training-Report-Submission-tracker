import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const helper=api.slice(api.indexOf('async function explainCompetencyImportScope'),api.indexOf('/* ---------------- staff roster'))
const importer=api.slice(api.indexOf("api.post('/hcot/competency-groups/import'"),api.indexOf("api.post('/hcot/competency-groups/assign-competency'"))
test('import scope diagnostics include entered hierarchy and existing unit associations',()=>{
  assert.match(helper,/Division/)
  assert.match(helper,/Department/)
  assert.match(helper,/Unit/)
  assert.match(helper,/FROM staff_units/)
  assert.match(helper,/FROM staff/)
  assert.match(helper,/Existing directory\/roster associations/)
  assert.match(helper,/not found in the directory or staff roster/)
})
test('importer includes diagnostics and retains all-or-nothing rejection',()=>{
  assert.match(importer,/await explainCompetencyImportScope/)
  assert.match(importer,/Import rejected; no rows applied/)
  assert.ok(importer.indexOf('if(errors.length)return c.json')<importer.indexOf('await c.env.DB.batch(statements)'))
})
test('diagnostics are read only and do not auto-create directory records',()=>{
  assert.doesNotMatch(helper,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|staff_)/i)
})
