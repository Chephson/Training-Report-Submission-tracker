-- Preview-only schema upgrade. Preserve existing group IDs and membership records.
-- Preserve all existing child rows before replacing the group table.
CREATE TABLE hcot_upgrade_cadre_groups AS SELECT * FROM hcot_cadre_groups;
CREATE TABLE hcot_upgrade_group_scopes AS SELECT * FROM hcot_cadre_group_scopes;
CREATE TABLE hcot_upgrade_group_competencies AS SELECT * FROM hcot_group_competencies;
DELETE FROM hcot_cadre_groups;
DELETE FROM hcot_cadre_group_scopes;
DELETE FROM hcot_group_competencies;
CREATE TABLE IF NOT EXISTS hcot_competency_groups_new (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 group_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
 description TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hcot_competency_groups_new(id,name,group_code,description,created_at)
 SELECT id,name,'LEGACY-'||id,description,created_at FROM hcot_competency_groups;
DROP TABLE hcot_competency_groups;
ALTER TABLE hcot_competency_groups_new RENAME TO hcot_competency_groups;
CREATE INDEX IF NOT EXISTS idx_hcot_group_name ON hcot_competency_groups(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS hcot_group_competencies_new (
 group_id INTEGER NOT NULL,
 competency_id INTEGER NOT NULL,
 PRIMARY KEY(group_id,competency_id),
 FOREIGN KEY(group_id) REFERENCES hcot_competency_groups(id),
 FOREIGN KEY(competency_id) REFERENCES hcot_competencies(id) ON DELETE CASCADE
);
INSERT INTO hcot_group_competencies_new(group_id,competency_id)
 SELECT group_id,competency_id FROM hcot_upgrade_group_competencies;
DROP TABLE hcot_group_competencies;
ALTER TABLE hcot_group_competencies_new RENAME TO hcot_group_competencies;

INSERT INTO hcot_cadre_groups SELECT * FROM hcot_upgrade_cadre_groups;
INSERT INTO hcot_cadre_group_scopes SELECT * FROM hcot_upgrade_group_scopes;
DROP TABLE hcot_upgrade_cadre_groups;
DROP TABLE hcot_upgrade_group_scopes;
DROP TABLE hcot_upgrade_group_competencies;
