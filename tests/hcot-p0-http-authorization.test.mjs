import test from 'node:test'
import assert from 'node:assert/strict'
import api from '../src/api.ts'

const domain = 'test-team.cloudflareaccess.com'
const baseEnv = { HCOT_ACCESS_TEAM_DOMAIN: domain, HCOT_ACCESS_AUD: 'security-test-aud',
  HCOT_SETTINGS_ADMIN_EMAILS: 'admin@example.invalid' }
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const originalFetch = globalThis.fetch

async function signedFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const publicKey = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'p0-key', alg: 'RS256' }
  const sign = async email => {
    const now = Math.floor(Date.now() / 1000)
    const data = b64({ alg: 'RS256', kid: 'p0-key' }) + '.' +
      b64({ iss: 'https://' + domain, aud: ['security-test-aud'], sub: email,
        email, iat: now - 10, exp: now + 1800 })
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Buffer.from(data))
    return data + '.' + Buffer.from(sig).toString('base64url')
  }
  return { publicKey, sign }
}

function fakeDb(accessCode = 'test-shared-code') {
  const queries = []
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) { this.args = args; return this },
        async first() {
          queries.push({ sql, args: this.args, op: 'first' })
          if (sql.includes("key = 'seeded'")) return { value: '1' }
          if (sql.includes('SELECT * FROM periods WHERE webhook_token = ?')) return { id: 1, webhook_token: 'test-webhook-token' }
          if (sql.includes('SELECT COUNT(*) AS n FROM periods')) return { n: 1 }
          if (sql.includes('PRAGMA table_info(submissions)'))
            return null
          if (sql.includes("key = ?") && this.args?.[0] === 'access_code') return accessCode ? { value: accessCode } : null
          if (sql.includes("SELECT sql FROM sqlite_master")) return { sql: 'CREATE TABLE submissions (id INTEGER)' }
          return null
        },
        async all() {
          queries.push({ sql, args: this.args, op: 'all' })
          if (sql.includes('PRAGMA table_info(submissions)'))
            return { results: ['training_programme', 'training_start_date', 'duration_days'].map(name => ({ name })) }
          return { results: [] }
        },
        async run() {
          queries.push({ sql, args: this.args, op: 'run' })
          return { meta: { changes: 1, last_row_id: 7 } }
        },
      }
      return statement
    },
  }
  return { db, queries }
}
const protectedWrites = [
  ['POST', '/hcot/plans', { title: 'Synthetic plan' }],
  ['PATCH', '/hcot/plans/1', { title: 'Synthetic plan' }],
  ['POST', '/hcot/plans/1/participants', { staff_ids: [1] }],
  ['POST', '/hcot/competencies', { name: 'Synthetic competency' }],
  ['POST', '/hcot/goals', { title: 'Synthetic goal' }],
  ['POST', '/hcot/mapping-validate', { hcot_staff_number: 'T123', tracker_staff_id: 1 }],
]
const sensitiveReads = [
  '/hcot/plans/1/participants', '/hcot/reviews?plan_id=1', '/hcot/cost-estimates',
  '/hcot/goals', '/hcot/mapping-requests', '/hcot/handshake-preview?period=1',
  '/hcot/plans', '/hcot/competencies', '/hcot/calendar', '/hcot/identity-audit',
  '/hcot/mapping-readiness', '/hcot/mapping-exceptions', '/hcot/mapping-approval-status',
]
function call(db, env, method, path, token, body) {
  return api.request('https://example.invalid' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-access-code': 'test-shared-code',
      ...(token ? { 'cf-access-jwt-assertion': token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: db, ...env })
}
function hcotWrites(queries) {
  return queries.filter(q => q.op === 'run' &&
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+hcot_/i.test(q.sql))
}

test('runtime: missing Access JWT denies all HCOT writes before database access', async () => {
  const { db, queries } = fakeDb()
  for (const [method, path, body] of protectedWrites) {
    const response = await call(db, baseEnv, method, path, null, body)
    assert.equal(response.status, 401, path)
  }
  assert.equal(queries.length, 0)
})

test('runtime: verified viewer receives 403 for HCOT writes and sensitive reads; no HCOT mutations', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const token = await sign('viewer@example.invalid')
  const { db, queries } = fakeDb()
  for (const [method, path, body] of protectedWrites) {
    const response = await call(db, baseEnv, method, path, token, body)
    assert.equal(response.status, 403, method + ' ' + path)
  }
  for (const path of sensitiveReads) {
    const response = await call(db, baseEnv, 'GET', path, token)
    assert.equal(response.status, 403, 'GET ' + path)
  }
  assert.deepEqual(hcotWrites(queries), [])
})

test('runtime: denied HCOT viewer cannot trigger seeding, default periods or token rotation', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db, queries } = fakeDb()
  const response = await call(db, baseEnv, 'POST', '/hcot/plans',
    await sign('viewer@example.invalid'), { title: 'Rejected plan' })
  assert.equal(response.status, 403)
  const seedOrDefaultWrites = queries.filter(q => q.op === 'run' &&
    /\b(?:INSERT|UPDATE|DELETE)\b/i.test(q.sql) &&
    !/\b(?:CREATE|ALTER)\b/i.test(q.sql))
  assert.deepEqual(seedOrDefaultWrites, [])
})

test('runtime: invalid tracker code cannot run schema migration or seed writes', async () => {
  const { db, queries } = fakeDb()
  const response = await api.request('https://example.invalid/staff', {
    headers: { 'x-access-code': 'incorrect-code' },
  }, { DB: db })
  assert.equal(response.status, 401)
  assert.ok(queries.length > 0, 'authorization setting was checked')
  assert.ok(!queries.some(q => q.op === 'run'), 'unauthorized request must not write to D1')
})

test('runtime: unexpected database authorization errors fail closed before migrations', async () => {
  const queries = []
  const db = { prepare(sql) {
    queries.push(sql)
    return { bind() { return this }, async first() { throw new Error('D1 connection unavailable') } }
  } }
  const response = await api.request('https://example.invalid/staff', {}, { DB: db })
  assert.equal(response.status, 503)
  assert.ok(!queries.some(sql => /^CREATE|^ALTER|^INSERT|^UPDATE/i.test(sql)))
})

test('runtime: missing administrator allowlist fails closed with 503', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db } = fakeDb()
  const response = await call(db, { ...baseEnv, HCOT_SETTINGS_ADMIN_EMAILS: '' },
    'POST', '/hcot/plans', await sign('admin@example.invalid'), { title: 'No write' })
  assert.equal(response.status, 503)
})

test('runtime: verified administrator can create a synthetic HCOT plan', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db, queries } = fakeDb()
  const response = await call(db, baseEnv, 'POST', '/hcot/plans',
    await sign('admin@example.invalid'), { title: 'Synthetic plan' })
  assert.equal(response.status, 201)
  assert.ok(hcotWrites(queries).some(q => /INSERT INTO hcot_training_plans/.test(q.sql)))
})

test('runtime: Access session identifies allowlisted admin without enabling maker/checker', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db } = fakeDb()
  const admin = await call(db, baseEnv, 'GET', '/hcot/access-session', await sign('admin@example.invalid'))
  assert.equal(admin.status, 200)
  const adminSession = await admin.json()
  assert.equal(adminSession.role, 'admin')
  assert.equal(adminSession.maker_enabled, false)
  assert.equal(adminSession.checker_enabled, false)
  assert.equal(adminSession.mapping_approval_enabled, false)
  assert.equal(adminSession.automatic_sync_enabled, false)
  const viewer = await call(db, baseEnv, 'GET', '/hcot/access-session', await sign('viewer@example.invalid'))
  assert.equal(viewer.status, 200)
  assert.equal((await viewer.json()).role, 'viewer')
})

test('runtime: reset and mapping approval remain forbidden even with valid shared code', async () => {
  const { db, queries } = fakeDb()
  const response = await call(db, {}, 'POST', '/reset', null, { confirm: 'DELETE' })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'WORKSPACE_RESET_DISABLED')
  assert.ok(!queries.some(q => /DELETE FROM/.test(q.sql)))
})

test('runtime: verified administrator email is matched case-insensitively for writes and session role', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db, queries } = fakeDb()
  const token = await sign('ADMIN@EXAMPLE.INVALID')
  const create = await call(db, baseEnv, 'POST', '/hcot/plans', token, { title: 'Case normalization test' })
  assert.equal(create.status, 201)
  assert.ok(hcotWrites(queries).some(q => /INSERT INTO hcot_training_plans/.test(q.sql)))
  const session = await call(db, baseEnv, 'GET', '/hcot/access-session', token)
  assert.equal(session.status, 200)
  assert.equal((await session.json()).role, 'admin')
})

test('runtime: uppercase verified admin can update settings under HCOT Access', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db } = fakeDb()
  const response = await call(db, baseEnv, 'POST', '/settings',
    await sign('ADMIN@EXAMPLE.INVALID'), { org_name: 'Test organization' })
  assert.equal(response.status, 200)
})

test('runtime: Forms webhook rejects oversized batches before recording responses', async () => {
  const { db, queries } = fakeDb()
  const batch = Array.from({ length: 101 }, (_, i) => ({
    email: 'staff@example.invalid', trainingProgramme: 'Course ' + i,
  }))
  const response = await api.request('https://example.invalid/ingest/test-webhook-token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch),
  }, { DB: db })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).code, 'INGEST_BATCH_LIMIT')
  assert.ok(!queries.some(q => /INSERT INTO (?:submissions|unmatched)/i.test(q.sql)))
})

test('runtime: unconfigured HCOT Preview denies tracker reads and writes before schema mutations', async () => {
  const { db, queries } = fakeDb('')
  const read = await call(db, baseEnv, 'GET', '/staff', null)
  assert.equal(read.status, 403)
  assert.equal((await read.json()).code, 'TRACKER_SETUP_REQUIRED')
  const write = await call(db, baseEnv, 'POST', '/staff', null, { full_name: 'Unapproved' })
  assert.equal(write.status, 403)
  assert.equal((await write.json()).code, 'TRACKER_SETUP_REQUIRED')
  assert.ok(!queries.some(q => q.op === 'run'), 'bootstrap denial must precede database writes')
})

test('runtime: unconfigured HCOT Preview allows first settings setup only to verified admin', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db, queries } = fakeDb('')
  const viewer = await call(db, baseEnv, 'POST', '/settings',
    await sign('viewer@example.invalid'), { access_code: 'initial-code' })
  assert.equal(viewer.status, 403)
  assert.ok(!queries.some(q => q.op === 'run'))
  const admin = await call(db, baseEnv, 'POST', '/settings',
    await sign('admin@example.invalid'), { access_code: 'initial-code' })
  assert.equal(admin.status, 200)
  assert.ok(queries.some(q => q.op === 'run' && /INSERT|UPDATE/i.test(q.sql)))
})

test('runtime: Forms webhook rejects oversized payload before database access', async () => {
  const { db, queries } = fakeDb()
  const response = await api.request('https://example.invalid/ingest/test-webhook-token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'x'.repeat(256 * 1024) }),
  }, { DB: db })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).code, 'INGEST_PAYLOAD_LIMIT')
  assert.equal(queries.length, 0)
})

test('runtime: settings rejects empty access code without writes', async t => {
  const { sign, publicKey } = await signedFixture()
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  const { db, queries } = fakeDb()
  const response = await call(db, baseEnv, 'POST', '/settings',
    await sign('admin@example.invalid'), { access_code: '  ' })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'ACCESS_CODE_REQUIRED')
  assert.ok(!queries.some(q => q.op === 'run'))
})

test('runtime: Forms single response remains compatible with existing token', async () => {
  const { db } = fakeDb()
  const response = await api.request('https://example.invalid/ingest/test-webhook-token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.invalid', trainingProgramme: 'Cybersecurity' }),
  }, { DB: db })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.received, 1)
})
