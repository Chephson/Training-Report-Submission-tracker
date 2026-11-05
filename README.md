# Training Report Tracker

Automated tracking of individual training report submissions, fed from a
Microsoft Form. Replaces the manual routine of reading the Forms response
sheet and hand-updating a separate list of who has submitted.

## The one thing to understand first

**A Microsoft Form's share link cannot be read by any app.** Forms responses are
private to your Microsoft 365 tenant — there is no public API and no
unauthenticated endpoint behind `forms.office.com/r/...`. So "the app feeds
directly from the form link" cannot be done by polling that link; it has to be a
**push** from inside Microsoft 365.

This app therefore exposes a **secure intake endpoint per reporting period**, and
a **Power Automate flow** (included in Microsoft 365) posts each new response to
it. Staff submits → the tracker updates within seconds. Fully automatic, no
manual step.

Two fallbacks exist for the same pipeline: **Forms export import** (`.xlsx` from
"Open in Excel", or `.csv`) and **manual marking** for exceptions.

## Features

- **Automatic ingest** — one secret endpoint per reporting period; accepts any
  reasonable JSON shape (Power Automate, Graph, Zapier, custom).
- **Duplicate-safe** — re-sending or re-importing never double-counts; the
  earliest genuine submission time is kept.
- **Smart roster matching** — exact email first, then name, tolerating titles
  (`Dr`, `Mrs`), accents, extra whitespace, and `Surname, Firstname` ordering.
- **Unmatched inbox** — nothing is ever silently dropped; unknown respondents
  wait to be linked to the right person.
- **Reporting periods** — separate records and intake addresses per cycle
  (e.g. "Term 1 2026"), each with its own deadline and open/closed state.
- **Dashboard** — completion rate, outstanding count, per-team breakdown,
  deadline status, recent submissions, activity log.
- **Tracker grid** — searchable/filterable by team and status.
- **Exports** — full tracker CSV and a "chase list" of only those outstanding.
- **Import wizard** — upload a Forms `.xlsx`/`.csv`, preview detected columns,
  confirm; reports recorded / duplicates / unmatched.
- **Optional access code** — a shared team gate for the whole tracker.

## How it works

```
Microsoft Form  ──(new response)──▶  Power Automate flow
                                          │  HTTP POST (JSON)
                                          ▼
                             /api/ingest/<period token>
                                          │
                            match against roster (D1)
                                          ▼
                     recorded ──▶ tracker / dashboard / exports
                            └────▶ unmatched inbox (if no match)
```

Alternative path: `Forms → Open in Excel → .xlsx upload → same matching code`.

## Public URLs

| Purpose | Path |
|---|---|
| App | `/` |
| Dashboard | `/#/dashboard` |
| Submission tracker | `/#/tracker` |
| Unmatched inbox | `/#/inbox` |
| Staff roster | `/#/roster` |
| Forms connection | `/#/setup` |
| Settings | `/#/settings` |

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/ingest/:token` | **Webhook.** Per-period secret intake. Accepts one object or an array. |
| `POST` | `/api/ingest-test/:periodId` | Dry-run: parses + matches, records nothing. |
| `POST` | `/api/import?period=` | Bulk import (`.xlsx` / `.csv`). Optional `email_col`/`name_col`/`time_col` overrides. |
| `POST` | `/api/import/preview` | Column detection + sample rows. |
| `GET` | `/api/overview?period=` | Dashboard stats, teams, recent, activity. |
| `GET` | `/api/progress?period=&q=&team=&status=` | Tracker rows. |
| `GET` | `/api/export.csv?period=` | Full period export. |
| `GET` | `/api/pending.csv?period=` | Chase list (outstanding only). |
| `GET/POST/PATCH/DELETE` | `/api/staff` | Roster CRUD. `POST /api/staff/import` bulk-loads. |
| `GET/POST/PATCH/DELETE` | `/api/periods` | Periods CRUD. `POST /api/periods/:id/rotate-token`. |
| `POST` | `/api/submissions/manual` | Mark someone submitted by hand. |
| `GET` | `/api/unmatched` | Unattributed responses. `POST /api/unmatched/:id/link`. |
| `POST` | `/api/settings` | Org name, access code. |
| `POST` | `/api/reset` | Wipe all data (requires `{"confirm":"DELETE"}`). |

### Webhook payload

Only `email` or `full_name` is required; everything else is optional.

```json
{
  "email": "amina.yusuf@example.org",
  "full_name": "Amina Yusuf",
  "submitted_at": "2026-11-04T09:15:00Z",
  "response_id": "abc-123"
}
```

The parser also finds these automatically inside nested bodies and differently
named fields (`responder`, `responderName`, `completionTime`, `createdDateTime`, …),
so Graph-style and Zapier-style payloads work unmodified.

## Data model

- **`staff`** — `full_name`, `email` (unique), `team`, `role`, `active`.
- **`periods`** — `name`, `form_url`, `due_date`, `status`, `webhook_token`.
- **`submissions`** — one row per staff per period; `source`
  (`form`/`csv`/`manual`), `matched_by` (`email`/`name`/`manual`), `submitted_at`.
  `UNIQUE(period_id, staff_id)` makes ingest idempotent.
- **`unmatched`** — responses that could not be attributed, with `resolved` flag.
- **`activity`** — audit trail of ingest, imports, manual marks, resets.
- **`settings`** — org name, access code, seed marker.

Storage: **Cloudflare D1** (SQLite) only. No KV, no cron — schema is created on
first request, so a fresh database needs no migration step.

## Setup for a real rollout

1. **Settings → Clear all sample data** (the install ships with 24 example staff).
2. **Roster** → import your staff list (needs `name` + `email` columns).
3. **Forms connection** → create your reporting period, copy the intake address.
4. **Power Automate** — following the 5 steps shown in the app:
   *When a new response is submitted* → *Get response details* → *HTTP POST* to
   the intake address with the JSON body shown.
5. Submit the form once yourself to confirm it appears.

## Notes and limits

- Reports are **not** stored here — only the fact that one was submitted, when,
  and by whom. The report contents stay in Microsoft Forms.
- Access code is a shared team gate, not per-user authentication. Per-person
  logins would require your organisation's identity provider.
- The intake token is a bearer credential: anyone holding it can post. Rotate it
  from the Forms connection page if it is ever exposed.

## Stack

Hono + TypeScript on Cloudflare Pages, D1 for storage, vanilla JS + CSS
frontend (no framework, ~60 kB worker). Excel parsing via `fflate` — a minimal
reader that handles shared strings, inline strings and date-formatted cells.

## Development

```bash
npm install
npm run build          # vite build -> dist/
pm2 start ecosystem.config.cjs   # wrangler pages dev on :3000
curl http://localhost:3000/api/session
```

## Deployment

- **Platform**: Cloudflare Pages + D1 (deployed to the user's own account)
- **Status**: Live


## Staff training history

The application includes a Staff Training History page accessible from the main navigation and from the History action on each staff roster row. It can filter submissions by staff member and submission year, displays the training programme, reporting period, training start date, duration, submission timestamp and source, and exports the filtered results to CSV.

Manual records can include the training start date and duration (days). The Microsoft Forms / Power Automate intake accepts optional `training_start_date` (or `trainingStartDate`) and `duration_days` (or `durationDays`) fields in addition to `training_programme`. Existing records are preserved; historical records without these optional values display a dash. The database schema adds these fields automatically when the application starts.
