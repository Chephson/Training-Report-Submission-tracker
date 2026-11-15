import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const api=readFileSync(new URL('../src/api.ts',import.meta.url),'utf8')
const ui=readFileSync(new URL('../public/static/app.js',import.meta.url),'utf8')
test('supervisor routes pass HCOT admin middleware only for explicitly scoped manager operations',()=>{
  const gate=api.slice(api.indexOf('/* P0: HCOT least-privilege authorization.'),api.indexOf('/* Schema/bootstrap writes'))
  assert.match(gate,/path === '\/hcot\/line-manager\/my-staff'/)
  assert.match(gate,/path === '\/hcot\/line-manager\/assessment-requests'/)
  assert.match(gate,/path === '\/hcot\/competency-assessments'/)
  assert.match(gate,/method === 'POST' && path === '\/hcot\/competency-assessments'/)
  assert.match(gate,/if \(supervisorScoped\) return next\(\)/)
  assert.doesNotMatch(gate,/supervisorScoped.*path\.startsWith/s)
})
test('manager endpoints require verified identity and mapped staff on both read and write',()=>{
  const manager=api.slice(api.indexOf('async function requireAssessmentManager'),api.indexOf("api.get('/hcot/line-manager/my-staff'"))
  assert.match(manager,/verifyAccessJwt/)
  assert.match(manager,/hcot_line_manager_assignments/)
  const post=api.slice(api.indexOf("api.post('/hcot/competency-assessments'"),api.indexOf("api.post('/hcot/competency-assessments'")+1600)
  assert.match(post,/requireAssessmentManager/)
  assert.match(post,/isAssignedToManager/)
})
test('supervisor gateway remains the only non-admin navigation route',()=>{
  assert.match(ui,/state\.hcotRole!=='admin' && view!=='supervisors'/)
  assert.match(ui,/link\.dataset\.view!=='supervisors'/)
  assert.match(ui,/renderSupervisorGateway/)
})
