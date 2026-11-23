import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('src/api.ts','utf8')
const db=readFileSync('src/lib/db.ts','utf8')
const ui=readFileSync('public/static/app.js','utf8')
const migration=readFileSync('migrations/0004_hcot_group_codes_multi_membership.sql','utf8')
const importer=api.slice(api.indexOf("api.post('/hcot/competency-groups/import'"),api.indexOf("api.post('/hcot/competency-groups/assign-competency'"))
test('admin only importer uses unique codes, creates competencies and preserves existing category',()=>{
 assert.match(importer,/isHcotCompetencyAdmin\(c,session.email\)/)
 for(const column of ['group_code','competency_description','competency_category','cadre','division','department','unit'])assert.ok(importer.includes(column),column)
 assert.match(importer,/INSERT INTO hcot_competencies\(name,category,description\)/)
 assert.match(importer,/must match existing library classification/)
 assert.match(importer,/INSERT OR IGNORE INTO hcot_group_competencies/)
 assert.match(importer,/await c.env.DB.batch\(statements\)/)
})
test('schema allows same-named groups but unique codes and many-to-many memberships',()=>{
 assert.match(db,/group_code TEXT NOT NULL UNIQUE COLLATE NOCASE/)
 assert.match(db,/PRIMARY KEY\(group_id,competency_id\)/)
 assert.doesNotMatch(db,/competency_id INTEGER NOT NULL UNIQUE/)
 assert.match(migration,/LEGACY-/)
 assert.match(migration,/hcot_upgrade_cadre_groups/)
 assert.match(migration,/hcot_upgrade_group_scopes/)
 assert.match(migration,/hcot_upgrade_group_competencies/)
})
test('CSV template and group selectors expose unique group code',()=>{
 assert.match(ui,/group_code,competency_group,group_description,competency_name,competency_category,competency_description,cadre,division,department,unit/)
 assert.match(ui,/hcg-code/)
 assert.match(ui,/group_code:.*hcg-code/)
})
