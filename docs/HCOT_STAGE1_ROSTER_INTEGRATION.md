# HCOT Stage 1 — Central Staff Roster Integration

Baseline: Production Stage 1 commit a732412adc3598839b0b298552b3289ce5d31560
Branch: feature/hcot-stage1-roster-integration
Status: Design/implementation pending; do not merge or deploy to Production without Preview verification and authorization.

## Requirement
Use the existing tracker `staff` roster as the authoritative employee directory for every HCOT staff-selection workflow. Do not create a duplicate HCOT staff master table.

## Existing behavior verified in Stage 1
- HCOT plan participant picker loads `GET /api/staff` and submits selected roster `staff.id` values.
- HCOT participant retrieval joins `hcot_participants.staff_id` to `staff.id`.
- HCOT mapping validation accepts a manually entered HCOT staff number and selected tracker staff ID.
- Several HCOT endpoints are read-only for Stage 1 viewers; privileged writes are restricted upstream. Preserve these restrictions.

## Target behavior
1. Shared roster-based staff picker for all HCOT staff-selection screens, with searchable full name, email, team and clear inactive status.
2. Active roster staff only for new training participant assignments; retain historical assignments for inactive staff.
3. Use immutable numeric `staff.id` as foreign key, never staff name as identifier.
4. Roster edits automatically reflect in HCOT display labels without duplicating employee records.
5. Validate server-side that selected IDs exist and are active before new assignments; reject invalid, duplicate or inactive IDs with useful errors.
6. For mapping, select a roster employee first; populate any roster-backed staff number only if the roster actually has that field. Do not invent staff numbers or auto-approve mappings.
7. If employee number is absent from roster, explicitly document schema migration and data import plan before making that field mandatory.
8. Preserve Cloudflare Access JWT verification, Stage 1 read-only role restrictions, Maker/Checker separation, and existing data.
9. Never delete or rewrite historic HCOT participant or review records when roster status changes.
10. Keep Production D1 untouched; develop/test with Preview D1.

## Acceptance criteria
- Every HCOT staff-selection UI reads the same roster source.
- Searching/filtering returns correct staff; inactive staff cannot be newly assigned.
- Existing HCOT participant and review history remains accessible after roster updates.
- Server rejects unknown, inactive and duplicate assignments.
- Unauthorized users cannot mutate HCOT data.
- Dashboard, programme assignments, outstanding reports and HCOT Stage 1 read-only views pass regression tests.
- Preview D1 is isolated from Production; no Production changes before approval.

## Rollout
Implement on this feature branch; add automated tests; validate in Preview; obtain explicit approval for a separate controlled Production release.
