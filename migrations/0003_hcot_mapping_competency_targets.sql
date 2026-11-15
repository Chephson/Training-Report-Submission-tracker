-- Preview-only migration. Apply only to report-tracker-hcot-preview after validation.
-- Mapping-level targets are independent of performance goals and assessment cycles.
CREATE TABLE IF NOT EXISTS hcot_mapping_competency_targets (
  cadre_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  competency_id INTEGER NOT NULL DEFAULT 0,
  division TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  target_level TEXT NOT NULL CHECK(target_level IN ('Basic','Intermediate','Advanced','Expert')),
  target_score INTEGER NOT NULL CHECK(
    (target_level='Basic' AND target_score=64) OR
    (target_level='Intermediate' AND target_score=74) OR
    (target_level='Advanced' AND target_score=84) OR
    (target_level='Expert' AND target_score=100)
  ),
  set_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(cadre_id,group_id,competency_id,division,department,unit)
);
CREATE INDEX IF NOT EXISTS idx_hcot_mapping_targets_cadre ON hcot_mapping_competency_targets(cadre_id,group_id,competency_id);
