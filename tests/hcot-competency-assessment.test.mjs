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
