import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const guard = api.slice(api.indexOf('/* P0: HCOT least-privilege'), api.indexOf('/* ---------------- periods'))
const routes = [
  ['/hcot/plans', 'POST'], ['/hcot/plans/:id', 'PATCH'],
  ['/hcot/plans/:id/participants', 'POST'], ['/hcot/competencies', 'POST'],
  ['/hcot/goals', 'POST'], ['/hcot/mapping-validate', 'POST'],
]
test('HCOT write authorization is enforced by a server-side Access identity and administrator allowlist', () => {
  assert.match(guard, /api\.use\('\/hcot\/\*'/)
  assert.match(guard, /verifyAccessJwt\(c\.req\.raw, c\.env\)/)
  assert.match(guard, /HCOT_SETTINGS_ADMIN_EMAILS/)
  assert.match(guard, /admins\.includes\(identity\.email\.trim\(\)\.toLowerCase\(\)\)/)
  assert.match(guard, /permission required\.' }, 403/)
  assert.match(guard, /not configured\.' }, 503/)
  for (const [path, method] of routes) {
    assert.ok(api.includes("api." + method.toLowerCase() + "('" + path + "'"), path + ' exists')
  }
  assert.match(guard, /method === 'POST'/)
  assert.match(guard, /method === 'PATCH'/)
  assert.match(guard, /mapping-validate/)
})
test('sensitive HCOT reads require administrator permission', () => {
  for (const path of ['participants', 'reviews', 'cost-estimates', 'goals', 'mapping-requests', 'handshake-preview'])
    assert.ok(guard.includes(path), path + ' is protected')
  assert.match(guard, /method === 'GET'/)
})
test('destructive reset is disabled with no delete statements in route', () => {
  const block = api.slice(api.indexOf("api.post('/reset'"), api.indexOf("api.get('/demo-status'"))
  assert.match(block, /WORKSPACE_RESET_DISABLED/)
  assert.match(block, /403/)
  assert.doesNotMatch(block, /DELETE FROM|\.run\(/)
})
test('mapping approval and automatic synchronization remain disabled', () => {
  const approval = api.slice(api.indexOf("api.post('/hcot/mapping-approve'"), api.indexOf("api.get('/hcot/handshake-preview'"))
  assert.match(approval, /403/)
  assert.match(api, /automatic_sync_enabled:false/)
  assert.match(api, /request_submission_enabled:false/)
})
