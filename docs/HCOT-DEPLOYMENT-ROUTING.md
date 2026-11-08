# HCOT deployment routing and safety

## Verified repository state (2026-11-06)
- Production branch: `main`; HCOT work is on `feature/hcot-unified-integration`.
- GitHub Actions workflow `.github/workflows/hcot-integration-check.yml` only builds and tests. It does not deploy.
- Cloudflare Pages deployment settings cannot be verified or changed through this repository.

## Required Cloudflare Pages project settings
1. Open **Workers & Pages → training-report-submission-tracker → Settings → Builds & deployments** (labels may vary).
2. Ensure **Production branch** is exactly `main`. Never select `feature/hcot-unified-integration` as production.
3. Under **Preview deployments / Branch control**, enable preview builds for `feature/hcot-unified-integration` (or all non-production branches).
4. Check **Deployments**: the feature branch must be labeled **Preview**, and `main` must be labeled **Production**. Compare the displayed commit SHAs.
5. If a build hook, CI script, or manual Wrangler command deploys feature commits to production, disable that deployment path. The existing GitHub validation workflow does not perform deployments.
6. Do not promote a preview deployment to production or merge the HCOT feature branch into `main` until explicitly approved.

## Manual deployment guard
If deploying manually, do not use a bare `wrangler pages deploy` command without verifying the branch and target project. A preview-targeted command is:
```sh
npx wrangler pages deploy dist --project-name training-report-submission-tracker --branch feature/hcot-unified-integration
```
**Warning:** This command is for a controlled preview deployment only. Verify Cloudflare's effective D1 bindings first; this project has a known preview/production D1 binding overlap. Never perform write tests against live staff data.

## Access and data safety
- Keep Cloudflare Access enabled for production and preview hostnames.
- Configure HCOT_ACCESS_TEAM_DOMAIN and HCOT_ACCESS_AUD in the environment serving the preview.
- Do not change D1 bindings as part of branch routing.
- Keep HCOT mapping approvals and automatic sync disabled.
- Avoid write tests while preview can reach production D1.

## What must be confirmed in Cloudflare
Provide the **Production branch** field, the **Preview branch controls**, and the environment label/branch/commit shown on the latest deployment. Do not share access cookies, API tokens, or JWTs.
