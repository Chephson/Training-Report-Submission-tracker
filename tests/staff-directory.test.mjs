import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
const schema=readFileSync('src/lib/db.ts','utf8')
test('division-scoped directory schema preserves staff identity',()=>{
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_divisions/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_departments/)
  assert.match(schema,/UNIQUE\(division_name, name\)/)
  assert.match(schema,/UNIQUE\(division_name, department_name, name\)/)
  assert.match(schema,/ALTER TABLE staff ADD COLUMN unit TEXT/)
  assert.match(schema,/email TEXT NOT NULL UNIQUE COLLATE NOCASE, team TEXT, role TEXT/)
})
test('department CRUD is division-scoped and deletion guards assigned staff',()=>{
  for(const kind of ['divisions','departments']) for(const method of ['get','post','patch','delete']) assert.ok(api.includes(`api.${method}('/staff-directory/${kind}'`))
  assert.match(api,/Department must belong to the selected division/)
  assert.match(api,/Unit must belong to the selected department/)
  assert.match(api,/api.get\('\/staff-directory\/units'/)
  assert.match(api,/api.post\('\/staff-directory\/units'/)
  assert.match(api,/api.patch\('\/staff-directory\/units'/)
  assert.match(api,/api.delete\('\/staff-directory\/units'/)
  assert.match(api,/Reassign staff before deleting this department/)
  assert.match(api,/validateStaffDirectory\(c.env.DB, division \|\| null, department \|\| null\)/)
})
test('staff UI cascades departments from selected division',()=>{
  assert.ok(ui.includes('Manage divisions & departments'))
  assert.ok(ui.includes("api('/staff-directory/departments?division='+encodeURIComponent(division))"))
  assert.ok(ui.includes("m.$('#s-team').addEventListener('change',()=>updateDepartments(''))"))
  assert.ok(ui.includes('<th>Division</th><th>Department</th><th>Unit</th>'))
  assert.ok(ui.includes('Not applicable / no unit'))
  assert.ok(ui.includes("m.$('#s-role').addEventListener('change',()=>updateUnits(''))"))
})
