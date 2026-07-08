# Roadmap & Target State

> **Everything in this file is future state, not current implementation.** Do not treat these paths, services, or schedules as existing. For what exists today, see `CLAUDE.md` § Current Implementation Status.

## Target Monorepo Structure

```
/
├── apps/
│   ├── web/                  # Next.js frontend (migrates from frontend/)
│   └── api/                  # Hono backend (migrates from backend/)
├── services/
│   ├── scraper/              # Crawl4AI + Cheerio fallback
│   ├── enrichment/           # Snov.io (+ Cowork fallback)
│   ├── drafting/             # Claude Haiku parallel messages.create
│   ├── scoring/              # Hard gates + draft quality
│   ├── sender/               # AWS SES + warm-up
│   ├── reply-handler/        # SES webhook + decision tree
│   └── improver/             # Template mutation + skill.md updater
├── workers/                  # node-cron jobs
├── db/
│   ├── schema/               # Drizzle schema (one file per table)
│   └── migrations/
├── shared/                   # Shared types, constants, utils
├── docker-compose.yml
└── CLAUDE.md
```

When adding features, **extend the existing `backend/` + `frontend/` paths** until a deliberate migration. New shared types (e.g. the `Lead` interface, currently in `backend/src/services/scrapers/cheerioScraper.ts`) should eventually move to `shared/`.

## Target Layer Responsibilities

| Layer | Role |
|---|---|
| `apps/api` | HTTP routes (`/api/v1/*`); validates input; calls services; no inline cron or direct Anthropic calls |
| `apps/web` | Dashboard, review queue, leads, replies, demos; talks to the API via `NEXT_PUBLIC_API_URL` |
| `services/*` | Business logic: scrape, enrich, draft, score, send, classify replies, improve templates |
| `workers/` | node-cron only |
| `db/schema` | Drizzle models + migrations; all persistence |
| `shared/` | Types, constants, cross-package utils |

## Target End-to-End Flow

```
source_registry / scrape_jobs
        ↓
services/source-registry (Tavily → 10 dynamic URLs per campaign trigger → validate → insert)
        ↓
services/scraper (Crawl4AI → Cheerio fallback)
        ↓
services/enrichment (registry lookup → Cowork primary → Snov.io fallback)
        ↓
services/campaign-assigner (Claude assigns lead to one or more campaigns → campaign_assignments)
        ↓
services/drafting (Claude Haiku parallel messages.create, 1 draft per campaign per lead)
        ↓
services/scoring (hard gates + confidence in same call)
        ↓
rep review queue OR auto-schedule (confidence ≥ 70 after 50 sends)
        ↓
services/sender (AWS SES, warm-up cap, ≤2×/week per lead, unsubscribe link)
        ↓
email_events → services/reply-handler (SES webhook, classification)
        ↓
decision tree: follow-up | demo booking | suppress | human flag
```

## Not-Yet-Built Components

- **`services/campaign-assigner`** — Claude assigns each enriched lead to one or more campaigns. No `campaign_assignments` table exists in the schema — results will land in `campaign_leads` when this is built. Currently, leads are added to campaigns manually or via CSV import into `campaign_leads`.
- **Email domain hardening** — SPF/DKIM/DMARC (DNS/SES console, not code).
- **Monorepo migration** — still `backend/` + `frontend/`.
- **DB migrations** — schema changes have not generated/applied migration files via `drizzle-kit generate` + `drizzle-kit migrate`.

## Deferred Cleanup (after feature-complete)

Not blocking and not urgent — revisit once the not-yet-built components above are done. Listed so they aren't forgotten, not as work to interrupt feature delivery:

- `backend/src/config/sourceRegistry.ts` — legacy CSS-selector map, now superseded by selectors stored in the `source_registry` table. Remove once nothing references it.
- The `Lead` interface currently lives in a scraper file; move it to `shared/` when the monorepo migration happens.
- Workers are imported in-process by `backend/src/index.ts` for dev convenience; split them into a separate process as part of the production hardening pass (see `workers.md` § Production Note).

## Open Items (unresolved questions)

Two open items remain:

1. **CI isolation tests vs. single-tenant design.** The isolation suite asserts `org_id`-scoped isolation (`org_id = A` returns no `org_id = B` rows), but the product is single-tenant and **no table has an `org_id` column** — the test cannot pass as written. Keep the salvageable intent: suppression must never surface an erased lead, and workers must not cross campaign boundaries. Rewrite the assertions accordingly or drop the suite.

2. **Reply-triggered re-draft vs. the per-campaign draft cap.** A reply may trigger generating a new draft for that lead/campaign in future. With the `UNIQUE (lead_id, campaign_id)` constraint on `email_drafts`, a second draft for the same pair would be blocked. Decide how to support re-drafts before building that path — e.g. version/supersede old drafts, scope the cap to *active/pending* drafts only, or move re-draft history to a separate table.

> The permanent "what not to build" constraints live in `CLAUDE.md` § What Not to Build.
