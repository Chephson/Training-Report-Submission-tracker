# Cloudflare Access rollout for HCOT

## Prerequisites
Protect the entire Cloudflare Pages application hostname with a Cloudflare Access self-hosted application policy. Limit access to authorized organizational identities. Do not treat the existing shared tracker access code as staff identity.

Configure the server-side variables HCOT_ACCESS_TEAM_DOMAIN (example: organization.cloudflareaccess.com) and HCOT_ACCESS_AUD (the Access application's AUD tag). Never place secrets or tokens in source control.

The module src/lib/hcot-access.ts validates the JWT signature using the team's Access public keys and checks issuer, audience and expiry. It is not yet wired into the API middleware. Therefore deploying this commit alone does not enforce Cloudflare Access or enable maker/checker roles.

## Required next steps
- Wire verified JWT identity into all protected HCOT routes.
- Maintain mutually exclusive maker/checker roles in a server-controlled authorization store.
- Record the verified maker identity when a request is submitted.
- Require a different verified checker to approve, with atomic mapping and audit inserts.
- Reject missing, invalid and expired Access tokens and cross-role actions.
- Use a separate staging D1 database for end-to-end tests.
- Configure the Cloudflare Access policy in the Cloudflare dashboard; GitHub commits alone cannot create the organization's policy.

Keep mapping approval writes disabled until the entire workflow has been tested.
