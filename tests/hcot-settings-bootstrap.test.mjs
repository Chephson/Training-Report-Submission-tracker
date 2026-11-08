import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source-level regression guards. Full HTTP integration and build validation
// are still required before deployment.
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const settingsWrite = api.slice(api.indexOf("api.post('/settings'"), api.indexOf("/** Wipe the sample data"))
const settingsRead = api.slice(api.indexOf("api.get('/settings'"), api.indexOf("api.post('/settings'"))

test('settings writes require a verified Cloudflare Access administrator on HCOT Preview', () => {
  assert.match(settingsWrite, /HCOT_SETTINGS_ADMIN_EMAILS/)
  assert.match(settingsWrite, /verifyAccessJwt\(c\.req\.raw, c\.env\)/)
  assert.match(settingsWrite, /admins\.includes\(identity\.email\.trim\(\)\.toLowerCase\(\)\)/)
  assert.match(settingsWrite, /Settings administrator permission required/)
  assert.match(settingsWrite, /Preview settings administrators are not configured/)
})

test('settings read never returns the stored tracker access code verbatim', () => {
  assert.match(settingsRead, /r\.key === 'access_code'/)
  assert.match(settingsRead, /'configured'/)
  assert.doesNotMatch(settingsRead, /out\[r\.key\] = r\.value/)
})
