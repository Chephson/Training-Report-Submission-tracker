import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const api = readFileSync('src/api.ts','utf8')
const ui = readFileSync('public/static/app.js','utf8')
const schema = readFileSync('src/lib/db.ts','utf8')
test('directory schema exists without dropping existing staff fields or identifiers',()=>{
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_divisions/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_departments/)
  assert.match(schema,/email TEXT NOT NULL UNIQUE COLLATE NOCASE, team TEXT, role TEXT/)
})
test('directory endpoints allow listing, adding, renaming, deleting with in-use guard',()=>{
  for(const method of ['get','post','patch','delete']) assert.ok(api.includes(`api.${method}('/staff-directory/:kind'`))
  assert.match(api,/Reassign them before deleting it/)
  assert.match(api,/validateStaffDirectory/)
})
test('roster uses editable division and department dropdowns',()=>{
  assert.match(ui,/Manage divisions & departments/)
  assert.match(ui,/function staffDirectoryModal/)
  assert.match(ui,/function staffModal/)
  assert.ok(ui.includes("select('divisions','s-team'"))
  assert.ok(ui.includes("select('departments','s-role'"))
  assert.ok(ui.includes('<th>Division</th><th>Department</th>'))
})
