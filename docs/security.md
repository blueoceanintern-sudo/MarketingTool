# Security

All security requirements for the project. Single source of truth — `CLAUDE.md` carries only the condensed critical rules and links here.

## API Authentication

Every `/api/v1/*` route requires a **JWT Bearer token** in the `Authorization` header (`Authorization: Bearer <token>`). The token is verified as HS256 using `AUTH_SECRET` (env var, required). Invalid or missing tokens return HTTP 401 immediately.

The middleware (`requireAuth` in `backend/src/middleware/auth.ts`) attaches `{ email, role }` to the request context for downstream handlers. A second middleware (`requireAdmin`) gates write operations on registry, templates, workers, and all `/admin/*` routes to the `admin` role only.

> **Implemented** — `requireAuth` is applied globally to all `/api/v1/*` routes in `backend/src/index.ts`.

## SSRF Protection

The scraper accepts arbitrary URLs from `source_registry`. Before any fetch (Crawl4AI or Cheerio), the hostname is resolved via DNS and blocked if it resolves to a private/internal address:

- `localhost` / `::1`
- `127.0.0.0/8` (loopback)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC-1918 private)
- `169.254.0.0/16` (link-local / AWS metadata endpoint)
- `0.0.0.0/8`

If the hostname or its resolved IP falls in any of these ranges, the source is skipped and an error is logged. The check is done twice: once on the raw hostname (catches `localhost` directly) and once on the resolved IP (catches DNS rebinding).

> **Implemented** — `isSafeUrl()` in `backend/src/services/scraping/runScrapeJob.ts`. Exported and reused in the admin source-scrape handler.

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

CSV imports (`POST /campaigns/:id/leads/import`) sanitize formula-injection characters before inserting any field. For every string cell where the value starts with `=`, `+`, `-`, or `@`, the value is prefixed with a single quote before the DB insert. Applied in `sanitizeCsvField()` in `backend/src/routes/leads.ts` to `contact_name`, `role`, and `company_name`.

> **Implemented** — `sanitizeCsvField()` in `backend/src/routes/leads.ts`.

## CORS Policy

`Access-Control-Allow-Origin` is locked to the value(s) in `CORS_ORIGINS` (comma-separated, env var). Never use a wildcard (`*`). Applied in Hono CORS middleware at startup — applies to every route.

> **Implemented** — reads `process.env.CORS_ORIGINS`, defaults to `http://localhost:3000`. Set `CORS_ORIGINS=https://yourdomain.com` in the backend service env vars in Coolify for production.

## Route-level Rate Limiting

In-memory sliding window rate limiter (`backend/src/middleware/rateLimit.ts`). No Redis required — single-instance Lightsail deploy. Returns **HTTP 429** on breach.

| Scope | Key | Limit |
|---|---|---|
| Webhook endpoints (`/api/v1/webhooks/*`) | Per IP (`x-forwarded-for`) | 50 req / min |
| All authenticated API routes | Per user email | 100 req / min |
| CSV import (`/campaigns/:id/leads/import`) | Per user email (separate namespace) | 10 req / min |

The webhook rate limit is registered **before** `requireAuth` (SNS has no JWT). The CSV import limit uses a separate namespace so it doesn't share the counter with the general 100/min limit.

> **Implemented** — `backend/src/middleware/rateLimit.ts` + wired in `backend/src/index.ts`.

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

Enforced by the `purge-old-records` worker (weekly, Sunday 2am; see `workers.md`). After each run the worker calls `logAudit()` with the counts of deleted records.

| Table | Retention | Action |
|---|---|---|
| `email_events` | 365 days after `sent_at` | Hard delete — kept a full year so analytics always have data |
| `replies` | 180 days after `received_at` | Hard delete |
| `scrape_jobs` (failed/complete) | 30 days | Hard delete |
| `risk_flags` | 90 days after lead suppressed | Hard delete — purge-old-records joins leads with suppression_list and deletes flags for leads suppressed ≥ 90 days |
| `suppression_list` | Indefinite | Keep — legal requirement |
| `audit_log` | Indefinite | Keep — compliance export |

> **All retention gaps are resolved.** `risk_flags` purge and `audit_log` write on purge are both implemented in `backend/src/workers/index.ts`.

## Right-to-deletion

Required by PDPA (SG), the Australia Privacy Act, and CAN-SPAM opt-out obligations. Implemented at `POST /admin/leads/:id/erase` (requires `role: admin`).

### What the erase route does

Rather than hard-deleting all rows (which would drop analytics data), the route **de-identifies the lead in place**. This satisfies PDPA/Privacy Act de-identification requirements without requiring schema changes:

| Operation | Table | What happens |
|---|---|---|
| Anonymize | `leads` | `email → [deleted-{id}]`, `name → null`, `role → null` — row kept so all FK references remain valid |
| Anonymize | `replies` | `body → '[deleted]'` — prospect's own words are PII; row kept for reply count/sentiment analytics |
| Anonymize | `suppression_list` | `email → [deleted-{id}]` — suppression stays in force; unique per lead to satisfy `(email, campaign_id)` constraint |
| Hard delete | `risk_flags` | Contains PII enrichment data; no analytics value |
| Hard delete | `enrichment_records` | Contains raw structured PII from enrichment; no analytics value |
| Hard delete | `campaign_leads` | Link table; no analytics value |
| Hard delete | `campaign_lead_exclusions` | Link table; no analytics value |
| Keep intact | `email_events`, `email_drafts`, `follow_ups`, `demos` | Anonymous after lead is stripped; all analytics counts preserved |

What remains after erase: rows that say "a send happened for campaign X using template Y at time Z" — no name, no email, no lead reference that can be linked back to an individual.

- Erasure must complete within **30 days** of request.
- Every erasure is logged to `audit_log` with timestamp, requesting actor, and lead ID.

> **Implemented** — `POST /admin/leads/:id/erase` in `backend/src/routes/admin.ts`.

## Audit Log Exportability

The `audit_log` table records admin actions, draft approvals/rejections/edits/sends, erasures, and purge runs.

```
GET /admin/audit-log?from=&to=&page=&limit=   # paginated JSON; admin only
GET /admin/audit-log/export                    # full CSV download; admin only
```

Export fields: `timestamp, actor, action, target_id, target_type, ip_address, metadata`.

> **Implemented** — both routes in `backend/src/routes/admin.ts`. Draft approve/reject/edit/send also call `logAudit()`.

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

1. **Suppression integrity** — a lead erased via right-to-deletion must never appear in query results or be re-contacted. The `suppression_list` entry (with email replaced by `[deleted-{id}]`) must survive the erasure.
2. **Cross-campaign isolation** — workers must not process leads or drafts outside the campaign they were triggered for. Suppression checks use `(email, campaign_id)` — never email alone.
3. **Webhook verification** — the SNS signature verification path must reject payloads with invalid signatures, mismatched `TopicArn`, or `SigningCertURL` not matching the expected SNS domain pattern.
4. **Rate limiting** — verify 429 is returned after the per-minute threshold is exceeded for each scope (API, CSV import, webhook).
5. **SSRF** — verify that source URLs resolving to private IPs are blocked and logged, not fetched.
