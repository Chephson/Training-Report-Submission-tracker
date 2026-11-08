# HCOT controlled Preview acceptance checklist

Status: **Preparation only — no deployment authorization**.

## Hard safety gates
- Keep Production branch `main`; HCOT changes stay on `feature/hcot-unified-integration`.
- Keep Production and Preview automatic Git deployments disabled until explicitly reviewed.
- Do not change either D1 binding, enable mapping approvals, or enable automatic synchronization.
- Do not deploy or perform database writes until Cloudflare's **effective Preview DB binding** is independently confirmed to target the existing non-production database. The repository's `wrangler.jsonc` alone is not proof of effective Pages runtime bindings.
- Confirm the original Production application remains healthy. If a feature deployment is labeled Production, stop immediately.
- Never copy real HR records, tokens, access cookies or JWTs into GitHub logs, issues, or test fixtures.

## Gate A — repository validation
1. Confirm latest feature-branch GitHub Actions run is green (build, JavaScript syntax, multiple submissions, Forms ingestion, Access JWT, HCOT read-only reconciliation).
2. Record commit SHA and run URL.
3. Confirm `main` is unchanged and there is no pull-request merge.

## Gate B — Cloudflare routing and binding verification (read-only)
1. Confirm Cloudflare Pages Production branch is `main`.
2. Confirm Preview branch controls include `feature/hcot-unified-integration`.
3. Inspect the Preview environment's **effective** `DB` binding and database identity in Cloudflare dashboard or deployment metadata. Compare it with the Production environment; do not infer isolation from `env.preview` in `wrangler.jsonc`.
4. Confirm Preview Access application/policy protects the exact preview hostname and `/api/hcot/*`.
5. Record evidence without exposing secrets.
6. **Stop** if any binding or deployment classification is uncertain.

## Gate C — after a separately approved Preview-only deployment
**Read-only checks only until Gate B has been confirmed.**
1. Confirm deployment is labeled **Preview**, branch is `feature/hcot-unified-integration`, and SHA equals the approved commit.
2. Confirm Production still serves the original application.
3. Confirm unauthenticated HCOT requests are rejected and authorized Access sessions reach HCOT routes; do not disclose session tokens.
4. Confirm existing tracker navigation and read-only dashboards render without errors.
5. Check `GET /api/hcot/handshake-preview?period=<test-period-id>` using a designated synthetic period, and verify matched/new/ambiguous classifications.
6. Verify the preview does not change programme assignments or mapping approvals.

## Gate D — synthetic write acceptance (requires separate approval)
Only after verified non-production D1 isolation:
1. Create synthetic staff and two distinct synthetic programmes.
2. Submit two synthetic Forms reports for the same staff member in the same period; verify both appear.
3. Resubmit the same programme and verify no duplicate is created.
4. Verify programme-level pending/submitted counts and period-level unique-staff totals.
5. Test HCOT participant selection and read-only handshake; ensure no automatic assignment write.
6. Remove synthetic data using an approved cleanup process, without touching Production.

## Evidence / sign-off
Record: GitHub run, feature commit, Cloudflare Preview deployment ID, Preview hostname, confirmed effective Preview DB identity, Access protection, test outcomes, rollback owner, and authorization to continue. A successful GitHub workflow is **not** authorization to deploy or merge.
