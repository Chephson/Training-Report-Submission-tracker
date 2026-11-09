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
