import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
function route(method, path) {
  const start = api.indexOf("api." + method + "('" + path + "'")
  assert.notEqual(start, -1, 'Expected route ' + method + ' ' + path)
  const next = api.indexOf('\napi.', start + 4)
  return api.slice(start, next === -1 ? undefined : next)
}

test('handshake preview reads period-scoped assignments and does not write', () => {
  const body = route('get', '/hcot/handshake-preview')
  assert.match(body, /programme_assignments WHERE period_id=\?/)
  assert.match(body, /previewHandshake\(/)
  assert.doesNotMatch(body, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i)
  assert.doesNotMatch(body, /\.run\s*\(/)
})

test('approval route remains fail-closed and performs no writes', () => {
  const body = route('post', '/hcot/mapping-approve')
  assert.match(body, /403/)
  assert.doesNotMatch(body, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i)
  assert.doesNotMatch(body, /\.run\s*\(/)
})

test('mapping security response keeps approvals and automatic sync disabled', () => {
  const body = route('get', '/hcot/mapping-security')
  assert.match(body, /approval_enabled:false/)
  assert.match(body, /request_submission_enabled:false/)
  assert.match(body, /automatic_sync_enabled:false/)
})

test('mapping readiness cannot declare automatic sync ready', () => {
  const body = route('get', '/hcot/mapping-readiness')
  assert.match(body, /ready_for_automatic_sync:false/)
})
