# CLAUDE.md — BlueOcean Automated Marketing Tool

This file defines **how to build** this project. For **what to build**, refer to the PRD.

Automated B2B outreach pipeline: scrapes leads → enriches via Snov.io → Claude assigns lead to up to 3 campaigns → AI drafts 1 email per campaign per lead → rep reviews/approves → sends via AWS SES (2× per week per lead) → agent monitors replies → routes through decision tree. Target markets: Singapore, Australia, US.

---

## Current State vs Target

The repo is in an **early scaffold** phase. The sections below describe the **target** monorepo layout and full product. **What exists today** is listed separately so agents do not treat planned paths as real files.

| Area | Built today | Target (this doc) |
|---|---|---|
| Repo layout | `backend/` + `frontend/` (two packages) | Monorepo: `apps/web`, `apps/api`, `services/*`, `workers/`, `db/` |
| Backend routes | `/api/v1/*` routes live; legacy `/scrape`, `/health`, `/unsubscribe` also running | `/api/v1/*` complete per target spec |
| Scraping | Crawl4AI + Cheerio scrapers built; `runScrapeJob` runner; reads from `source_registry` DB table | `source_registry` populated via Tavily for dynamic URL generation |
| Database | Drizzle schema + all tables defined (incl. `audit_log`, `enrichment_records`); migrations **not yet generated/applied** | Migrations in `db/migrations/`; pgvector live |
| Frontend | Full pages: campaigns, review queue, leads, replies, analytics, registry, profile, settings | Same — feature-complete |
| Workers & services | All 6 cron workers + sender/drafting/enrichment (fully connected) /scraping services built | Security middleware, template-improver full logic, campaign-assigner |
| Docker | `docker-compose.yml` present | Same |

When adding features, prefer extending **existing** paths until a deliberate migration to the target layout. New shared types should eventually live in `shared/` (not yet created).

---

## What's Built Today

### Backend (`backend/`)

**Runtime:** Bun | **Framework:** Hono

| File | Purpose |
|---|---|
| `src/index.ts` | Hono app — all routes mounted; CORS middleware; `/unsubscribe` one-click handler |
| `src/db/index.ts` | Drizzle client wired to `DATABASE_URL` |
| `src/db/schema/tables.ts` | Full table definitions — all target tables including `audit_log` and `enrichment_records`; `approved_by`/`approved_at` on `email_drafts`; `lastContactedAt` on `leads`; still missing `generated_by` on `source_registry` |
| `src/db/schema/enums.ts` | All enums |
| `src/config/sourceRegistry.ts` | Legacy CSS selector map — unused; `runScrapeJob` reads selectors from `source_registry` DB table |
| `src/routes/campaigns.ts` | `POST/GET /campaigns`, `GET /campaigns/:id`, `PATCH /campaigns/:id/status` |
| `src/routes/leads.ts` | `POST /campaigns/:id/leads/import`, `GET /campaigns/:id/leads`, `GET /leads` |
| `src/routes/drafts.ts` | `GET /drafts/queue`, `PATCH /drafts/:id/approve`, `PATCH /drafts/:id/reject`, `PATCH /drafts/:id/edit` |
| `src/routes/replies.ts` | `POST /webhooks/ses/reply`, `GET /replies/flagged`, `PATCH /replies/:id/resolve` |
| `src/routes/demos.ts` | `POST/GET /demos`, `PATCH /demos/:id/assign` |
| `src/routes/analytics.ts` | `GET /analytics/overview`, `/analytics/templates`, `/analytics/export` |
| `src/routes/admin.ts` | `GET/POST /registry/sources`, `GET/POST /suppression` |
| `src/services/scrapers/cheerioScraper.ts` | Static HTML scraper; returns `Lead { company?, email?, website }` |
| `src/services/scrapers/crawl4aiScraper.ts` | Crawl4AI HTTP client for JS-rendered pages |
| `src/services/scraping/runScrapeJob.ts` | Orchestrates scrape jobs; updates `scrape_jobs` status/counts |
| `src/services/drafting/index.ts` | Claude Haiku 4.5 Batch API email generation; **still 3 personas (technical/executive/ops) — not yet refactored** to 1 draft per campaign per lead with campaign-goal-aligned prompts |
| `src/services/enrichment/orchestrator.ts` | Full enrichment pipeline: registry → cowork (Claude browser agent) → Snov.io provider chain; persists to `enrichment_records` and updates `leads` |
| `src/services/enrichment/cowork.ts` | Cowork provider — Claude Haiku 4.5 drives headless Chrome via Playwright; extracts institution + contact from public pages |
| `src/services/enrichment/agent.ts` | Browser agent loop for Cowork; Claude decides navigate/read/click steps |
| `src/services/enrichment/browserDriver.ts` | Playwright browser launcher used by the agent |
| `src/services/enrichment/registryLookup.ts` | Registry lookup provider (first in chain) |
| `src/services/enrichment/snovio.ts` | Snov.io provider — token auth, domain lookup, email verification |
| `src/services/enrichment/ndjsonWriter.ts` | Appends enrichment records to NDJSON log file |
| `src/services/enrichment/types.ts` | Shared enrichment types (`EnrichmentInput`, `EnrichmentProvider`, `EnrichmentRecord`, etc.) |
| `src/services/sender/index.ts` | AWS SES send; warm-up cap; suppression + 90-day + risk-flag + verified checks; A/B routing |
| `src/templates/outreachEmail.ts` | HTML email template with one-click unsubscribe link |
| `src/workers/index.ts` | All 6 cron jobs: follow-up-sender (9am), warmup-tracker (midnight), scrape-retry (4am), enrichment-retry (3am — **fully connected** to `enrichLead()` orchestrator), template-improver (Sun midnight — logs only), purge-old-records (Sun 2am) |

**Live routes:**

```
GET  /              # health text
GET  /health        # JSON { status, message }
GET  /scrape?url=   # legacy one-off scrape
GET  /unsubscribe?id=  # one-click suppression + redirect

POST   /api/v1/campaigns
GET    /api/v1/campaigns
GET    /api/v1/campaigns/:id
PATCH  /api/v1/campaigns/:id/status
POST   /api/v1/campaigns/:id/leads/import
GET    /api/v1/campaigns/:id/leads
GET    /api/v1/leads
GET    /api/v1/drafts/queue
PATCH  /api/v1/drafts/:id/approve
PATCH  /api/v1/drafts/:id/reject
PATCH  /api/v1/drafts/:id/edit
POST   /api/v1/webhooks/ses/reply
GET    /api/v1/replies/flagged
PATCH  /api/v1/replies/:id/resolve
POST   /api/v1/demos
GET    /api/v1/demos
PATCH  /api/v1/demos/:id/assign
GET    /api/v1/analytics/overview
GET    /api/v1/analytics/templates
GET    /api/v1/analytics/export
GET    /api/v1/registry/sources
POST   /api/v1/registry/sources
GET    /api/v1/suppression
POST   /api/v1/suppression
```

**Dev commands:**

```bash
cd backend
bun install
bun run src/index.ts   # hot reload
```

### Frontend (`frontend/`)

**Framework:** Next.js (App Router) | **UI:** shadcn/ui (radix-nova) + Tailwind CSS v4

| File/Dir | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout + sidebar component |
| `src/components/sidebar.tsx` | Full nav sidebar (Campaigns, Review Queue, Leads, Replies, Analytics, Registry) |
| `src/app/campaigns/` | Campaign list + detail pages with actions |
| `src/app/drafts/` | Review queue — approve/reject/edit drafts |
| `src/app/leads/` | Leads list |
| `src/app/replies/` | Replies list and flagged queue |
| `src/app/analytics/` | Analytics dashboard + loading skeleton |
| `src/app/registry/` | Source registry admin page |
| `src/app/profile/` | Profile page |
| `src/app/settings/` | Settings page |
| `src/lib/api.ts` | Typed fetch helpers for all API routes |
| `src/components/book-demo-modal.tsx` | Demo booking modal |
| `src/components/ui/` | shadcn components — add via CLI, do not hand-edit |
| `src/lib/utils.ts` | `cn()` (clsx + tailwind-merge) |
| `src/app/globals.css` | Design tokens (`oklch` CSS variables) |

Path alias: `@/*` → `src/*`

**Dev commands:**

```bash
cd frontend
npm install
npm run dev      # localhost:3000
npm run build
npm run lint
```

**Run both:** start `backend` first, then `frontend`.

### Conventions already in use

- **Backend:** Bun runtime; avoid Node-only APIs where Bun alternatives exist.
- **Frontend:** Server Components by default; `"use client"` only when needed.
- **Styling:** Use theme tokens from `globals.css`, not hardcoded colors.
- **`Lead` type:** Defined in `backend/src/services/scrapers/cheerioScraper.ts` — move to `shared/` when DB layer lands.

---

## Tech Stack (target)

| Layer | Technology | Version / Notes |
|---|---|---|
| Runtime | Bun | Use Bun, not Node, for all scripts and server |
| Backend | Hono | TypeScript; runs on Bun |
| Frontend | Next.js | v15+, server components preferred; shadcn/ui for all UI |
| Database | PostgreSQL + pgvector | Single DB for relational + vector embeddings |
| ORM | Drizzle | Stay close to raw SQL; no heavy abstraction |
| Scraping | Crawl4AI | Self-hosted Docker (port 11235); JS-rendered pages |
| Scraping fallback | Cheerio | Static HTML only — **implemented** in `backend/` |
| Email sending | AWS SES | Never Resend or Nodemailer |
| AI — drafting | Claude Haiku 4.5 | Batch API only for email generation |
| AI — classification | Claude Haiku 4.5 | Prompt caching for reply classification |
| Hosting | AWS Lightsail | 2GB RAM, 2 vCPUs |
| Background jobs | node-cron | No Redis, Bull, or external queue |
| Enrichment (primary) | Snov.io API | Email verification + contact enrichment — service built, worker on hold |
| Enrichment (fallback) | Cowork | Only if Snov.io coverage insufficient for a vertical |

---

## Target Folder Structure

```
/
├── apps/
│   ├── web/                  # Next.js frontend (migrates from frontend/)
│   └── api/                  # Hono backend (migrates from backend/)
├── services/
│   ├── scraper/              # Crawl4AI + Cheerio fallback
│   ├── enrichment/           # Snov.io (+ Cowork fallback)
│   ├── drafting/             # Claude Haiku Batch API
│   ├── scoring/              # Hard gates + draft quality
│   ├── sender/               # AWS SES + warm-up
│   ├── reply-handler/        # SES webhook + decision tree
│   └── improver/             # Template A/B + skill.md updater
├── workers/                  # node-cron jobs
├── db/
│   ├── schema/               # Drizzle schema (one file per table)
│   └── migrations/
├── shared/                   # Shared types, constants, utils
├── docker-compose.yml
└── CLAUDE.md
```

---

## Commands (target — not all wired yet)

### Dev

```bash
bun install                          # install dependencies (root monorepo)
bun run dev                          # start api + web
bun run dev --filter=apps/api        # api only
bun run dev --filter=apps/web        # web only
```

Until monorepo scripts exist, use **What's Built Today** commands under `backend/` and `frontend/`.

### Database

```bash
bun drizzle-kit generate             # generate migration from schema
bun drizzle-kit migrate              # apply migrations
bun drizzle-kit studio               # Drizzle Studio
```

### Scraper (Docker)

```bash
docker-compose up crawl4ai           # Crawl4AI on port 11235
docker-compose down
docker-compose up --build crawl4ai   # rebuild after config changes
```

### Workers

```bash
bun run workers                      # start all cron jobs
```

| Worker | Schedule | What it does |
|---|---|---|
| `follow-up-sender` | Daily 9am | Follow-ups (attempts 1–3) for no-reply leads |
| `enrichment-retry` | Daily 3am | Retries unenriched leads or `not_found` leads older than 7 days; calls `enrichLead()` via orchestrator; capped by `ENRICHMENT_DAILY_RUN_CAP` env var (default 200) |
| `scrape-retry` | Daily 4am | Retry failed `scrape_jobs` under `max_retries` |
| `template-improver` | Sunday midnight | Logs `templatePerformance` rows by replyRate — full pgvector similarity + skill.md update **not yet implemented** |
| `warmup-tracker` | Daily midnight | Warm-up phase + daily send cap |
| `purge-old-records` | Weekly Sunday 2am | Hard-deletes replies >180d, email_events >90d, scrape_jobs (failed/complete) >30d |

### Tests

```bash
bun test
bun test --watch
bun test services/scoring
```

---

## Not Yet Built

Items from the target spec that are **not yet implemented**:

- `services/campaign-assigner` — not yet built; Claude assigns leads to up to 3 campaigns; needs `campaign_assignments` table
- `services/source-registry` — not yet built; Tavily integration for dynamic URL generation per campaign trigger; needs `TAVILY_API_KEY` env var and `generated_by` column on `source_registry` table (column also missing from the Drizzle schema)
- Monorepo migration (`apps/web`, `apps/api`, `shared/`) — still `backend/` + `frontend/`
- DB migrations — schema defined in Drizzle but `drizzle-kit generate` + `migrate` not yet run; `db/migrations/` folder does not exist
- Drafting service not yet refactored — `src/services/drafting/index.ts` still uses 3 fixed personas (`technical` / `executive` / `ops`); target is 1 draft per campaign per lead with campaign-goal-aligned prompts and `campaign_type` field (not `persona`)
- Template improver full logic — cron job runs and logs `templatePerformance` rows by replyRate but does not do pgvector similarity or update `skill.md`
- Security middleware not yet wired: API key auth (`X-API-Key` / `SECRET_API_KEY`), rate limiting, SSRF protection in scraper, SNS signature verification on webhook, CSV injection sanitization
- CORS locked to `NEXT_PUBLIC_API_URL` only — currently hardcodes `localhost:3000` and `127.0.0.1:3000` in `src/index.ts`; needs env-driven config
- `POST /admin/leads/:id/erase` right-to-deletion endpoint — in target API spec, not yet built
- `GET /admin/audit-log` and `GET /admin/audit-log/export` — `audit_log` table is defined but no routes expose it yet
- Email domain hardening (SPF, DKIM, DMARC) — DNS / SES console setup, not code

---

## Database Schema (target)

All tables in `db/schema/`. Drizzle only — never raw `pg` client.

### Enums

```ts
company_size:      small | medium | large | enterprise
lead_status:       new | contacted | replied | converted | suppressed
campaign_status:   draft | active | paused | complete
campaign_type:     re_engagement | certification_upsell | event_promo | cold_outreach | general
draft_status:      pending_review | approved | rejected | scheduled | sent
sentiment:         positive | negative | neutral
flag_type:         duplicate | unverified_email | missing_field | legal_keyword | hostile_interaction | regulated_entity
scrape_job_status: queued | running | complete | failed | blocked
scraper_type:      crawl4ai | cheerio | api
```

### Tables

```ts
// campaign_assignments
id, lead_id (FK), campaign_id (FK), assigned_at, assignment_reason
// Claude assigns each lead to up to 3 campaigns; enforced at service level (max 3 rows per lead_id)

// companies
id, name, industry, company_size, location, created_at, updated_at

// leads
id, company_id (FK), campaign_id (FK, nullable), first_name, last_name,
email (UNIQUE), role, is_verified, status,
email_status (verified | pattern_guessed | not_found, nullable),
enrichment_source (registry | cowork_claude | snovio | manual, nullable),
routing (auto_queue | rep_review, nullable),
enriched_at (nullable),
scraper_used (crawl4ai | cheerio | api, nullable),  // which scraper produced this lead; null for CSV / manual
last_contacted_at (nullable),  // ✅ built — set by sender on each SES send
created_at, updated_at

// campaigns
id, name, vertical, geography, company_size_target, status, created_at, updated_at

// email_drafts
id, lead_id (FK), campaign_id (FK), persona (technical|executive|ops), subject, body,
// ⚠️ campaign_type field is target spec — current schema uses persona enum instead (drafting not yet refactored)
confidence_score, status, created_at,
approved_by (nullable), approved_at (nullable),  // ✅ built
body_embedding vector(1536) with HNSW index  // ✅ built
// NOTE: max 1 draft per lead per campaign; max 3 drafts per lead total

// email_events
id, draft_id (FK), lead_id (FK), sent_at, opened_at, replied_at, unsubscribed_at

// replies
id, email_event_id (FK), body, sentiment, category, received_at

// source_registry
id, name, vertical, geo, url (UNIQUE), scraper_type, legal_flag,
selectors (JSON), active, created_at, updated_at
// ⚠️ generated_by — in target spec, NOT YET in Drizzle schema
// normalizeVertical() and normalizeGeo() helpers defined in tables.ts — apply at every write site

// scrape_jobs
id, campaign_id (FK), status, leads_scraped, error_message,
retry_count, max_retries, started_at, completed_at, created_at, updated_at

// risk_flags
id, lead_id (FK), flag_type, flagged_at

// template_performance
id, campaign_id (FK), campaign_type, open_rate, reply_rate, last_calculated_at

// suppression_list
id, email, reason (unsubscribed | spam_complaint | hostile | manual), added_at

// follow_ups
id, lead_id (FK), campaign_id (FK), attempt_number (1|2|3),
scheduled_at, sent_at, draft_id (FK)

// demos
id, lead_id (FK), campaign_id (FK), reply_id (FK), assigned_to,
status (pending | scheduled | completed | cancelled), created_at

// audit_log  ✅ built
id, timestamp, actor (user identifier or system), action, target_id, target_type, ip_address, metadata (JSONB)

// enrichment_records  ✅ built — beyond target spec; full structured enrichment output per lead
id, lead_id (FK), campaign_id (FK, nullable), enriched_at, enrichment_source,
market (SG | AU | US),
institution (JSON: name, type, registration_id, size, website, region),
contact (JSON: full_name, first_name, role, email, email_status),
pipeline_flags (JSON: is_duplicate, missing_critical_fields, missing_fields_detail, risk_flag, risk_flag_reason),
routing (auto_queue | rep_review), routing_reason, created_at
// index on (lead_id, enriched_at DESC)
```

### Key relationships

- `leads` → `companies`: many-to-one
- `email_drafts` → `leads`, `campaigns`: many-to-one each
- `email_events` → `email_drafts`: one-to-one; also `lead_id` for queries
- `replies` → `email_events`: one-to-one
- `risk_flags` → `leads`: many-to-one
- `scrape_jobs` → `campaigns`: many-to-one
- `follow_ups` → `leads` + `campaigns`: many-to-one each
- `demos` → `replies`: one-to-one

### Scraping enforcement

- **Daily cap:** sum `leads_scraped` per `campaign_id` in last 24h; halt if ≥ 500
- **Retry:** increment `retry_count` on failure; stop at `max_retries`
- **CAPTCHA:** `status = blocked`; cron skips 24h
- **New vertical:** insert `source_registry` row — no code change

### A/B test routing

- 20% experimental / 80% control at schedule time in `services/sender`
- Track via `template_performance` (open_rate / reply_rate by campaign_type + campaign)

---

## API Routes (target)

Prefix: `/api/v1`. Internal auth only.

### Campaigns

```
POST   /campaigns
GET    /campaigns
GET    /campaigns/:id
PATCH  /campaigns/:id/status
```

### Leads & drafts

```
POST   /campaigns/:id/leads/import    # CSV: contact_name, role, email, company_name, industry, market
GET    /campaigns/:id/leads
GET    /drafts/queue
PATCH  /drafts/:id/approve
PATCH  /drafts/:id/reject
PATCH  /drafts/:id/edit                 # re-score after edit
```

CSV: missing required fields → flag row, don't drop; dedup by email; same enrichment + hard gates as scraped leads.

### Reply handling

```
POST   /webhooks/ses/reply
GET    /replies/flagged
PATCH  /replies/:id/resolve
```

### Demo booking

```
POST   /demos
GET    /demos
PATCH  /demos/:id/assign
```

Positive reply → `demos` row + rep assignment + dashboard notification.

### Analytics

```
GET    /analytics/overview
GET    /analytics/templates
GET    /analytics/export
```

### Admin

```
GET    /registry/sources
POST   /registry/sources
GET    /suppression
POST   /suppression
POST   /admin/leads/:id/erase          # right-to-deletion; hard-deletes PII, logs to audit_log
GET    /admin/audit-log               # paginated JSON
GET    /admin/audit-log/export        # CSV download for compliance
```

---

## Environment Variables (target)

Never hardcode. Never commit `.env`.

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/blueocean

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-1
AWS_SES_FROM_ADDRESS=outreach@yourdomain.com

ANTHROPIC_API_KEY=

SNOVIO_CLIENT_ID=
SNOVIO_CLIENT_SECRET=

TAVILY_API_KEY=                         # dynamic source registry URL generation

CRAWL4AI_BASE_URL=http://localhost:11235

SECRET_API_KEY=                         # internal API auth — required on all /api/v1/* routes

NODE_ENV=development | production
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Coding Conventions

- **TypeScript everywhere** — no plain JS
- **No `any`** — use proper types or `unknown` + guards
- **Async/await only** — no `.then()` chains
- **Drizzle** — explicit queries; no magic finders
- **Secrets** — `.env` only
- **Errors** — log to DB with context; never swallow silently
- **AI** — only via `services/drafting` and `services/reply-handler`; never from route handlers
- **Background work** — `workers/` only; no inline async jobs in HTTP handlers
- **New vertical/market** — insert a `source_registry` DB row; `runScrapeJob` picks it up automatically by vertical + geo
- **Frontend:** shadcn via `npx shadcn@latest add <component>`; import `@/components/ui/<name>`

---

## Hard Constraints (legal & compliance)

Non-negotiable:

1. Only scrape **publicly listed business contacts** — no personal social profiles or private data
2. Respect **robots.txt** (exception: public government data with legal sign-off in registry)
3. **Rate limit scrapers:** 1 req / 2s; back off on 429; pause 24h on CAPTCHA
4. **Max 500 records per domain per day** at scraper service level
5. **Suppression list** before every SES send
6. **One-click unsubscribe** in every email body
7. **Legal flags by market:** SG → PDPA; AU → Privacy Act; US → CAN-SPAM
8. **No re-contact within 90 days** of prior outreach (hard gate)

---

---

## Security

### SSRF protection

The scraper accepts arbitrary URLs from `source_registry` and CSV imports. Before any fetch (Crawl4AI or Cheerio), resolve the hostname and block requests to private/internal ranges:

- `localhost` / `127.x.x.x`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local `169.254.0.0/16` (AWS metadata endpoint)

Reject the job and set `scrape_jobs.status = blocked` if the resolved IP falls in any of these ranges. Never whitelist exceptions.

### SES webhook signature verification

`POST /webhooks/ses/reply` receives SNS notifications from AWS. Before processing any payload:

1. Verify the `SigningCertURL` domain is `amazonaws.com`
2. Download the cert and verify the SNS `Signature` field against the raw message
3. Reject (HTTP 403) any request that fails verification — never process unverified payloads

Use the AWS SDK's built-in SNS message validator; do not hand-roll this.

### CSV injection sanitization

CSV imports (`POST /campaigns/:id/leads/import`) must strip formula-injection characters before inserting any field into the DB. For every string cell, if the value starts with `=`, `+`, `-`, or `@`, prefix it with a single quote or reject the row with a flag. Apply this in the import parser before validation, not after.

### CORS

Lock `Access-Control-Allow-Origin` to the value of `NEXT_PUBLIC_API_URL` only. Never use a wildcard (`*`). Set this in Hono middleware at app startup so it applies to every route.

### API authentication

All `/api/v1/*` routes require an `X-API-Key` header validated against `SECRET_API_KEY` (env var). Requests missing or mismatching the key return HTTP 401 immediately — no DB access, no logging of the payload. Add `SECRET_API_KEY` to the env var list. The middleware must run before any route handler.

### Route-level rate limiting

Apply rate limiting in Hono middleware (no Redis required — in-memory sliding window is fine for a single-instance Lightsail deploy):

- **Default:** 100 req / min per IP
- **Webhook endpoint:** 50 req / min per IP
- **CSV import:** 10 req / min per API key

Return HTTP 429 with a `Retry-After` header on breach. Log the IP and route.

### Secrets hygiene

- Never log env vars or interpolate them into error messages
- Rotate `ANTHROPIC_API_KEY`, `SNOVIO_CLIENT_SECRET`, `COWORK_API_KEY`, and `SECRET_API_KEY` on a 90-day schedule minimum
- Add `.env*` to `.gitignore` at repo root — enforced, not optional
- In production, pull secrets from AWS Secrets Manager or Parameter Store; `.env` is for local dev only

### Encryption in transit and at rest

- **In transit:** TLS 1.2+ enforced on all connections — API, DB, SES, Snov.io, Cowork. Never allow HTTP for any external call; use `https://` explicitly in all service clients
- **At rest:** Enable AWS Lightsail/RDS encryption at rest on the PostgreSQL volume. Never store raw PII (email addresses, names) in plaintext log files or error messages
- **DB connections:** `DATABASE_URL` must use `sslmode=require`; reject unencrypted Postgres connections

### Data retention and purge policy

Enforced by a scheduled worker or DB job:

| Table | Retention | Action |
|---|---|---|
| `email_events` | 90 days after `sent_at` | Hard delete |
| `replies` | 90 days after `received_at` | Hard delete |
| `risk_flags` | 90 days after lead suppressed | Hard delete |
| `scrape_jobs` (failed/complete) | 30 days | Hard delete |
| `suppression_list` | Indefinite | Keep — legal requirement |
| `audit_log` | Indefinite | Keep — compliance export |

Add a `purge-old-records` cron worker running weekly. Log purge counts to `audit_log`.

### Right-to-deletion

Required by PDPA (SG), Australia Privacy Act, and CAN-SPAM opt-out obligations:

- `POST /admin/leads/:id/erase` — hard-deletes all PII for a lead: name, email, company data, drafts, events, flags, follow-ups. Replaces email with `[deleted]` in `suppression_list` entry so the 90-day re-contact gate still applies without retaining PII
- Erasure must complete within **30 days** of request
- Log every erasure to `audit_log` with timestamp and requesting actor
- CSV exports must exclude erased leads

### Automated isolation tests in CI

Add a dedicated test suite (`tests/security/isolation.test.ts`) that runs on every push:

- Assert that a query scoped to `org_id = A` returns zero rows from any table where `org_id = B`
- Assert that suppression list checks cannot surface a lead erased via right-to-deletion
- Assert that the enrichment retry worker only processes leads belonging to its campaign's org
- CI must fail and block merge if any isolation test fails — these are non-negotiable

### Audit log exportability

The `audit_log` table (admin actions, permission changes, document access, erasures, purges) must be exportable:

- `GET /admin/audit-log?from=&to=` — returns paginated JSON
- `GET /admin/audit-log/export` — returns CSV download for compliance orgs
- Export includes: `timestamp`, `actor`, `action`, `target_id`, `target_type`, `ip_address`
- Access restricted to admin API key only

### Email domain hardening

Before the first SES send, the sending domain must have all three DNS records configured and verified:

- **SPF** — authorize SES to send on behalf of the domain
- **DKIM** — enable SES Easy DKIM (2048-bit); verify in SES console
- **DMARC** — `p=quarantine` minimum; set `rua` to a monitored inbox

Without these, cold outreach to SG/AU/US targets will be flagged or rejected, and the domain is spoofable.

## AI Usage Rules

- **Campaign assignment:** Claude Haiku 4.5 — assigns each enriched lead to up to 3 campaigns based on campaign goal + lead data (role, industry, intent, market); writes `assignment_reason` per assignment
- **Drafting:** Claude Haiku 4.5 via **Batch API only** — 1 draft per campaign per lead; prompt is campaign-goal-specific, not persona-based
- **Classification:** Claude Haiku 4.5 with **prompt caching**
- **Confidence score:** same generation call as draft — no second API call
- **Anti-hallucination:** approved campaign templates + lead fields only; no free-form product claims
- **Campaign-goal alignment:** each draft must follow its assigned campaign's objective — re-engagement references prior relationship; certification upsell leads with outcome/ROI; event promo has clear CTA with date; generic language scores low
- **Max length:** 125 words in prompt + post-generation validation

---

## Architecture

### Current — Backend (`backend/`)

**Runtime:** Bun | **Framework:** Hono

- `src/index.ts` — Hono app; CORS middleware (hardcoded to `localhost:3000` / `127.0.0.1:3000` — not yet env-driven); all `/api/v1/*` routers mounted; `/unsubscribe` one-click handler; **no security middleware wired yet**
- `src/db/` — Drizzle client + full schema; includes `audit_log` and `enrichment_records`; `approved_by`/`approved_at` on `email_drafts`; `lastContactedAt` on `leads`; still missing `generated_by` on `source_registry`
- `src/routes/` — all target API routes implemented (campaigns, leads, drafts, replies, demos, analytics, admin registry/suppression); still missing `/admin/leads/:id/erase` and `/admin/audit-log`
- `src/services/scrapers/cheerioScraper.ts` — static HTML scraper
- `src/services/scrapers/crawl4aiScraper.ts` — Crawl4AI HTTP client for JS-rendered pages
- `src/services/scraping/runScrapeJob.ts` — scrape job orchestrator; updates `scrape_jobs` table
- `src/services/drafting/index.ts` — Claude Haiku 4.5 Batch API; **still uses 3 personas** (technical/executive/ops); not yet campaign-goal-aligned; confidence score included
- `src/services/enrichment/orchestrator.ts` — full enrichment pipeline: registry → cowork → snovio provider chain; persists `enrichment_records`, updates `leads.emailStatus / enrichmentSource / routing / isVerified`
- `src/services/enrichment/cowork.ts` — Cowork provider; Claude Haiku 4.5 drives Playwright headless Chrome; extracts institution + contact from public pages; rate-limited (2s min interval, `COWORK_DAILY_RUN_CAP` env)
- `src/services/enrichment/snovio.ts` — Snov.io provider (third in chain); token auth, domain lookup, email verification
- `src/services/enrichment/registryLookup.ts` — first-in-chain registry lookup provider
- `src/services/enrichment/agent.ts` + `browserDriver.ts` — Claude browser agent loop + Playwright browser launcher
- `src/services/enrichment/ndjsonWriter.ts` — appends enrichment results to NDJSON log
- `src/services/enrichment/types.ts` — shared enrichment types
- `src/services/sender/index.ts` — AWS SES send; warm-up cap; suppression/90-day/risk/verified hard gates; A/B routing (20/80)
- `src/templates/outreachEmail.ts` — branded HTML email with one-click unsubscribe
- `src/workers/index.ts` — 6 node-cron jobs: follow-up-sender, warmup-tracker, scrape-retry, enrichment-retry (fully connected), template-improver (logs only), purge-old-records
- `src/config/sourceRegistry.ts` — legacy selector map; unused by `runScrapeJob` which reads from DB

### Current — Frontend (`frontend/`)

**Framework:** Next.js (App Router) | **UI:** shadcn/ui (radix-nova style) + Tailwind CSS v4

- `src/app/layout.tsx` + `src/components/sidebar.tsx` — root layout with full nav sidebar
- `src/app/campaigns/` — campaign list and detail pages
- `src/app/drafts/` — review queue (approve / reject / edit drafts)
- `src/app/leads/` — leads list
- `src/app/replies/` — replies and flagged queue
- `src/app/analytics/` — analytics dashboard with loading skeleton
- `src/app/registry/` — source registry admin
- `src/app/profile/` and `src/app/settings/` — profile and settings pages
- `src/lib/api.ts` — typed fetch client for all backend API routes
- `src/components/ui/` — shadcn components (do not edit manually; use `npx shadcn@latest add <component>`)
- `src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- Path alias `@/*` → `src/*`

### Target — System flow

End-to-end pipeline once the monorepo and services are in place:

```
source_registry / scrape_jobs
        ↓
   services/source-registry (Tavily → 10 dynamic URLs per campaign trigger → validate → insert)
        ↓
   services/scraper (Crawl4AI → Cheerio fallback)
        ↓
   services/enrichment (Cowork → Snov.io fallback)
        ↓
   services/campaign-assigner (Claude assigns lead to up to 3 campaigns → campaign_assignments)
        ↓
   services/drafting (Claude Haiku Batch API, 1 draft per campaign per lead, max 3 per lead)
        ↓
   services/scoring (hard gates + confidence in same call)
        ↓
   rep review queue OR auto-schedule (see Email logic below)
        ↓
   services/sender (AWS SES, warm-up cap, 2× per week per lead, unsubscribe link)
        ↓
   email_events → services/reply-handler (SES webhook, classification)
        ↓
   decision tree: follow-up | demo booking | suppress | human flag
```

### Target — Layer responsibilities

| Layer | Role |
|---|---|
| `apps/api` | HTTP routes (`/api/v1/*`); validates input; calls services; no inline cron or direct Anthropic calls |
| `apps/web` | Dashboard, review queue, leads, replies, demos; talks to API via `NEXT_PUBLIC_API_URL` |
| `services/*` | Business logic: scrape, enrich, draft, score, send, classify replies, improve templates |
| `workers/` | node-cron only — follow-ups, enrichment retry, scrape retry, warm-up tracker, template improver |
| `db/schema` | Drizzle models + migrations; all persistence |
| `shared/` | Types (`Lead`, enums), constants, cross-package utils |

### Target — Service map

- `services/campaign-assigner` — Claude Haiku assigns each enriched lead to up to 3 campaigns based on campaign goal + lead data; writes to `campaign_assignments` table; max 3 assignments enforced
- `services/scraper` — Crawl4AI for JS pages; Cheerio for static HTML; enforces rate limits, daily caps, `scrape_jobs` status
- `services/enrichment` — Snov.io primary; Cowork when vertical coverage is insufficient
- `services/source-registry` — Tavily API generates 10 dynamic URLs per campaign trigger; validates via HEAD request; deduplicates against existing `source_registry` rows; inserts with `generated_by` set to the triggering campaign/service
- `services/drafting` — Batch API email generation; 1 draft per campaign per lead (max 3 per lead); campaign-goal-aligned prompt; max 125 words; confidence score in same response
- `services/scoring` — Hard gates (suppression, 90-day rule, legal flags, unverified email) + draft quality score
- `services/sender` — SES send, warm-up daily cap, suppression check, one-click unsubscribe, A/B routing (20% / 80%)
- `services/reply-handler` — Inbound SES webhook; Haiku classification with prompt caching; routes to follow-up / demo / flag
- `services/improver` — Template A/B performance; pgvector similarity on `email_drafts.body_embedding`; updates skill.md

### Key conventions

- **Backend** uses Bun — prefer Bun APIs (`Bun.serve`, etc.) where applicable; avoid Node-only APIs
- **Frontend** uses React Server Components by default; add `"use client"` only when needed
- **Styling** uses Tailwind v4 with CSS variable design tokens in `globals.css` — use `oklch` values from those variables, not hardcoded colors
- **Components** added via shadcn CLI land in `src/components/ui/`; import from `@/components/ui/<name>`
- **`Lead` interface** lives in `backend/src/services/scrapers/cheerioScraper.ts` today — move to `shared/` when the DB layer is added

---

## Email logic

Outbound email behavior is enforced in `services/sender` and `services/scoring`, with follow-ups driven by `workers/follow-up-sender`.

### Draft generation

Each lead is assigned to up to 3 campaigns by `services/campaign-assigner`. One email draft is generated per campaign assignment — so a lead assigned to 3 campaigns gets 3 drafts, each tailored to that campaign's goal. This is enforced at the drafting service level: `MAX_DRAFTS_PER_LEAD = 3`, `MAX_DRAFTS_PER_LEAD_PER_CAMPAIGN = 1`.

### Send cadence

**2 emails per lead per week** maximum across all active campaigns. Enforced in `services/sender` by checking `email_events.sent_at` count per `lead_id` in the rolling 7-day window before scheduling. If the cap is reached, remaining drafts are pushed to the next available slot.

### Send phases (approval vs auto-schedule)

```
Phase 1 (total sent < 500):
  ALL drafts → rep approval queue (pending_review), regardless of confidence_score

Phase 2 (total sent ≥ 500):
  confidence_score ≥ 70 → auto-schedule (draft_status → scheduled)
  confidence_score < 70  → rep approval queue
```

Rep actions (target API): approve → `scheduled`; reject → `rejected` + reason; edit → re-score via `PATCH /drafts/:id/edit`.

### Warm-up ramp (daily send cap)

Enforced by `services/sender` + `warmup-tracker` worker (midnight). Count only successful SES sends.

| Week | Max sends / day |
|---|---|
| 1 | 50 |
| 2 | 200 |
| 3 | 500 |
| 4+ | 1,000 |

If the cap is hit, remaining `scheduled` drafts stay queued until the next day.

### Confidence score rubric

Each draft is scored 0–100 across four equally weighted factors:

| Factor | Description | Weight |
|---|---|---|
| Lead data completeness | Role, company size, industry, market present | 25% |
| Campaign-goal alignment | Draft follows the assigned campaign's objective — re-engagement references prior relationship; certification upsell leads with ROI; event promo has clear CTA with date. Generic language scores low. | 25% |
| Personalisation quality | Specificity and relevance to the lead's context | 25% |
| Length compliance | Under 125 words | 25% |

### Pre-send checks (hard gates)

Every send must pass **before** SES is called (implemented in `services/scoring` / `services/sender`):

1. Email not on `suppression_list`
2. No outreach to same address within **90 days** (prior `email_events.sent_at`)
3. Lead has no blocking `risk_flags` (e.g. `legal_keyword`, `hostile_interaction`)
4. `is_verified` true (or policy allows retry path from enrichment worker)
5. Body includes **one-click unsubscribe** link (template requirement — never omit)
6. Market legal flags respected (SG PDPA / AU Privacy Act / US CAN-SPAM) via campaign + registry config

### A/B variant routing

At **schedule time** in `services/sender`:

- **80%** → control template variant
- **20%** → experimental variant

Track outcomes in `template_performance` (open_rate, reply_rate by `campaign_id` + `campaign_type`). Weekly `template-improver` worker promotes winners after 50+ sends.

### Follow-ups (no reply)

`follow-up-sender` runs daily at 9am:

- Up to **3 attempts** per lead/campaign (`follow_ups.attempt_number` 1 → 2 → 3)
- Only when `email_events` has `sent_at` but no `replied_at` and lead not suppressed
- Each attempt gets its own draft row; respects warm-up cap and pre-send checks

### Inbound replies (decision tree)

`POST /webhooks/ses/reply` → `services/reply-handler`:

| Classification | Action |
|---|---|
| Positive | Create `demos` row, assign rep, notify dashboard |
| Negative / unsubscribe | Add to `suppression_list`, stop follow-ups |
| Neutral / question | Route to flagged queue for human review |
| Hostile / legal threat | `risk_flags` + suppress; no auto-reply |

---

## What Not to Build

- External CRM integrations
- Redis, Bull, or external job queues
- Resend or Nodemailer — **AWS SES only**
- Student/parent-facing features
- Multi-tenant or white-label — internal tool only
