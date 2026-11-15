# HCOT Stage 2 — Resend assessment email notifications

## Setup (Preview only)
1. Create a Resend account at https://resend.com and verify an organisation-approved sending domain. DNS verification normally requires approval from the organisation's ICT/domain administrator. Use a sender such as `HCOT Training Monitor <notifications@your-verified-domain.example>` only after the domain is verified. Do not assume the Resend testing domain can deliver to arbitrary employee addresses.
2. Create a restricted API key with permission to send emails. Never paste the key in chat or commit it to GitHub.
3. In Cloudflare Pages project **training-report-submission-tracker**, configure the **Preview** environment variables/secrets:
   - `HCOT_RESEND_API_KEY` — secret API key
   - `HCOT_EMAIL_FROM` — verified sender address, e.g. `notifications@your-verified-domain.example`
4. Keep the existing Cloudflare Access authentication and Preview D1 binding `report-tracker-hcot-preview` unchanged.
5. Deploy the validated HCOT Stage 2 branch to Preview only using the controlled workflow after updating its approved commit pin.
6. As an approved HCOT administrator, open **Evaluations → Request line manager assessments**, select a cycle, one line manager and one active staff member mapped to that manager. Trigger the assessment.
7. Confirm the request appears in **Evaluations** and the line manager sees it in **My Staff Assessments**. Verify Resend delivery logs and the recipient's mailbox.
8. The application stores `accepted_by_provider` when Resend accepts a request; that does **not** prove delivery to the mailbox. A webhook or delivery-status reconciliation is required for confirmed delivery. `not_configured` and `failed` are recorded for missing credentials or failed submissions.

## Security and operational notes
- Only approved HCOT administrators can trigger requests. Staff-to-line-manager mapping is validated server-side.
- Recipient addresses come from existing line manager assignments, not arbitrary user-supplied addresses.
- Requests are persisted before the email attempt, so a notification failure does not erase the assessment task.
- API keys stay in Cloudflare server-side secrets. Rotate compromised keys.
- A unique request ID is used as the provider idempotency key to reduce duplicate sends on retries.
- Use an approved domain and review organisational policies before sending staff names to a third-party email provider.
- Production is not changed by this configuration.
