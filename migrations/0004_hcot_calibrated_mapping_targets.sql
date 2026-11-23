-- Preview-only migration: replace fixed target-score CHECK with competence-band CHECK.
-- Existing rows, mapping keys, actors, and timestamps are preserved.
CREATE TABLE hcot_mapping_competency_targets_recalibrated (
  cadre_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  competency_id INTEGER NOT NULL DEFAULT 0,
  division TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  target_level TEXT NOT NULL CHECK(target_level IN ('Basic','Intermediate','Advanced','Expert')),
  target_score INTEGER NOT NULL CHECK(
    (target_level='Basic' AND target_score BETWEEN 50 AND 64) OR
    (target_level='Intermediate' AND target_score BETWEEN 65 AND 74) OR
    (target_level='Advanced' AND target_score BETWEEN 75 AND 84) OR
    (target_level='Expert' AND target_score BETWEEN 85 AND 100)
  ),
  set_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(cadre_id,group_id,competency_id,division,department,unit)
);
INSERT INTO hcot_mapping_competency_targets_recalibrated
(cadre_id,group_id,competency_id,division,department,unit,target_level,target_score,set_by,updated_at)
SELECT cadre_id,group_id,competency_id,division,department,unit,target_level,target_score,set_by,updated_at
FROM hcot_mapping_competency_targets;
DROP TABLE hcot_mapping_competency_targets;
ALTER TABLE hcot_mapping_competency_targets_recalibrated RENAME TO hcot_mapping_competency_targets;
CREATE INDEX IF NOT EXISTS idx_hcot_mapping_targets_cadre ON hcot_mapping_competency_targets(cadre_id,group_id,competency_id);
