# CLAUDE.md — BlueOcean Automated Marketing Tool

How to build this project. This file holds the always-true rules and current status;
deep reference lives in the linked docs — read the relevant one before working in that area.

Automated B2B outreach: scrape leads → enrich (registry → Cowork → Snov.io) → Claude
assigns each lead to one or more campaigns → AI drafts 1 email per campaign → rep
reviews/approves → AWS SES (≤2×/week per lead) → reply-handler routes the decision tree.
Target markets: Singapore, Australia, US.

## Reference docs (`docs/`)

| Doc | Owns |
|---|---|
| `docs/database.md` | Schema, enums, relationships, scraping/A-B enforcement |
| `docs/api.md` | All routes (live + not-yet-built) |
| `docs/email-system.md` | Drafting, scoring, send phases, warm-up, follow-ups, reply decision tree |
| `docs/workers.md` | The 6 node-cron jobs, schedules, retry/purge behavior |
| `docs/security.md` | Auth, SSRF, CSV sanitization, CORS, rate limits, retention, right-to-deletion |
| `docs/deployment.md` | Env vars, local dev, Docker, DB migrations, infra |
| `docs/roadmap.md` | Target monorepo, not-yet-built components, open questions |

## Current Implementation Status

Repo is **`backend/`** (Bun + Hono) + **`frontend/`** (Next.js App Router) — **not** the
target monorepo. Do not treat `apps/`, `services/`, `shared/`, or `db/` as real paths;
they are target layout only (see `docs/roadmap.md`). Extend the existing `backend/` +
`frontend/` paths until a deliberate migration.

**Built:** all `/api/v1/*` routes; full Drizzle schema incl. `audit_log` +
`enrichment_records`; scrapers (Crawl4AI + Cheerio) + `runScrapeJob`; enrichment chain
(registry → Cowork → Snov.io) persisting `enrichment_records`; drafting (Haiku 4.5 Batch
API, one draft per lead/campaign) + orchestrator; sender (SES, warm-up cap, hard gates,
follow-up send); all 6 cron workers; SNS/SES webhook signature verification.

**Not built:** security middleware (API-key auth, rate limiting, SSRF, CSV-injection
sanitization); env-driven CORS; `campaign-assigner`; `source-registry`/Tavily;
`improver` (self-updating templates); admin erase + audit-log routes; monorepo migration;
DB migrations not yet generated/applied. Details in `docs/roadmap.md`.

## Tech Stack

Bun · Hono · Next.js 15+ (RSC by default) · shadcn/ui + Tailwind v4 · PostgreSQL + pgvector ·
Drizzle (close to raw SQL) · Crawl4AI (Cheerio fallback) · AWS SES · Claude Haiku 4.5
(Batch API for drafting, prompt caching for classification) · node-cron · AWS Lightsail
(2GB / 2 vCPU, single instance).

## Coding Conventions

- **TypeScript only** — no plain JS; no `any` (use `unknown` + guards).
- **`async`/`await` only** — no `.then()` chains.
- **Drizzle** with explicit queries — never the raw `pg` client; no magic finders.
- **AI calls only via** `services/drafting` + `services/reply-handler` — never in route handlers.
- **Background work only in `workers/`** — no inline async jobs in HTTP handlers.
- **Secrets in `.env` only** — never log or interpolate them; `.env*` is gitignored.
- **Errors** — log with context; never swallow silently.
- **New vertical/market** — insert a `source_registry` row; `runScrapeJob` picks it up by vertical + geo.
- **Backend:** prefer Bun APIs; avoid Node-only APIs where a Bun alternative exists.
- **Frontend:** RSC by default, `"use client"` only when needed; shadcn via
  `npx shadcn@latest add <name>` (don't hand-edit `src/components/ui/`); use `oklch` theme
  tokens from `globals.css`, never hardcoded colors. Path alias `@/*` → `src/*`.
- The `Lead` interface lives in `backend/src/services/scrapers/cheerioScraper.ts` today;
  move to `shared/` at the monorepo migration.

## Hard Constraints (legal — non-negotiable)

1. Scrape only **publicly listed business contacts** — no personal/private data.
2. Respect **robots.txt** (exception: public government data with legal sign-off in the registry).
3. **Rate-limit scrapers:** 1 req / 2s; back off on 429; pause 24h on CAPTCHA.
4. **Max 500 records per domain per day** at the scraper level.
5. Check the **suppression list before every send**; include a **one-click unsubscribe** link in every email.
6. **Market legal flags:** SG → PDPA · AU → Privacy Act · US → CAN-SPAM.

Full security spec (SSRF, CSV sanitization, retention, encryption, right-to-deletion) in `docs/security.md`.

## AI Usage Rules

- **Drafting:** Claude Haiku 4.5 via **Batch API only** — 1 draft per (lead, campaign);
  each request picks a `prompt_templates` row by weighted-random and records `template_id`;
  confidence score returned in the same call; max **125 words** (in-prompt + post-generation check).
- **Classification:** Claude Haiku 4.5 with **prompt caching**.
- **Campaign assignment:** Claude Haiku 4.5 assigns each enriched lead to one or more
  campaigns with an `assignment_reason` (service not yet built).
- **Anti-hallucination:** approved campaign templates + lead fields only; no free-form
  product claims; each draft must follow its assigned campaign's objective.
- **Templates are immutable after creation** — iterate via the Duplicate action, not edits.

Full email/scoring/follow-up logic in `docs/email-system.md`.

## What Not to Build

External CRM integrations · Redis / Bull / external job queues · Resend or Nodemailer
(**AWS SES only**) · student/parent-facing features · multi-tenant or white-label (internal tool only).
