CREATE TABLE IF NOT EXISTS hcot_competency_targets (
  staff_id INTEGER NOT NULL,
  competency_id INTEGER NOT NULL,
  cycle TEXT NOT NULL,
  target_score INTEGER NOT NULL CHECK(target_score BETWEEN 0 AND 100),
  set_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id,competency_id,cycle)
);
