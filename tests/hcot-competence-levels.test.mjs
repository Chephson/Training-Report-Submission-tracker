import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../public/static/app.js',import.meta.url),'utf8')
const start=source.indexOf('function competenceLevel(value){')
const end=source.indexOf('function competenceScore(value)',start)
assert.ok(start>=0&&end>start)
const level=vm.runInNewContext(source.slice(start,end)+';competenceLevel')
test('competency qualitative levels cover all thresholds',()=>{
  const cases=[[0,'No Competence'],[49,'No Competence'],[50,'Basic'],[64,'Basic'],[65,'Intermediate'],[74,'Intermediate'],[75,'Advanced'],[84,'Advanced'],[85,'Expert'],[100,'Expert']]
  for(const [score,expected] of cases)assert.equal(level(score),expected)
  assert.equal(level(-1),'Not rated')
  assert.equal(level(101),'Not rated')
})
test('supervisor and admin assessment views show numeric scores and levels',()=>{
  assert.match(source,/competenceScore\(x\.score\)/)
  assert.match(source,/competenceScore\(x\.target_score\)/)
  assert.match(source,/competenceLevel\(g\.average_score\)/)
  assert.match(source,/hca-target-level/)
  assert.match(source,/hca-score-level/)
  assert.match(source,/Assessment recorded:.*competenceLevel\(score\)/)
})
