import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyAccessJwt } from '../src/lib/hcot-access.ts'

const domain = 'example-team.cloudflareaccess.com'
const env = { HCOT_ACCESS_TEAM_DOMAIN: domain, HCOT_ACCESS_AUD: 'test-audience' }
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const claims = { iss: 'https://' + domain, aud: ['test-audience'], exp: now + 3600,
  iat: now - 30, sub: 'test-user', email: 'STAFF@example.invalid' }

async function fixture() {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const publicKey = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'test-key', alg: 'RS256' }
  const sign = async (payload = claims, header = { alg: 'RS256', kid: 'test-key' }) => {
    const signingInput = b64(header) + '.' + b64(payload)
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, Buffer.from(signingInput))
    return signingInput + '.' + Buffer.from(signature).toString('base64url')
  }
  return { sign, publicKey }
}
function request(token, transport = 'header') {
  return new Request('https://preview.example.invalid/api/hcot/plans', {
    headers: transport === 'cookie' ? { cookie: 'CF_Authorization=' + token } : { 'cf-access-jwt-assertion': token },
  })
}
test('rejects missing assertion and missing Access configuration', async () => {
  assert.equal(await verifyAccessJwt(new Request('https://preview.example.invalid/'), env), null)
  assert.equal(await verifyAccessJwt(request('a.b.c'), {}), null)
})
test('accepts valid signed header and cookie credentials, rejects altered signature', async t => {
  const { sign, publicKey } = await fixture()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    assert.equal(url, 'https://' + domain + '/cdn-cgi/access/certs')
    return new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const token = await sign()
  assert.deepEqual(await verifyAccessJwt(request(token), env), { email: 'staff@example.invalid', subject: 'test-user' })
  assert.deepEqual(await verifyAccessJwt(request(token, 'cookie'), env), { email: 'staff@example.invalid', subject: 'test-user' })
  const parts = token.split('.')
  const forged = parts[0] + '.' + b64({ ...claims, sub: 'other-user' }) + '.' + parts[2]
  assert.equal(await verifyAccessJwt(request(forged), env), null)
})
test('rejects expired, incorrect-audience and incorrect-issuer credentials', async t => {
  const { sign, publicKey } = await fixture()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 })
  t.after(() => { globalThis.fetch = originalFetch })
  for (const payload of [
    { ...claims, exp: now - 1 },
    { ...claims, aud: ['different-audience'] },
    { ...claims, iss: 'https://other.cloudflareaccess.com' },
    { ...claims, nbf: now + 3600 },
  ]) assert.equal(await verifyAccessJwt(request(await sign(payload)), env), null)
})
test('fails closed when JWKS cannot be retrieved', async t => {
  const { sign } = await fixture()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  t.after(() => { globalThis.fetch = originalFetch })
  assert.equal(await verifyAccessJwt(request(await sign()), env), null)
})
