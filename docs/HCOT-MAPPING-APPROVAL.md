# HCOT mapping approval: current security status

## Current behavior
The endpoint POST /api/hcot/mapping-approve returns HTTP 403 for all requests. No application configuration enables mapping writes. Automatic synchronization remains disabled.

GET /api/hcot/mapping-approval-status provides read-only request counts.
GET /api/hcot/mapping-security reports which controls are missing.
The hcot_mapping_requests table is a staging foundation only; it does not accept requests through the API.

## Required before enabling approvals
1. Authenticate each HR officer with a trusted identity provider, using verified server-side identity claims.
2. Assign maker and checker permissions through a server-managed role store.
3. Require the checker to differ from the maker, with immutable reviewer identity and timestamps.
4. Require independent identity evidence verification before inserting a staff link.
5. Atomically create the approved mapping and an audit event; reject duplicate staff links.
6. Test using synthetic data and a separate Cloudflare D1 staging database.
7. Review CORS, session security, authorization of all HCOT routes, and the current optional shared access-code gate.

Do not store authentication secrets or real staff records in source control. Do not turn on mapping writes in production before these controls are verified.
