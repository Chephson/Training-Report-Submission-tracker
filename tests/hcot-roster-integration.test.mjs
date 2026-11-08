import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')

test('HCOT participant writes validate all roster IDs before insert', () => {
  const start = api.indexOf("api.post('/hcot/plans/:id/participants'")
  const end = api.indexOf("/* HCOT catalogue", start)
  assert.ok(start >= 0 && end > start)
  const route = api.slice(start, end)
  assert.match(route, /Number\.isSafeInteger\(value\)/)
  assert.match(route, /new Set\(ids\)\.size!==ids\.length/)
  assert.match(route, /SELECT id,active FROM staff WHERE id=\?/)
  assert.match(route, /Number\(staff\.active\)!==1/)
  assert.match(route, /SELECT 1 AS found FROM hcot_participants/)
  assert.ok(route.indexOf('for(const staffId of ids){') < route.indexOf('let added=0'))
  assert.match(route, /INSERT OR IGNORE INTO hcot_participants/)
  assert.match(route, /WHERE id=\? AND active=1/)
})

test('HCOT participant UI excludes inactive roster records and displays history', () => {
  assert.match(client, /Search central Staff Roster/)
  assert.match(client, /Number\(x\.active\)!==1/)
  assert.match(client, /\(Inactive\)/)
  assert.match(client, /\(Already assigned\)/)
  assert.match(client, /esc\(x\.team\|\|'No team'\)/)
})

test('HCOT identity mapping uses roster selection without write or approval', () => {
  assert.match(client, /id="hcot-map-search"/)
  assert.match(client, /<select id="hcot-map-staff"/)
  assert.match(client, /mappingRoster\.filter\(st=>Number\(st\.active\)===1/)
  assert.match(client, /\/hcot\/mapping-validate/)
  assert.doesNotMatch(client, /\/hcot\/mapping-approve['"]/)
})

test('HCOT Cloudflare Access and named admin gates remain in place', () => {
  assert.match(api, /api\.use\('\/hcot\/\*'/)
  assert.match(api, /verifyAccessJwt\(c\.req\.raw, c\.env\)/)
  assert.match(api, /HCOT_SETTINGS_ADMIN_EMAILS/)
  assert.match(api, /isHcotViewerRead\(method, path\)/)
})
