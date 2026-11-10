import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync('src/api.ts','utf8'),db=readFileSync('src/lib/db.ts','utf8'),ui=readFileSync('public/static/app.js','utf8');
test('assessments persist 0–100 scores with history and target',()=>{assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_competency_assessments/);assert.match(db,/CHECK\(score BETWEEN 0 AND 100\)/);assert.match(db,/target_score INTEGER NOT NULL DEFAULT 70/)});
test('assessments require assigned non-admin line managers and live cadre eligibility',()=>{assert.match(api,/api.post\('\/hcot\/competency-assessments'/);assert.match(api,/requireAssessmentManager\(c\)/);assert.match(api,/isAssignedToManager\(c,staffId,manager.email!/);assert.match(api,/Competency is not currently mapped/);assert.match(api,/JOIN hcot_cadre_competencies m ON m.cadre_id=s.cadre_id/)});
test('assessment UI supports per competency score and history',()=>{assert.match(ui,/renderHCOTSection\('assessments'\)/);assert.match(ui,/hca-score/);assert.match(ui,/Assessment history/)});

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
 assert.match(api,/gs.division IS NULL/)
 assert.match(api,/gs.department IS NULL/)
 assert.match(api,/gs.unit IS NULL/)
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

test('preview roster reset requires admin, preview hostname, environment gates, backup and count confirmation',()=>{
 const route=api.slice(api.indexOf("api.post('/hcot/preview-roster-reset/execute'"),api.indexOf("api.get('/staff'"));
 assert.match(route,/isHcotCompetencyAdmin\(c,session.email\)/);
 assert.match(route,/HCOT_PREVIEW_ROSTER_RESET_ENABLED/);
 assert.match(route,/HCOT_PREVIEW_D1_DATABASE_ID/);
 assert.match(route,/RESET 21 PREVIEW TEST STAFF/);
 assert.match(route,/backup_verified/);
 assert.match(route,/export_verified/);
 assert.match(route,/current\?\.staff!==21/);
 assert.match(route,/DB\.batch\(statements\)/);
 for(const table of ['hcot_cost_estimates','hcot_reviews','hcot_participants','hcot_competency_assessments','hcot_staff_competencies','hcot_staff_links','hcot_mapping_requests','programme_assignments','submissions'])assert.ok(route.includes(table),table);
 assert.doesNotMatch(route,/DELETE FROM hcot_cadres/);
 assert.doesNotMatch(route,/DELETE FROM hcot_goals/);
});

test('staff CSV import reports rejected rows and does not silently succeed with zero imported',()=>{
 const section=api.slice(api.indexOf("api.post('/staff/import'"),api.indexOf("/* ---------------- progress / dashboard"));
 assert.match(section,/added === 0 && skipped > 0/);
 assert.match(section,/problems: problems.slice\(0, 25\)/);
 assert.match(section,/422/);
 assert.match(ui,/data\.problems\.slice\(0, 25\)/);
});


test('line manager mapping and assessment security',()=>{
 assert.match(db,/CREATE TABLE IF NOT EXISTS hcot_line_manager_assignments/);
 assert.match(api,/api.post\('\/hcot\/line-manager\/assignments\/import'/);
 assert.match(api,/api.post\('\/hcot\/line-manager\/assignments'/);
 assert.match(api,/api.get\('\/hcot\/line-manager\/my-staff'/);
 assert.doesNotMatch(api,/HCOT administrators cannot access competency assessments/);
 assert.match(api,/isAssignedToManager\(c,staffId,manager.email!/);
 assert.match(api,/Staff member is not assigned to this line manager/);
 assert.match(ui,/data-section="line-managers"/);
 assert.match(ui,/hcot-line-manager-mapping-template.csv/);
});

test('manual line-manager mapping selects an active Staff Roster employee without changing CSV import',()=>{
 assert.match(ui,/id="lm-manager"/);
 assert.match(ui,/staff\.map\(x=>'<option value="/);
 assert.match(ui,/manager_email:\$\('#lm-manager'\)\.value\.trim\(\)/);
 assert.doesNotMatch(ui,/id="lm-email"/);
 assert.match(ui,/staff_email,manager_email\\r\\n/);
 assert.match(ui,/hcot-line-manager-mapping-template\.csv/);
 assert.match(api,/api\.post\('\/hcot\/line-manager\/assignments\/import'/);
});

test('HCOT admins may assess only their roster-linked staff without changing CSV format',()=>{
 const guard=api.slice(api.indexOf('async function requireAssessmentManager'),api.indexOf('async function isAssignedToManager'));
 assert.match(guard,/verifyAccessJwt\(c.req.raw,c.env\)/);
 assert.match(guard,/hcot_line_manager_assignments/);
 assert.doesNotMatch(guard,/isHcotCompetencyAdmin/);
 const manual=api.slice(api.indexOf("api.post('/hcot/line-manager/assignments'"),api.indexOf("api.delete('/hcot/line-manager/assignments"));
 assert.doesNotMatch(manual,/HCOT administrators cannot be assigned as line managers/);
 const bulk=api.slice(api.indexOf("api.post('/hcot/line-manager/assignments/import'"),api.indexOf("api.get('/hcot/competency-assessments'"));
 assert.match(bulk,/staff_email,manager_email/);
 assert.doesNotMatch(bulk,/admins.includes\(email\)/);
 assert.match(ui,/data-section="assessments">My Staff Assessments/);
 assert.match(api,/Staff member is not assigned to this line manager/);
});

test('staff competency group lookup uses roster search and cadre scope without changing mappings',()=>{
 assert.match(ui,/id="hcg-staff-search"/);
 assert.match(ui,/id="hcg-staff-select"/);
 assert.match(ui,/id="hcg-staff-groups"/);
 assert.match(ui,/groupData\.cadres/);
 assert.match(ui,/sameScope\(x\.division,person\.division\)/);
 assert.match(ui,/sameScope\(x\.department,person\.department\)/);
 assert.match(ui,/sameScope\(x\.unit,person\.unit\)/);
 assert.match(ui,/const staffGroupLookup=isAdmin\?/);
});

test('assignee assessment dropdown loads real cadre-linked groups and selects first available group',()=>{
 const route=api.slice(api.indexOf("api.get('/hcot/competency-assessments'"),api.indexOf("api.post('/hcot/competency-assessments'"));
 assert.match(route,/isAssignedToManager\(c,staffId,manager.email!\)/);
 assert.match(route,/hcot_cadre_groups/);
 assert.match(route,/hcot_cadre_group_scopes/);
 assert.match(route,/groups:linkedGroups.results\|\|\[\]/);
 assert.match(ui,/const linkedGroups=data.groups\|\|\[\]/);
 assert.match(ui,/const linkedIds=new Set/);
 assert.match(ui,/visibleGroups.length\)\{\$\('#hca-group'\).value=visibleGroups\[0\].id/);
 assert.doesNotMatch(ui,/const groupData=\{cadres:\[\]\}/);
});

test('admin-only evaluations report and requests stay separate from manager-scoped assessments',()=>{
 const report=api.slice(api.indexOf("api.get('/hcot/evaluations/competency-report'"),api.indexOf("api.get('/hcot/competency-assessments'"));
 assert.match(report,/verifyAccessJwt\(c.req.raw,c.env\)/);
 assert.match(report,/isHcotCompetencyAdmin\(c,session.email\)/);
 assert.match(report,/hcot_competency_assessments/);
 assert.match(report,/hcot_line_manager_assignments/);
 assert.match(report,/hcot_assessment_requests/);
 assert.match(report,/byManager.has\(email\)/);
 assert.match(ui,/Competency assessment outcomes/);
 assert.match(ui,/Request line manager assessments/);
 assert.match(ui,/hcot\/line-manager\/assessment-requests/);
 assert.match(ui,/attempts to email selected managers when email delivery is configured/);
});

test('HCOT admin targets assigned staff and records email outcomes without exposing mail secrets',()=>{
 const block=api.slice(api.indexOf("api.get('/hcot/evaluations/manager-staff'"),api.indexOf("api.get('/hcot/line-manager/assessment-requests'"));
 assert.match(block,/isHcotCompetencyAdmin\(c,session.email\)/);
 assert.match(block,/staff_ids\?:number\[\]/);
 assert.match(block,/Selected staff must belong to the selected line managers/);
 assert.match(block,/hcot_assessment_request_staff/);
 assert.match(block,/HCOT_POWER_AUTOMATE_URL/);
 assert.match(block,/submitted_to_flow/);
 assert.match(block,/hcot_assessment_email_log/);
 assert.match(block,/email_status:status/);
 assert.match(ui,/id="hce-staff"/);
 assert.match(ui,/id="hce-managers"/);
 assert.match(ui,/const staff_ids=Array.from/);
 assert.match(ui,/email_status/);
});

test('Microsoft 365 flow URL remains server-side and is constrained to Microsoft HTTPS hosts',()=>{
 assert.match(api,/HCOT_POWER_AUTOMATE_URL\?: string/);
 assert.match(api,/url\.protocol!=='https:'/);
 assert.match(api,/hostname\.endsWith\('\.logic\.azure\.com'\)/);
 assert.match(api,/hostname\.endsWith\('\.api\.powerplatform\.com'\)/);
 assert.match(api,/request_id:requestId/);
 assert.match(api,/manager_email:email/);
 assert.match(api,/staff:selected\.map/);
 assert.match(api,/status='submitted_to_flow'/);
 assert.doesNotMatch(ui,/HCOT_POWER_AUTOMATE_URL/);
 assert.doesNotMatch(api,/api\.resend\.com\/emails/);
});
