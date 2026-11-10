import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync('src/api.ts','utf8'),db=readFileSync('src/lib/db.ts','utf8'),ui=readFileSync('public/static/app.js','utf8');
test('assessments persist 0–100 scores with history and target',()=>{assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_competency_assessments/);assert.match(db,/CHECK\(score BETWEEN 0 AND 100\)/);assert.match(db,/target_score INTEGER NOT NULL DEFAULT 70/)});
test('assessments enforce HCOT admin and live cadre eligibility',()=>{assert.match(api,/api.post\('\/hcot\/competency-assessments'/);assert.match(api,/isHcotCompetencyAdmin\(c,session.email\)/);assert.match(api,/Competency is not currently mapped/);assert.match(api,/JOIN hcot_cadre_competencies m ON m.cadre_id=s.cadre_id/)});
test('assessment UI supports per competency score and history',()=>{assert.match(ui,/data-section="assessments"/);assert.match(ui,/hca-score/);assert.match(ui,/Assessment history/)});

test('assessment eligibility includes direct and inherited mappings without duplicates',()=>{
  const section=api.slice(api.indexOf("api.get('/hcot/competency-assessments'"),api.indexOf("api.get('/hcot/effective-competencies'"));
  assert.match(section,/FROM hcot_staff_competencies d/);
  assert.match(section,/FROM staff s JOIN hcot_cadre_competencies m/);
  assert.match(section,/GROUP BY p.id,p.name,p.category/);
  assert.match(section,/MAX\(z.inherited\) AS inherited,MAX\(z.direct\) AS direct/);
  assert.match(section,/EXISTS\(SELECT 1 FROM hcot_staff_competencies d/);
});

test('cadre selectors show names rather than numeric database IDs',()=>{
  assert.match(ui,/for\(const id of \['hcot-cadre-assign','hcot-rule-cadre'\]\)/);
  assert.match(ui,/o\.textContent=cadre\.name/);
});

test('staff roster offers downloadable CSV bulk import template',()=>{
  assert.match(ui,/id="r-template"/);
  assert.match(ui,/hcot-staff-roster-bulk-template\.csv/);
  assert.match(ui,/full_name,email,division,department,unit/);
  assert.match(ui,/URL\.createObjectURL\(blob\)/);
});

test('roster bulk template includes cadre and import resolves existing active cadre names',()=>{
 assert.match(ui,/full_name,email,division,department,unit,cadre/);
 assert.match(api,/const cCadre = find\('cadre'\)/);
 assert.match(api,/SELECT id FROM hcot_cadres WHERE LOWER\(TRIM\(name\)\)=LOWER\(TRIM\(\?\)\) AND active=1/);
 assert.match(api,/INSERT INTO staff \(full_name, email, team, role, unit, cadre_id, active\)/);
 assert.match(api,/cadre_id = CASE WHEN \? = 1 THEN excluded.cadre_id ELSE staff.cadre_id END/);
});

test('competency group hierarchy and assessment group-first workflow',()=>{
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_competency_groups/);
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_group_competencies/);
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_cadre_groups/);
 assert.match(api,/api.post\('\/hcot\/competency-groups\/assign-cadre'/);
 assert.match(api,/api.post\('\/hcot\/competency-groups\/assign-competency'/);
 assert.match(ui,/id="hca-group"/);
 assert.match(ui,/hca-group-items/);
 assert.match(ui,/hcg-link-cadre/);
});

test('cadre group mapping supports optional organisational scopes without losing global links',()=>{
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_cadre_group_scopes/)
 assert.match(db,/idx_hcot_cadre_group_scope/)
 assert.match(api,/validateStaffDirectory\(c.env.DB,division,department,unit\)/)
 assert.match(api,/INSERT OR IGNORE INTO hcot_cadre_group_scopes/)
 assert.match(api,/FROM hcot_cadre_groups UNION ALL SELECT cadre_id,group_id,division,department,unit FROM hcot_cadre_group_scopes/)
 assert.match(ui,/hcg-scope-div/)
 assert.match(ui,/hcg-scope-dept/)
 assert.match(ui,/hcg-scope-unit/)
 assert.match(ui,/same\(x.division,data.staff.team\)/)
 assert.match(ui,/same\(x.department,data.staff.role\)/)
 assert.match(ui,/same\(x.unit,data.staff.unit\)/)
})

test('competency group CSV bulk upload is admin-gated and validates scoped mapping rows',()=>{
 assert.match(api,/api.post\('\/hcot\/competency-groups\/import'/)
 assert.match(api,/isHcotCompetencyAdmin\(c,session.email\)/)
 assert.match(api,/validateStaffDirectory\(c.env.DB,div\|\|null,dept\|\|null,unt\|\|null\)/)
 assert.match(api,/Conflicting group assignments/)
 assert.match(api,/INSERT OR IGNORE INTO hcot_cadre_group_scopes/)
 assert.match(ui,/id="hcg-upload-file"/)
 assert.match(ui,/hcot-competency-group-mapping-template\.csv/)
 assert.match(ui,/competency_group,group_description,competency_name,competency_category,cadre,division,department,unit/)
})

test('bulk upload validates competency category and prevents duplicate competency groups',()=>{
 assert.match(ui,/competency_group,group_description,competency_name,competency_category,cadre,division,department,unit/)
 assert.match(api,/competency category must be Core or Functional/)
 assert.match(api,/must match its existing classification/)
 assert.match(api,/WHERE LOWER\(TRIM\(name\)\)=LOWER\(TRIM\(\?\)\)/)
 assert.match(api,/A competency group with this name already exists/)
 assert.match(api,/INSERT INTO hcot_competency_groups\(name,description\) SELECT/)
})

test('group-scoped competency inheritance is enforced consistently for reading and saving assessments',()=>{
 const get=api.slice(api.indexOf("api.get('/hcot/competency-assessments'"),api.indexOf("api.get('/hcot/effective-competencies'"));
 const post=api.slice(api.indexOf("api.post('/hcot/competency-assessments'"),api.indexOf("api.post('/hcot/competency-assessments'")+3500);
 for(const section of [get,post]){
  assert.match(section,/hcot_group_competencies/);
  assert.match(section,/hcot_cadre_groups/);
  assert.match(section,/hcot_cadre_group_scopes/);
  assert.match(section,/LOWER\(TRIM\(gs\.division\)\)=LOWER\(TRIM\(COALESCE\(s\.team,''\)\)\)/);
  assert.match(section,/LOWER\(TRIM\(gs\.department\)\)=LOWER\(TRIM\(COALESCE\(s\.role,''\)\)\)/);
  assert.match(section,/LOWER\(TRIM\(gs\.unit\)\)=LOWER\(TRIM\(COALESCE\(s\.unit,''\)\)\)/);
 }
});
test('bulk import records the authenticated administrator and summary in the activity ledger',()=>{
 const section=api.slice(api.indexOf("api.post('/hcot/competency-groups/import'"),api.indexOf("api.get('/hcot/competency-assessments'"));
 assert.match(section,/await log\(c\.env\.DB,'hcot_competency_groups_import'/);
 assert.match(section,/session\.email/);
 assert.match(section,/scope_mappings:/);
 assert.match(section,/global_mappings:/);
});

test('cadre rename and deletion require HCOT administrator and preserve referential integrity',()=>{
 const rename=api.slice(api.indexOf("api.patch('/hcot/cadres/:id'"),api.indexOf("api.delete('/hcot/cadres/:id'"));
 const remove=api.slice(api.indexOf("api.delete('/hcot/cadres/:id'"),api.indexOf("api.patch('/hcot/staff/:id/cadre'"));
 for(const route of [rename,remove])assert.match(route,/isHcotCompetencyAdmin\(c,session.email\)/);
 assert.match(rename,/UPDATE hcot_cadres SET name=/);
 assert.match(rename,/Another cadre already has this name/);
 assert.match(remove,/FROM staff WHERE cadre_id=/);
 assert.match(remove,/FROM hcot_cadre_competencies WHERE cadre_id=/);
 assert.match(remove,/FROM hcot_cadre_groups WHERE cadre_id=/);
 assert.match(remove,/FROM hcot_cadre_group_scopes WHERE cadre_id=/);
 assert.match(remove,/Cadre is in use/);
 assert.match(rename,/hcot.cadre.renamed/);
 assert.match(remove,/hcot.cadre.deleted/);
 assert.match(ui,/id="hcot-cadre-manage"/);
 assert.match(ui,/id="hcot-cadre-update"/);
 assert.match(ui,/id="hcot-cadre-delete"/);
});

test('cadre management and assignment selectors display names, not numeric identifiers',()=>{
 assert.match(ui,/cadres\.map\(x=>'<option value="/);
 assert.match(ui,/cadres\.filter\(x=>x\.active\)\.map\(x=>'<option value="/);
 assert.doesNotMatch(ui,/options\(cadres\.map\(x=>String\(x\.id\)\),'Select cadre'\)/);
 assert.doesNotMatch(ui,/options\(cadres\.filter\(x=>x\.active\)\.map\(x=>String\(x\.id\)\)/);
});
