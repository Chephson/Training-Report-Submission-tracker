# HCOT unified integration — development branch

Status: **Stage 1 scaffold; not production-ready**.

## Implemented
- HCOT Training Monitor route in existing navigation (same layout, same hosting stack).
- Isolated D1 tables: `hcot_training_plans`, `hcot_participants`, `hcot_staff_links`.
- Hono APIs for draft training plans and participant selection.
- Existing tracker staff roster is used for draft participant selection; no confidential HCOT archive data is committed.
- Existing Forms ingestion, submissions, assignments, and dashboard remain unchanged.

## Stage 2 additions
- HCOT training calendar, competency catalogue, draft development goals and KPI descriptors.
- Read-only supervisor review register (writing reviews remains blocked pending verified supervisor permissions).
- New HCOT records are empty by default and are not populated from the confidential archive.

## Stage 4: Read-only handshake preview
- `GET /api/hcot/handshake-preview?period=<id>` compares HCOT plans and participants against tracker programmes and assignments.
- The HCOT `Tracker handshake` tab shows matched/new/ambiguous programmes and potential assignment additions.
- This endpoint does not mutate the database. Explicit synchronization requires verified identity mapping, server-side role authorization, and approval.

## Not yet implemented — do not merge into production
- Full migration of HCOT's 300 KB Preact application and its remaining screens, including costing, workflows and analytics.
- Secure authentication, user roles, approval segregation and audit authorization.
- Identity reconciliation against the confidential HCOT staff register.
- Programme publishing and bidirectional synchronization with report assignments.
- Costing engine, reviews, competencies, KPI/goals, tasks, reports, AI and download adapters.
- Integration tests, database migration rollback testing, and Cloudflare preview deployment.

## Acceptance gates
1. Build and test on the feature branch using a separate preview D1 database.
2. Verify existing Microsoft Forms webhook and tracker metrics unchanged.
3. Implement server-side role enforcement before exposing sensitive HCOT functions.
4. Reconcile staff identities in a private controlled process; never commit real HR records.
5. Validate the costing engine with approved policy rates and maker/checker separation.
6. Obtain explicit user approval before opening a pull request or merging into `main`.

No real HCOT staff records from the uploaded ZIP should be uploaded to GitHub.
