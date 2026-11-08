import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const update = api.slice(api.indexOf("api.patch('/hcot/plans/:id'"), api.indexOf("api.get('/hcot/plans/:id/participants'"))
const auth = api.slice(api.indexOf('/* P0: HCOT least-privilege'), api.indexOf('/* Schema migration runs after'))

test('draft plan updates require verified administrator authorization', () => {
  assert.match(auth, /method === 'PATCH'/)
  assert.ok(auth.includes(String.raw`/^\/hcot\/plans\/[^/]+$/`), 'PATCH training-plan route must be administrator-protected')
  assert.match(auth, /admins\.includes\(identity\.email\.trim\(\)\.toLowerCase\(\)\)/)
  assert.match(auth, /permission required\.' }, 403/)
})
test('only draft plans can be updated; failed updates do not emit audit events', () => {
  assert.match(update, /WHERE id=\? AND status='draft'/)
  assert.match(update, /if\(!result\.meta\.changes\)return c\.json\(\{error:'Draft plan not found\.'\},404\)/)
  assert.ok(update.indexOf('if(!result.meta.changes)') < update.indexOf("'hcot.plan.updated'"))
})
test('successful update emits a verified-actor audit entry with plan ID', () => {
  assert.match(update, /verifyAccessJwt\(c\.req\.raw, c\.env\)/)
  assert.match(update, /log\(c\.env\.DB,'hcot\.plan\.updated',`Training plan #\$\{id\}`,actor!\.email\)/)
})
test('UI offers Edit draft only for draft plans and persists via PATCH', () => {
  assert.match(ui, /p\.status==='draft'\?'<button class="btn btn-sm hcot-edit"/)
  assert.match(ui, /\$\$\('\.hcot-edit'\)\.forEach/, 'Edit draft handlers must use the collection selector $$')
  assert.doesNotMatch(ui, /(?<!\$)\$\('\.hcot-edit'\)\.forEach/, 'Do not call forEach on the single-element $ selector')
  assert.match(ui, /method:'PATCH',body:JSON\.stringify\(payload\)/)
  assert.match(ui, /renderHCOT\(el\)/)
  assert.match(ui, /hcot-edit-cancel/)
})
