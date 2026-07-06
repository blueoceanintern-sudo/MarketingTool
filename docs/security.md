# Security

All security requirements for the project. Single source of truth — `CLAUDE.md` carries only the condensed critical rules and links here.

## API Authentication

Every `/api/v1/*` route requires a **JWT Bearer token** in the `Authorization` header (`Authorization: Bearer <token>`). The token is verified as HS256 using `AUTH_SECRET` (env var, required). Invalid or missing tokens return HTTP 401 immediately.

The middleware (`requireAuth` in `backend/src/middleware/auth.ts`) attaches `{ email, role }` to the request context for downstream handlers. A second middleware (`requireAdmin`) gates write operations on registry, templates, and workers to the `admin` role only.

> **Implemented** — `requireAuth` is applied globally to all `/api/v1/*` routes in `backend/src/index.ts`.

## SSRF Protection

The scraper accepts arbitrary URLs from `source_registry` and CSV imports. Before any fetch (Crawl4AI or Cheerio), resolve the hostname and block requests to private/internal ranges:

- `localhost` / `127.x.x.x`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local `169.254.0.0/16` (AWS metadata endpoint)

If the resolved IP falls in any of these ranges, reject the job and set `scrape_jobs.status = blocked`. **Never whitelist exceptions.**

> Status: not yet wired.

## SNS / SES Webhook Signature Verification

`POST /webhooks/ses/reply` receives SNS notifications from AWS. **Implemented** in `backend/src/routes/replies.ts`:

1. Validates `SigningCertURL` matches `https://sns.<region>.amazonaws.com/`.
2. Downloads and caches the signing certificate.
3. Verifies the SNS `Signature` field — supports SignatureVersion `"1"` (SHA1) and `"2"` (SHA256, AWS-recommended).
4. Validates `TopicArn` against `SNS_TOPIC_ARN` to prevent spoofing from other topics.
5. Handles `SubscriptionConfirmation` automatically by fetching `SubscribeURL`.
6. Rejects (HTTP 403) any request that fails verification — never processes unverified payloads.
7. Parses the raw MIME body via `postal-mime` to extract plain-text reply content.
8. Resolves the lead by `From`; matches the event via `In-Reply-To` → `email_events.ses_message_id`; falls back to the oldest unreplied event for that lead if the header is absent.

> Note: AWS SDK v3 has no built-in SNS validator; the implementation follows the AWS algorithm directly using `node:crypto`.

## CSV Injection Sanitization

CSV imports (`POST /campaigns/:id/leads/import`) must strip formula-injection characters before inserting any field. For every string cell, if the value starts with `=`, `+`, `-`, or `@`, prefix it with a single quote or reject the row with a flag. Apply this **in the import parser before validation**, not after.

> Status: not yet wired.

## CORS Policy

`Access-Control-Allow-Origin` is locked to the value(s) in `CORS_ORIGINS` (comma-separated, env var). Never use a wildcard (`*`). Applied in Hono CORS middleware at startup — applies to every route.

> **Implemented** — reads `process.env.CORS_ORIGINS`, defaults to `http://localhost:3000`. Set `CORS_ORIGINS=https://yourdomain.com` in the backend service env vars in Coolify for production.

## Route-level Rate Limiting

Apply in Hono middleware. No Redis required — an in-memory sliding window is fine for a single-instance Lightsail deploy.

| Scope | Limit |
|---|---|
| Default (per IP) | 100 req / min |
| Webhook endpoint (per IP) | 50 req / min |
| CSV import (per API key) | 10 req / min |

Return **HTTP 429** with a `Retry-After` header on breach. Log the IP and route.

> Status: not yet wired.

## Secrets Management

- Never log env vars or interpolate them into error messages.
- Rotate `ANTHROPIC_API_KEY`, `SNOVIO_CLIENT_SECRET`, `COWORK_API_KEY`, and `AUTH_SECRET` on a **90-day minimum** schedule.
- Add `.env*` to `.gitignore` at repo root — enforced, not optional.
- In production, pull secrets from **AWS Secrets Manager or Parameter Store**; `.env` is for local dev only.

## Encryption (in transit and at rest)

- **In transit:** TLS 1.2+ on all connections (API, DB, SES, Snov.io, Cowork). Never allow HTTP for an external call; use `https://` explicitly in all service clients.
- **At rest:** enable AWS Lightsail/RDS encryption on the PostgreSQL volume. Never store raw PII (emails, names) in plaintext log files or error messages.
- **DB connections:** `DATABASE_URL` must use `sslmode=require`; reject unencrypted Postgres connections.

## Data Retention and Purge Policy

Enforced by the `purge-old-records` worker (weekly; see `workers.md`). The worker currently logs purge counts to the console only — it does not call `logAudit()`. This is a gap vs the intended spec.

| Table | Retention | Action |
|---|---|---|
| `email_events` | 365 days after `sent_at` | Hard delete — kept a full year so the 7-day send-cap window and historical analytics always have data |
| `replies` | 180 days after `received_at` | Hard delete |
| `scrape_jobs` (failed/complete) | 30 days | Hard delete |
| `suppression_list` | Indefinite | Keep — legal requirement |
| `audit_log` | Indefinite | Keep — compliance export |
| `risk_flags` | Not currently purged | ⚠️ The spec calls for 90-day purge after lead suppressed, but `purge-old-records` does not currently implement this. Add to the worker when building the admin erase flow. |

## Right-to-deletion

Required by PDPA (SG), the Australia Privacy Act, and CAN-SPAM opt-out obligations:

- `POST /admin/leads/:id/erase` — hard-deletes all PII for a lead (name, email, company data, drafts, events, flags, follow-ups). Replaces the email with `[deleted]` in the `suppression_list` entry so suppression stays in force without retaining PII.
- Erasure must complete within **30 days** of request.
- Log every erasure to `audit_log` with timestamp and requesting actor.
- CSV exports must exclude erased leads.

> Status: endpoint not yet built.

## Audit Log Exportability

The `audit_log` table (admin actions, permission changes, document access, erasures, purges) must be exportable:

- `GET /admin/audit-log?from=&to=` — paginated JSON.
- `GET /admin/audit-log/export` — CSV download for compliance orgs.
- Export includes `timestamp, actor, action, target_id, target_type, ip_address`.
- Access restricted to the admin API key only.

> Status: routes not yet built (table exists; draft approve/reject/edit already call `logAudit()`).

## Email Domain Hardening

Before the first SES send, the sending domain must have all three DNS records configured and verified (DNS/SES console setup, not code):

- **SPF** — authorize SES to send on behalf of the domain.
- **DKIM** — enable SES Easy DKIM (2048-bit); verify in the SES console.
- **DMARC** — `p=quarantine` minimum; set `rua` to a monitored inbox.

Without these, cold outreach to SG/AU/US targets is flagged or rejected and the domain is spoofable.

## Email Deliverability Compliance

**Gmail and Yahoo mandated `List-Unsubscribe` headers for all bulk senders in February 2024.** Emails missing these headers are likely to be spam-foldered or rejected by these providers.

Every outbound email (initial + follow-ups) must include:

```
List-Unsubscribe: <{FRONTEND_URL}/api/unsubscribe?id={leadId}&campaign={campaignId}>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

This is implemented via `SendRawEmailCommand` (SES v1 raw send) in `backend/src/services/sender/index.ts`. The `SendEmailCommand` API cannot set custom headers and must **not** be used.

**RFC 8058 one-click (required):** The `List-Unsubscribe-Post` header tells Gmail it can send a silent POST to suppress the recipient without redirecting their browser. The frontend route at `GET/POST /api/unsubscribe` handles both cases — GET for link clicks, POST for Gmail one-click — and both trigger the same backend suppression logic.

**Recipient verification:** SES sandbox mode only allows sending to verified email addresses. In production, SES must be moved out of sandbox (submit a sending limit increase request in the AWS console). The sender address (`AWS_SES_FROM_ADDRESS`) must also be verified.

## What to Test for Security

No dedicated security test suite exists yet. When adding tests, prioritise these invariants:

1. **Suppression integrity** — a lead erased via right-to-deletion must never appear in query results or be re-contacted. The `suppression_list` entry (with PII replaced by `[deleted]`) must survive the erasure.
2. **Cross-campaign isolation** — workers must not process leads or drafts outside the campaign they were triggered for. Suppression checks use `(email, campaign_id)` — never email alone.
3. **Webhook verification** — the SNS signature verification path must reject payloads with invalid signatures, mismatched `TopicArn`, or `SigningCertURL` not matching the expected SNS domain pattern.
