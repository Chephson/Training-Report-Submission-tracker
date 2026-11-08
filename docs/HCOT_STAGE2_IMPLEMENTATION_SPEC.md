# HCOT Stage 2 — Maker/Checker implementation specification

Status: Development planning; not approved for Production. Baseline: Stage 1 main commit a732412adc3598839b0b298552b3289ce5d31560. Branch: feature/hcot-stage2-maker-checker.

## Objective
Allow authorized HR Makers to propose HCOT staff-to-Tracker identity mappings and HR Checkers to independently approve or reject proposals. Preserve Stage 1 read-only functionality and Cloudflare Access controls.

## Security requirements
1. Authenticate each API request using server-verified Cloudflare Access JWT, with configured team domain and AUD. Never trust user-supplied email, role, or identity headers.
2. Determine Maker/Checker eligibility server-side from separately configured role allowlists or trusted identity claims. Deny by default if role configuration is absent.
3. Prevent self-approval: checker identity must differ from request creator; enforce in the database transaction, not only UI.
4. Stage 1 viewers remain read-only; unrecognized routes and methods fail closed.
5. No privileged action authorized by the shared tracker access code alone.
6. Validate staff number, tracker staff ID, active staff, and one-to-one mapping uniqueness before submission AND at approval.
7. Enforce idempotent decisions and safe concurrent review using conditional updates/transactions.
8. Record immutable audit events for creation, review, rejection, approval, and conflict with verified actor identity, timestamp, request ID, and non-sensitive details.
9. Do not log Access tokens, tracker access codes, or other credentials.

## Proposed workflow
Draft (optional UI-only) -> Pending review -> Approved / Rejected / Cancelled.
Only Pending requests may be decided. Approved mapping changes occur atomically with decision and audit event. Rejected requests never modify mappings.
Makers can submit and inspect their requests. Checkers can inspect pending requests and decide them. No self-approval even if one user belongs to both role lists.

## API design (proposed; implementation pending)
- GET /api/hcot/mapping-requests — role-scoped list, safe fields only
- POST /api/hcot/mapping-requests — authenticated Maker submits mapping proposal
- POST /api/hcot/mapping-requests/:id/approve — authenticated Checker, distinct from Maker
- POST /api/hcot/mapping-requests/:id/reject — authenticated Checker, distinct from Maker
- GET /api/hcot/mapping-requests/:id/audit — authorized role-scoped history
All writes require CSRF-resistant request validation in addition to Cloudflare Access.

## Database and migration
Inspect existing hcot_mapping_requests, hcot_staff_links, and audit tables before authoring additive migrations. Preserve current data and do not apply migrations to Production during development. Run migration tests against isolated Preview/test D1 only after backup/recovery review.

## Acceptance tests
- Authorized Maker can submit a valid request.
- Viewer and unauthorized user cannot submit or decide requests.
- Maker cannot approve their own request, including dual-role users.
- Checker can approve/reject another Maker's pending request.
- Duplicate or stale decisions are rejected safely.
- Conflicting mappings and inactive/nonexistent staff are rejected.
- Decision and mapping update are atomic; audit trail records verified actors.
- JWT missing/invalid/wrong AUD, role config missing, and Access disabled fail closed.
- Stage 1 dashboard, assignments, outstanding reports, and HCOT viewer reads regressions pass.
- Preview D1 isolation confirmed; no Production D1 mutations.

## Release controls
Do not merge or deploy Stage 2 to main/Production without security review, successful CI, Preview UAT, and explicit release authorization. Stage 2 Maker/Checker configuration must be reviewed separately from Stage 1 settings.
