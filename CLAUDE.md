# CLAUDE.md — BlueOcean Automated Marketing Tool

This file defines **how to build** this project. For **what to build**, refer to the PRD.

Automated B2B outreach pipeline: scrapes leads → enriches via Snov.io → AI drafts emails (3 personas via Claude Haiku) → rep reviews/approves → sends via AWS SES → agent monitors replies → routes through decision tree. Target markets: Singapore, Australia, US.

---

## Current State vs Target

The repo is in an **early scaffold** phase. The sections below describe the **target** monorepo layout and full product. **What exists today** is listed separately so agents do not treat planned paths as real files.

| Area | Built today | Target (this doc) |
|---|---|---|
| Repo layout | `backend/` + `frontend/` (two packages) | Monorepo: `apps/web`, `apps/api`, `services/*`, `workers/`, `db/` |
| Backend routes | `GET /`, `GET /health`, `GET /scrape?url=` | `/api/v1/*` (campaigns, drafts, webhooks, analytics, admin) |
| Scraping | Cheerio only; `sourceRegistry` in **code** (`backend/src/config/`) | Crawl4AI + Cheerio fallback; `source_registry` **table** |
| Database | None | PostgreSQL + pgvector, Drizzle |
| Frontend | Shell: sidebar nav + dashboard placeholder | Full dashboard, review queue, leads, replies, demos |
| Workers, Docker, services | None | `workers/`, `docker-compose.yml`, `services/*` |

When adding features, prefer extending **existing** paths until a deliberate migration to the target layout. New shared types should eventually live in `shared/` (not yet created).

---

## What's Built Today

### Backend (`backend/`)

**Runtime:** Bun | **Framework:** Hono

| File | Purpose |
|---|---|
| `src/index.ts` | Hono app — routes below |
| `src/services/scrapers/cheerioScraper.ts` | Fetches URL, parses HTML with Cheerio; returns `Lead { company?, email?, website }` |
| `src/config/sourceRegistry.ts` | In-code map of source name → CSS selectors (`generic` only today) |

**Live routes (no `/api/v1` prefix yet):**

```
GET  /              # health text ("Backend running")
GET  /health        # JSON { status, message }
GET  /scrape?url=   # scrape one URL; 400 if missing url; 500 on fetch/parse error
```

**Dev commands (use until root `bun run dev` exists):**

```bash
cd backend
bun install          # install dependencies
bun run src/index.ts # run with hot reload (--hot flag in package.json)
bun run --hot src/index.ts  # explicit hot reload
```

### Frontend (`frontend/`)

**Framework:** Next.js (App Router) | **UI:** shadcn/ui (radix-nova) + Tailwind CSS v4

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout + sidebar (Campaigns, Review Queue, Leads, Replies, Dashboard) — links are `#` placeholders |
| `src/app/page.tsx` | Dashboard landing (title + subtitle only) |
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
| Enrichment (primary) | Snov.io API | Email verification + contact enrichment |
| Enrichment (fallback) | Apollo.io | Only if Snov.io coverage insufficient for a vertical |

---

## Target Folder Structure

```
/
├── apps/
│   ├── web/                  # Next.js frontend (migrates from frontend/)
│   └── api/                  # Hono backend (migrates from backend/)
├── services/
│   ├── scraper/              # Crawl4AI + Cheerio fallback
│   ├── enrichment/           # Snov.io (+ Apollo fallback)
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
| `enrichment-retry` | Daily 3am | Retry Snov.io for unverified leads |
| `scrape-retry` | Daily 4am | Retry failed `scrape_jobs` under `max_retries` |
| `template-improver` | Sunday midnight | Top variants → skill.md after 50+ sends |
| `warmup-tracker` | Daily midnight | Warm-up phase + daily send cap |

### Tests

```bash
bun test
bun test --watch
bun test services/scoring
```

---

## Not Yet Built

Everything in the target stack and layout that is **not** listed under **What's Built Today**:

- Monorepo root (`bun run dev`, `apps/*`, `shared/`)
- PostgreSQL + pgvector + Drizzle (`db/schema`, migrations)
- Crawl4AI Docker integration; scrape jobs, rate limits, daily caps
- `source_registry` as DB table (today: in-code `backend/src/config/sourceRegistry.ts`)
- Snov.io / Apollo enrichment
- Claude Haiku drafting (Batch API) + confidence scoring in same call
- Review queue UI and draft approve/reject/edit APIs
- AWS SES sending, warm-up phases, suppression checks
- Reply webhook, classification, decision tree
- Campaigns, CSV import, analytics, admin registry/suppression APIs
- Workers (`workers/index.ts` + cron schedules)
- Template improver, A/B routing, pgvector on `email_drafts`
- Demo booking flow

---

## Database Schema (target)

All tables in `db/schema/`. Drizzle only — never raw `pg` client.

### Enums

```ts
company_size:      small | medium | large | enterprise
lead_status:       new | contacted | replied | converted | suppressed
campaign_status:   draft | active | paused | complete
persona:           technical | executive | ops
draft_status:      pending_review | approved | rejected | scheduled | sent
sentiment:         positive | negative | neutral
flag_type:         duplicate | unverified_email | missing_field | legal_keyword | hostile_interaction | regulated_entity
scrape_job_status: queued | running | complete | failed | blocked
scraper_type:      crawl4ai | cheerio | api
```

### Tables

```ts
// companies
id, name, industry, company_size, location, created_at, updated_at

// leads
id, company_id (FK), first_name, last_name, email (UNIQUE), role,
is_verified, status, created_at, updated_at

// campaigns
id, name, vertical, geography, company_size_target, status, created_at, updated_at

// email_drafts
id, lead_id (FK), campaign_id (FK), persona, subject, body,
confidence_score, status, created_at
// + body_embedding vector(1536) for improver (HNSW index)

// email_events
id, draft_id (FK), lead_id (FK), sent_at, opened_at, replied_at, unsubscribed_at

// replies
id, email_event_id (FK), body, sentiment, category, received_at

// source_registry
id, name, vertical, geo, url (UNIQUE), scraper_type, legal_flag,
selectors (JSON), active, created_at, updated_at

// scrape_jobs
id, campaign_id (FK), status, leads_scraped, error_message,
retry_count, max_retries, started_at, completed_at, created_at, updated_at

// risk_flags
id, lead_id (FK), flag_type, flagged_at

// template_performance
id, campaign_id (FK), persona, open_rate, reply_rate, last_calculated_at

// suppression_list
id, email, reason (unsubscribed | spam_complaint | hostile | manual), added_at

// follow_ups
id, lead_id (FK), campaign_id (FK), attempt_number (1|2|3),
scheduled_at, sent_at, draft_id (FK)

// demos
id, lead_id (FK), campaign_id (FK), reply_id (FK), assigned_to,
status (pending | scheduled | completed | cancelled), created_at
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
- Track via `template_performance` (open_rate / reply_rate by persona + campaign)

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

APOLLO_API_KEY=                        # fallback enrichment only

CRAWL4AI_BASE_URL=http://localhost:11235

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
- **New vertical/market** — `source_registry` DB row (target); today extend `backend/src/config/sourceRegistry.ts` until DB exists
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

## AI Usage Rules

- **Drafting:** Claude Haiku 4.5 via **Batch API only**
- **Classification:** Claude Haiku 4.5 with **prompt caching**
- **Confidence score:** same generation call as draft — no second API call
- **Anti-hallucination:** approved persona templates + lead fields only; no free-form product claims
- **Personas:** technical → implementation pain; executive → ROI; ops → process efficiency
- **Max length:** 125 words in prompt + post-generation validation

---

## Architecture

### Current — Backend (`backend/`)

**Runtime:** Bun | **Framework:** Hono

- `src/index.ts` — Hono app with three routes: `GET /` (health text), `GET /health` (JSON), `GET /scrape?url=...` (scrape URL for lead data)
- `src/services/scrapers/cheerioScraper.ts` — fetches URL, parses HTML with Cheerio, returns `Lead { company?, email?, website }`
- `src/config/sourceRegistry.ts` — maps source names to CSS selector configs (company selector, email selector); extend when adding scrape targets until DB `source_registry` exists

### Current — Frontend (`frontend/`)

**Framework:** Next.js (App Router) | **UI:** shadcn/ui (radix-nova style) + Tailwind CSS v4

- `src/app/layout.tsx` — root layout with persistent sidebar (Campaigns, Review Queue, Leads, Replies, Dashboard)
- `src/app/page.tsx` — dashboard landing
- `src/components/ui/` — shadcn components (do not edit manually; use `npx shadcn@latest add <component>`)
- `src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- Path alias `@/*` → `src/*`

### Target — System flow

End-to-end pipeline once the monorepo and services are in place:

```
source_registry / scrape_jobs
        ↓
   services/scraper (Crawl4AI → Cheerio fallback)
        ↓
   services/enrichment (Snov.io → Apollo fallback)
        ↓
   services/drafting (Claude Haiku Batch API, 3 personas)
        ↓
   services/scoring (hard gates + confidence in same call)
        ↓
   rep review queue OR auto-schedule (see Email logic below)
        ↓
   services/sender (AWS SES, warm-up cap, A/B variant, unsubscribe link)
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

- `services/scraper` — Crawl4AI for JS pages; Cheerio for static HTML; enforces rate limits, daily caps, `scrape_jobs` status
- `services/enrichment` — Snov.io primary; Apollo when vertical coverage is insufficient
- `services/drafting` — Batch API email generation; persona prompts; max 125 words; confidence in same response
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

### Send phases (approval vs auto-schedule)

Total sent = cumulative SES sends across all campaigns (not draft count).

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

Track outcomes in `template_performance` (open_rate, reply_rate by `campaign_id` + `persona`). Weekly `template-improver` worker promotes winners after 50+ sends.

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
