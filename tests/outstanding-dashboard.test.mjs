import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const client = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8')
test('outstanding dashboard is linked and routed', () => {
  assert.ok(shell.includes('data-view="outstanding"'))
  assert.ok(client.includes("outstanding: { title: 'Outstanding reports'"))
  assert.ok(client.includes('async function renderOutstandingReports(el)'))
})
test('dashboard fetches read-only reporting and offers filters and export', () => {
  const start = client.indexOf('async function renderOutstandingReports(')
  const end = client.indexOf('async function renderProgrammes(',start)
  const view = client.slice(start,end)
  assert.ok(view.includes('/outstanding-programme-reports?period='))
  assert.ok(view.includes('out-search'))
  assert.ok(view.includes('out-programme'))
  assert.ok(view.includes('out-export'))
  assert.ok(view.includes('outstanding_programmes'))
  assert.ok(!view.includes("method:'POST'"))
})
