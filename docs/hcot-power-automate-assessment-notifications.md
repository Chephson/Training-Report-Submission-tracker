# HCOT competency assessment email prompts — Microsoft 365 / Power Automate

## Overview
The HCOT Evaluations module creates staff-targeted assessment requests in D1 and posts a notification event to a Microsoft Power Automate cloud flow. The flow sends the actual Outlook email. A successful HTTP response means **accepted by the flow trigger**, not proof of email delivery. The app records `submitted_to_flow`, `failed`, or `not_configured` in `hcot_assessment_email_log`.

## Power Automate setup
1. In your organisation's Microsoft 365 Power Automate environment, create an **Automated cloud flow** with **When an HTTP request is received**. The HTTP trigger may require a Premium license and organisational policy approval.
2. Use the following JSON schema for the trigger:
```json
{
  "type":"object",
  "properties":{
    "request_id":{"type":"integer"},
    "manager_email":{"type":"string"},
    "assessment_cycle":{"type":"string"},
    "requested_by":{"type":"string"},
    "staff":{"type":"array","items":{"type":"object","properties":{"staff_id":{"type":"integer"},"full_name":{"type":"string"}}}},
    "subject":{"type":"string"},
    "message":{"type":"string"}
  },
  "required":["request_id","manager_email","assessment_cycle","staff","subject","message"]
}
```
3. Add **Send an email (V2)** with Office 365 Outlook, using `manager_email` as recipient and `subject` as subject. Construct the body from `message`, `assessment_cycle`, and the `staff` array (for example, a Select + Create HTML table action). Do not put the secret HTTP trigger URL in the email.
4. Configure a failure-handling branch or monitoring in Power Automate so rejected Outlook deliveries are detected; the application only records trigger acceptance.
5. Save the flow, copy the generated **HTTP POST URL** and set it as the Cloudflare Pages **Preview** environment secret `HCOT_POWER_AUTOMATE_URL`. Do not commit or paste the URL into GitHub, logs, or the frontend. Microsoft URLs on `*.logic.azure.com` and `*.api.powerplatform.com` HTTPS hosts are accepted.
6. Confirm the flow's HTTP trigger authentication settings allow the chosen service-to-service invocation. A tenant-restricted Entra ID trigger requiring OAuth is not supported by the current shared-trigger-URL integration; it needs a separate authenticated adapter. Restrict flow ownership and URL access.
7. Deploy to **Preview only**, test a single manager and assigned staff member, confirm the in-app request, Power Automate run history and actual Outlook email. Do not enable Production before acceptance.

## Data safety
Only HCOT admins with verified Cloudflare Access identity can trigger requests. The API validates that every selected employee is active and mapped to the selected manager. Requests and notification status are stored separately. The Staff Roster and bulk CSV import remain unchanged.

## Duplicate behavior
An existing pending all-staff request for the same manager and cycle is not duplicated. Staff-specific requests may be issued separately for the same cycle. For robust production delivery, add a flow-side idempotency check on `request_id` to avoid duplicate emails if the flow is retried.
