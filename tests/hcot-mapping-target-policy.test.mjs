import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=fs.readFileSync(new URL('../src/api.ts',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../public/static/app.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/0003_hcot_mapping_competency_targets.sql',import.meta.url),'utf8');
test('admin mapping policy restricts levels to fixed highest scores',()=>{
 for(const [level,score] of Object.entries({Basic:64,Intermediate:74,Advanced:84,Expert:100})){
  assert.match(api,new RegExp(level+':'+score));
  assert.match(migration,new RegExp("target_level='"+level+"' AND target_score="+score));
 }
 assert.match(api,/isHcotCompetencyAdmin\(c,session\.email\)/);
});
test('mapping-level policy has group rows and individual overrides scoped by cadre',()=>{
 assert.match(migration,/PRIMARY KEY\(cadre_id,group_id,competency_id,division,department,unit\)/);
 assert.match(api,/t\.competency_id=0 OR t\.competency_id=\?/);
 assert.match(api,/CASE WHEN t\.competency_id=\? THEN 1 ELSE 0 END DESC/);
});
test('bulk target API has validation preview, transaction and audit',()=>{
 assert.match(api,/api\.post\('\/hcot\/mapping-targets\/bulk'/);
 assert.match(api,/Target import rejected; no rows applied/);
 assert.match(api,/if\(body\.commit!==true\)/);
 assert.match(api,/await c\.env\.DB\.batch\(planned\.map/);
 assert.match(api,/hcot\.mapping_targets\.updated/);
});
test('Goals and assessments show inherited targets with no editable target control',()=>{
 assert.match(api,/inherited_targets:inheritedTargets/);
 assert.match(client,/inheritedGoalsTargets/);
 assert.match(client,/inheritedTargetMap/);
 assert.doesNotMatch(client,/data-admin-and-mutable-target/);
});
test('group scores average distinct most recent assessments, preserving snapshot targets',()=>{
 assert.match(api,/const latestByCycle=new Map/);
 assert.match(api,/if\(!entries\.has\(a\.competency_id\)\)/);
 assert.match(api,/Math\.round\(sum\/values\.length\*100\)\/100/);
 assert.match(api,/VALUES\(\?,\?,\?,\?,\?,\?,\?\)/);
});
