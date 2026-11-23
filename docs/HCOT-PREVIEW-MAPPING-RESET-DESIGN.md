# HCOT Preview — Staff Mapping Reset and Cadre Deletion

Status: design and source reconciliation; NOT DEPLOYED.

## Scope
- HCOT administrators only; verify Cloudflare Access identity and server-side admin allowlist for every mutation.
- Preview database only. Never run reset against production D1.
- Preserve staff roster, training submissions, completed assessments, historical training plans, and audit logs.
- Reset current staff cadre assignments and direct competency mappings; include competency-group, supervisor, goal, and target mappings only after inspecting the deployed schema and confirming whether each is an active assignment or historical record.
- Deleting a cadre must first detach current staff assignments and cadre-to-competency rules while retaining historical references via snapshot or tombstone, not cascade-delete history.

## Preconditions
1. Identify the exact commit currently deployed to Preview, including any post-branch changes.
2. Obtain a Preview D1 backup / Time Travel recovery point and validate restore procedure.
3. Inspect PRAGMA table_info, foreign_key_list, and dependent tables/indexes on the Preview schema.
4. Document preflight counts and explicit list of tables/columns to change.
5. Require typed confirmation, admin authorization, and a fresh server-generated one-time operation token.

## Proposed API contract (not implemented)
- GET /api/hcot/admin/mapping-reset/preview: return per-table impact counts and an expiring confirmation token.
- POST /api/hcot/admin/mapping-reset: require token and exact confirmation phrase; execute all active-mapping changes atomically, log actor, counts, and operation ID.
- GET /api/hcot/admin/cadres/:id/delete-preview: return current dependencies and historical references.
- DELETE /api/hcot/admin/cadres/:id: require confirmation token; archive/tombstone if historical references require retention.

## Acceptance tests
- Admin succeeds on Preview; line manager and viewer receive 403.
- Confirmation mismatch and stale token cause no mutations.
- All active mappings cleared and staff retained; history counts unchanged.
- Cadre with staff assignments can be retired without broken history or orphaned active mappings.
- Transaction failure rolls back all changes.
- Repeated request does not corrupt records; audit trail records actor, timestamp, and counts.
- Production schema, records, and deployment are unchanged.

## Reconciliation warning
feature/hcot-unified-integration and feature/hcot-cadre-competency-inheritance have diverged. Do not copy an older src/api.ts or public/static/app.js wholesale. Reconcile with the actual deployed Preview commit first.
