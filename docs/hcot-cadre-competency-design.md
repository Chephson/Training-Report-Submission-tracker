# HCOT cadre-based competency management — implementation contract

Status: Development in progress. This branch is not approved for Preview or Production deployment.

## Authoritative sources
- Staff Roster owns staff identity, organisational placement and editable cadre_id.
- hcot_cadres is the controlled cadre directory; no free-text cadre assignment.
- hcot_competencies is the general competency library (category: core/functional).
- hcot_cadre_competencies stores cadre-to-competency rules with optional division, department and unit restrictions.
- hcot_staff_competencies stores **direct individual overrides** only; it must not be used to materialise inherited rules.

## Effective competency calculation
A staff member inherits a competency when their cadre_id equals the rule's cadre_id, and every non-null organisational field in the rule matches the corresponding Staff Roster field (team=division, role=department, unit=unit). The effective competency set is the union of inherited and direct assignments, de-duplicated by competency ID, with provenance (inherited, direct or both) returned to the UI. Changes to cadre or organisational placement take effect on the next read without deleting direct assignments.

## Import contract
CSV import with a downloadable template, explicit preview, row validation, duplicate detection, and all-or-nothing confirmation. Columns: competency_name, category, description, cadre, division, department, unit. Cadre must resolve against the cadre directory. Reuse a competency only when identity is unambiguous; report conflicts rather than silently overwriting. Bulk import creates cadre rules, not direct staff assignments. A separate controlled workflow may import staff cadre updates keyed by unique staff email.

## Security and release
All cadre, staff-cadre, mapping and import mutations require verified Cloudflare Access identity plus HCOT administrator authorization. Reject unknown cadre, invalid organisational paths and invalid categories. Protect assigned/in-use competencies from destructive deletion. Validate against Preview D1, retain Production data and Access protection, and require acceptance before Production deployment.

## Remaining implementation gates
1. CRUD for cadre directory and staff-cadre updates in Staff Roster.
2. CRUD for cadre-competency mapping and computed effective competencies API.
3. Staff Roster cadre editor and HCOT cadre mapping interface.
4. Bulk CSV preview/commit with rollback-safe transaction and row-level errors.
5. Regression tests for inheritance, direct assignments, category editing, security, imports and changes to cadre/organisation.
6. Controlled Preview deployment and user acceptance.
