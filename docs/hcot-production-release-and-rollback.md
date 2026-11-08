# HCOT Staff Roster Integration — Controlled Production Release & Rollback

**Status: PREPARED ONLY — NOT APPROVED, NOT DEPLOYED.**

## Acceptance and baseline
- Preview acceptance: 6/6 passed (staff search, active assignment, inactive restriction, duplicate prevention, identity mapping, historical records).
- CI integration and read-only Production preflight passed.
- Production D1: `report-tracker` (ID `b8e12cd1-56e0-4460-a570-15b58fc4219c`).
- Preview D1: `report-tracker-hcot-preview` (ID `26b2a079-accf-4d05-bf1c-c1e8ca523e1e`).
- Production baseline (2026-11-08): staff 3; programmes 4; programme_assignments 11; submissions 8; hcot_training_plans 0; hcot_participants 0.
- Production Time Travel restore window was visible in Cloudflare on 2026-11-08. **This does not confirm a saved bookmark or guarantee that the old window remains valid at release time.**
- Production baseline commit at PR creation: `a732412adc3598839b0b298552b3289ce5d31560`. Reconfirm actual live Production deployment ID and code before release.

## Before authorization
1. Record exact approved release SHA and compare PR #8 diff against current `main`; confirm CI is green at that SHA. No unreviewed workflow-only changes should be included inadvertently.
2. Confirm GitHub `cloudflare-production` environment has **required reviewers** and only designated operators can approve it. Workflow input phrase is **not** independent authorization.
3. Immediately before deployment, create a **fresh Production D1 Time Travel bookmark** using Cloudflare's supported D1 tooling; retain bookmark and creation timestamp privately. Verify it is within the current restoration window. Do not click Restore.
4. Record current Production Pages deployment ID/URL and its rollback availability; ensure Cloudflare Access is enabled for the exact Production hostname.
5. Rerun the read-only six-count baseline query on **Production** and record results. If changed since 2026-11-08, update the baseline rather than treating changes as data loss.
6. Confirm production D1 binding matches `b8e12cd1-56e0-4460-a570-15b58fc4219c`, Preview binding matches `26b2a079-accf-4d05-bf1c-c1e8ca523e1e`, and Production branch remains `main`.
7. Obtain explicit user approval to merge/deploy; keep PR #8 draft until then. The new manual workflow on feature branch is not necessarily discoverable under GitHub Actions until registered on default branch. **Do not enable automatic Production deployment.**

## Authorized deployment (future only)
1. After explicit approval, review and merge only the approved code into `main`; confirm the exact release SHA to be deployed.
2. Ensure the manual-only controlled workflow is available on `main` and GitHub environment reviewer protection is active. Avoid the older less-guarded `cloudflare-pages.yml` workflow.
3. Dispatch `HCOT controlled Production release (manual approval required)` with the exact approved SHA, required approval phrase, and current recovery bookmark. GitHub environment reviewer must independently approve.
4. Workflow validates SHA ancestry, Cloudflare production branch, both D1 bindings, build/tests, then deploys Pages assets to `main`. It performs **no D1 migrations or writes**.
5. Immediately verify Production Cloudflare Access, dashboard, Staff Roster, Programme Assignments, Outstanding Reports, HCOT role restrictions, active/inactive staff selection, duplicate rejection, identity mapping and historical data.
6. Re-run baseline counts; expected unchanged absent legitimate concurrent user activity or explicitly authorized writes.

## Rollback and recovery
- **Application-only failure:** First stop further releases and roll back to the recorded last-known-good **Cloudflare Pages Production deployment** using Cloudflare deployment rollback controls; verify functionality and Access. Pages rollback does not automatically roll back D1.
- **Database corruption or unintended writes:** Stop writes and escalate. Review changes since recovery bookmark. D1 Time Travel restore **overwrites the current database** and may discard legitimate post-bookmark data. Require a separate explicit recovery decision, verify the bookmark and restoration window, and preserve/export current data if feasible before any restore.
- After rollback/recovery, recheck all six baseline categories and authentication. Document incident, restore decision, and outcome.

## Release decision
- Functional acceptance: PASS
- CI / read-only preflight: PASS
- Baseline: CAPTURED, refresh at release
- Recovery bookmark: PENDING fresh capture
- Production environment reviewer gate: PENDING verification
- Explicit Production approval: NOT GRANTED
- Deployment: NOT STARTED
