-- Preview-only schema upgrade. Preserve existing group IDs and membership records.
PRAGMA defer_foreign_keys=ON;
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
 SELECT group_id,competency_id FROM hcot_group_competencies;
DROP TABLE hcot_group_competencies;
ALTER TABLE hcot_group_competencies_new RENAME TO hcot_group_competencies;
