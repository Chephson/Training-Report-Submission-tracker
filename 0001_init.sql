-- Training Report Tracker — initial schema
-- A "period" is one reporting cycle (e.g. "Term 1 2026 · Induction Training").
-- Each period has its own Microsoft Form link and its own webhook token,
-- so several forms / cycles can feed the same roster.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periods (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  form_url       TEXT,
  due_date       TEXT,
  status         TEXT NOT NULL DEFAULT 'open',   -- open | closed
  webhook_token  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name  TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  team       TEXT,
  role       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per staff member per period (first report received).
CREATE TABLE IF NOT EXISTS submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id         INTEGER NOT NULL,
  period_id        INTEGER NOT NULL,
  source           TEXT NOT NULL DEFAULT 'form',  -- form | csv | xlsx | manual
  form_response_id TEXT,
  matched_by       TEXT,                          -- email | name | manual
  submitted_email  TEXT,
  submitted_at     TEXT NOT NULL,
  notes            TEXT,
  raw_json         TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_id, staff_id),
  FOREIGN KEY (staff_id)  REFERENCES staff(id)  ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submissions_period ON submissions(period_id);
CREATE INDEX IF NOT EXISTS idx_submissions_staff  ON submissions(staff_id);

-- Responses that arrived but could not be matched to anyone on the roster.
CREATE TABLE IF NOT EXISTS unmatched (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id     INTEGER,
  email         TEXT,
  full_name     TEXT,
  submitted_at  TEXT,
  reason        TEXT,
  payload       TEXT,
  source        TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event  TEXT NOT NULL,
  detail TEXT,
  actor  TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts DESC);
