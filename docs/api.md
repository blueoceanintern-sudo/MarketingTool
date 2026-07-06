# API Routes

All routes are prefixed `/api/v1` and served by the Hono backend on port 3001.

> **Auth:** All `/api/v1/*` routes require a valid JWT Bearer token (`Authorization: Bearer <token>`). See `security.md` § API Authentication. Write operations on registry, templates, and workers additionally require `role: admin`.

Route handlers validate input and call services. They must never call Anthropic directly or start inline background work — AI calls go through `services/drafting`, background jobs through `workers/`.

## Non-prefixed routes (live)

```
GET  /                  # health text
GET  /health            # JSON { status, message }
GET  /scrape?url=       # legacy one-off scrape
GET  /unsubscribe?id=&campaign=   # one-click suppression: inserts into suppression_list AND
                                  # campaign_lead_exclusions; then redirects browser to
                                  # /unsubscribe.html. Called server-side by the frontend
                                  # proxy, never directly by recipients.
```

> **Important:** `/unsubscribe` is a backend-only internal route. Email links do **not** point directly to this endpoint (port 3001 is firewalled). Instead, links point to the frontend proxy at `{FRONTEND_URL}/api/unsubscribe`, which calls this route server-side and redirects the user's browser to `/unsubscribe.html`. See the Frontend Routes section below.

## Frontend public routes (live)

These live in `frontend/src/app/api/` and are served on port 80 (no auth required):

```
GET  /api/unsubscribe?id=&campaign=   # public — linked from every outbound email.
                                       # Proxies to backend /unsubscribe internally,
                                       # then redirects browser to /unsubscribe.html
POST /api/unsubscribe?id=&campaign=   # RFC 8058 one-click — Gmail sends a silent POST
                                       # when the user hits "Unsubscribe" in Gmail UI.
                                       # Same suppression logic, returns 200 (no redirect).
```

## Real-time Events (live)

```
GET  /events            # SSE stream — pushes job progress events to the UI in real time.
                        # Used by the frontend to show scrape/enrich/draft job status
                        # without polling. Powered by startJobEventListener() in index.ts.
```

## Campaigns (live)

```
POST   /campaigns
GET    /campaigns
GET    /campaigns/:id
PATCH  /campaigns/:id                      # update campaign fields (name, description, pain_points, CTA, etc.)
PATCH  /campaigns/:id/status               # transition status: draft → active → paused → complete
POST   /campaigns/:id/scrape               # trigger a scrape job for this campaign
POST   /campaigns/:id/fetch-leads          # fetch new leads from source_registry for this campaign
POST   /campaigns/:id/enrich              # trigger enrichment for unenriched leads in this campaign
POST   /campaigns/:id/drafts/generate     # trigger the drafting-runner for this campaign's pending leads
GET    /campaigns/:id/leads/excluded       # list campaign_lead_exclusions (permanent per-campaign block list)
```

## Leads & drafts (live)

```
POST   /campaigns/:id/leads/import    # CSV: contact_name, role, email, company_name, industry, market
GET    /campaigns/:id/leads
GET    /leads
GET    /leads/summary                 # aggregate lead counts by status
POST   /leads/enrich                  # trigger enrichment for specified leads
POST   /leads/scrape                  # trigger a standalone scrape job (not campaign-scoped)
GET    /leads/:id/enrichment          # get enrichment_records for a specific lead
POST   /leads/:id/campaigns           # add a lead to a campaign (creates campaign_leads row)
DELETE /leads/:id/campaigns/:campaignId  # remove a lead from a campaign
GET    /drafts?status=scheduled|sent
GET    /drafts/queue
PATCH  /drafts/:id/approve            # → scheduled; calls logAudit()
PATCH  /drafts/:id/reject             # → rejected + reason; calls logAudit()
PATCH  /drafts/:id/edit               # re-score after edit; calls logAudit()
POST   /drafts/:id/send               # manual send for a scheduled draft; runs all hard gates;
                                      # returns { status, messageId }; 409 if not scheduled; calls logAudit()
```

CSV import: missing required fields on any row → returns 400 for the entire request; dedup by email. CSV-imported leads (`scraper_used = null`) are **never enriched** — the enrichment-retry worker explicitly skips them. Hard gates still apply at send time. CSV-injection sanitization is a target (see `security.md`).

## Reply handling (live)

```
POST   /webhooks/ses/reply            # SNS signature verification implemented
GET    /replies                       # paginated list of all replies
GET    /replies/flagged
PATCH  /replies/:id/resolve
```

## Demo booking (live)

```
POST   /demos
GET    /demos
PATCH  /demos/:id/assign
```

Positive reply → `demos` row created with `assigned_to = null`. Rep claims it via `PATCH /demos/:id/assign`.

## Analytics (live)

```
GET    /analytics/overview
GET    /analytics/templates           # open_rate / reply_rate by template_id, computed live
GET    /analytics/daily-sends         # daily send counts for warm-up tracking
GET    /analytics/export
```

## Registry & Templates (live)

All write operations (`POST`, `PATCH`, `DELETE`) require `role: admin`.

```
GET    /registry/sources
POST   /registry/sources              # add a new source
POST   /registry/sources/import       # bulk import sources (requireAdmin)
POST   /registry/sources/:id/scrape   # trigger a scrape job for a specific source (requireAdmin)
GET    /registry/directory-configs    # Tavily auto-discovery configs per (vertical, geo)
POST   /registry/directory-configs    # add a directory config (requireAdmin)
PATCH  /registry/directory-configs/:id  # update a directory config (requireAdmin)
DELETE /registry/directory-configs/:id  # delete a directory config (requireAdmin)
POST   /registry/discover             # trigger Tavily URL discovery for a vertical/geo
GET    /registry/source-coverage      # which (vertical, geo) combinations have sources
GET    /registry/taxonomy             # list all known verticals and geographies
GET    /registry/active-combinations  # active (vertical, geo) pairs in source_registry
GET    /templates                     # list prompt_templates
POST   /templates                     # create a new template (requireAdmin)
PATCH  /templates/:id                 # update a template (requireAdmin)
DELETE /templates/:id                 # deactivate/delete a template (requireAdmin)
```

## Suppression (live)

```
GET    /suppression                   # list suppression_list entries (scoped per campaign in UI)
POST   /suppression                   # manually add an entry
```

## Workers (live)

```
POST   /workers/send-now              # manually trigger the follow-up-sender worker (requireAdmin)
POST   /workers/reset-dry-run         # clear fake email_events and reschedule drafts when
                                      # SES_DRY_RUN=true has been used (requireAdmin)
```

## Admin (not yet built)

```
POST   /admin/leads/:id/erase         # NOT YET BUILT — right-to-deletion; hard-deletes PII, logs to audit_log
GET    /admin/audit-log               # NOT YET BUILT — paginated JSON
GET    /admin/audit-log/export        # NOT YET BUILT — CSV download for compliance
```

The three `/admin` routes above are specified but not implemented (the `audit_log` table exists). See `security.md` § Right-to-deletion and § Audit Log Exportability, and `roadmap.md` § Not-Yet-Built Components.
