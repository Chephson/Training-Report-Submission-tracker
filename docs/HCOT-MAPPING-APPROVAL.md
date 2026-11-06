# HCOT staff mapping approval — deployment gate

The API endpoint POST /api/hcot/mapping-approve is an administrator-only backend operation. It does not enable automatic programme synchronization.

## Required configuration
Mapping writes are **disabled by default**. Only a separately approved staging environment may set HCOT_MAPPING_WRITES_ENABLED=true. Never enable this flag in production until named administrator authentication and maker/checker approval have been implemented and reviewed.

Set a unique random HCOT_ADMIN_TOKEN (minimum 24 characters) as an encrypted Cloudflare Pages secret in the intended environment. Do not place this token in GitHub, browser JavaScript, screenshots, or chat. Do not reuse the shared tracker access code. Configure and test staging before production.

The request requires the existing tracker access gate (if configured) plus the HTTP header X-HCOT-Admin-Token and JSON fields hcot_staff_number, tracker_staff_id, identity_verified:true, approval_note (12–500 characters). Only use a trusted administrator-operated API client; there is deliberately no browser approval form.

## Security limitations and go/no-go
This is a single-secret administrator gate, not per-user role-based access or two-person maker/checker approval. Audit entries record an administrator category, not a named identity. Mapping and activity audit insertion now run in one D1 batch transaction. This does not provide named-user attribution or maker/checker approval. Do not use for sensitive production staff mappings until named administrator authentication, segregation of duties, reliable transactional audit logging and an independent security review are implemented.

Test using synthetic staff and a separate staging D1 database. Verify wrong/missing secret returns 403; inactive staff and conflicting links return 409; invalid identity verification or note returns 400; and a valid test approval creates exactly one link without creating tracker assignments.

Do not expose employee identifiers or personal records in a public preview.
