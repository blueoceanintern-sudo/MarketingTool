# API Routes

Prefix `/api/v1`. Internal auth only (`X-API-Key` middleware is a target — see `security.md` § API Authentication). Route handlers validate input and call services; **never** call Anthropic directly or run inline cron (see `roadmap.md` § Target Layer Responsibilities).

## Non-prefixed routes (live)

```
GET  /                  # health text
GET  /health            # JSON { status, message }
GET  /scrape?url=       # legacy one-off scrape
GET  /unsubscribe?id=   # one-click suppression + redirect
```

## Campaigns (live)

```
POST   /campaigns
GET    /campaigns
GET    /campaigns/:id
PATCH  /campaigns/:id/status
```

## Leads & drafts (live)

```
POST   /campaigns/:id/leads/import    # CSV: contact_name, role, email, company_name, industry, market
GET    /campaigns/:id/leads
GET    /leads
GET    /drafts?status=scheduled|sent
GET    /drafts/queue
PATCH  /drafts/:id/approve            # → scheduled; calls logAudit()
PATCH  /drafts/:id/reject             # → rejected + reason; calls logAudit()
PATCH  /drafts/:id/edit               # re-score after edit; calls logAudit()
```

CSV import: missing required fields → flag the row, don't drop; dedup by email; same enrichment + hard gates as scraped leads. CSV-injection sanitization is a target (see `security.md`).

## Reply handling (live)

```
POST   /webhooks/ses/reply            # SNS signature verification implemented
GET    /replies/flagged
PATCH  /replies/:id/resolve
```

## Demo booking (live)

```
POST   /demos
GET    /demos
PATCH  /demos/:id/assign
```

Positive reply → `demos` row + rep assignment + dashboard notification.

## Analytics (live)

```
GET    /analytics/overview
GET    /analytics/templates           # open_rate / reply_rate by template_id, computed live
GET    /analytics/export
```

## Admin

```
GET    /registry/sources              # live
POST   /registry/sources              # live
GET    /suppression                   # live
POST   /suppression                   # live
POST   /admin/leads/:id/erase         # NOT YET BUILT — right-to-deletion; hard-deletes PII, logs to audit_log
GET    /admin/audit-log               # NOT YET BUILT — paginated JSON
GET    /admin/audit-log/export        # NOT YET BUILT — CSV download for compliance
```

The three `/admin` routes above are specified but not implemented (the `audit_log` table exists). See `security.md` § Right-to-deletion and § Audit Log Exportability, and `roadmap.md` § Not-Yet-Built Components.
