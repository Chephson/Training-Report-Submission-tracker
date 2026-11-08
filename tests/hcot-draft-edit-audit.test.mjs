import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const update = api.slice(api.indexOf("api.patch('/hcot/plans/:id'"), api.indexOf("api.get('/hcot/plans/:id/participants'"))
const auth = api.slice(api.indexOf('/* P0: HCOT least-privilege'), api.indexOf('/* Schema migration runs after'))

test('draft plan updates require verified administrator authorization', () => {
  assert.match(auth, /isHcotViewerRead\(method, path\)/)
  assert.match(auth, /if \(viewerRead\) return next\(\)/)
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

test('collection event handlers and staff filters never use the single-element selector', () => {
  assert.match(ui, /\$\$\('\.hcot-manage'\)\.forEach/)
  assert.match(ui, /\$\$\('\.pg-staff'\)\.forEach/)
  assert.doesNotMatch(ui, /(?<!\$)\$\([^\n]*?\)\.forEach\(/, 'forEach must not be called on the single-element $ selector')
})

test('read-only HCOT viewer workspace never fetches the staff roster or renders edit actions', () => {
  const viewer = ui.slice(ui.indexOf('  if(!isAdmin){', ui.indexOf('async function renderHCOT(el)')), ui.indexOf('  const [data,roster]=', ui.indexOf('async function renderHCOT(el)')))
  assert.match(viewer, /api\('\/hcot\/plans'\)/)
  assert.match(viewer, /data-section="calendar"/)
  assert.match(viewer, /data-section="competencies"/)
  assert.doesNotMatch(viewer, /api\('\/staff'\)|hcot-create|hcot-edit|hcot-manage|data-section="reviews"|data-section="identity"/)
  assert.match(viewer, /return\s*\n\s*}/)
  assert.match(ui, /const session=await api\('\/hcot\/access-session'\)/)
  assert.match(ui, /const isAdmin=session\.role==='admin'/)
})

test('viewer competency library hides creation controls', () => {
  const section = ui.slice(ui.indexOf("}else if(section==='competencies'){"),ui.indexOf("}else if(section==='goals'){"))
  assert.match(section, /const isAdmin=\(await api\('\/hcot\/access-session'\)\)\.role==='admin'/)
  assert.match(section, /\(isAdmin\?/)
  assert.match(section, /if\(isAdmin\)\$\('#hcot-comp-add'\)/)
})
