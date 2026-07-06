# Database

All tables in `backend/src/db/schema/` (target: `db/schema/`, one file per table). Drizzle only — never the raw `pg` client. Schema is fully defined; see `deployment.md` for migration commands.

## Enums

```ts
company_size:       small | medium | large | enterprise | unknown
lead_status:        new | contacted | replied | converted | suppressed   // used on campaign_leads.status, NOT on leads
campaign_status:    draft | active | paused | complete
draft_status:       pending_review | approved | rejected | scheduled | sent
                    // 'approved' is in the enum but the approve PATCH sets status directly to 'scheduled', bypassing it
sentiment:          positive | negative | neutral | out_of_office
flag_type:          duplicate | unverified_email | missing_field | legal_keyword | hostile_interaction | regulated_entity
scrape_job_status:  queued | running | complete | failed | blocked
scraper_type:       crawl4ai | cheerio | api
email_status:       verified | pattern_guessed | not_found
suppression_reason: unsubscribed | manual
                    // NOTE: only these two values exist. 'spam_complaint' and 'hostile' are NOT suppression reasons;
                    // hostile interactions create a risk_flag instead.
enrichment_routing: auto_queue | rep_review
enrichment_source:  registry | cowork_claude | snovio | manual
```

## Tables

```ts
// companies
id, name, industry (nullable), company_size, location, source (nullable), created_at, updated_at

// campaigns
id, name, vertical, geography, company_size_target, status,
description (nullable), pain_points (text[], nullable), call_to_action (nullable),
created_at, updated_at

// leads
id, company_id (FK), name (nullable),
email (UNIQUE), role (nullable), is_verified (bool, default false),
email_status (verified | pattern_guessed | not_found, nullable),
enrichment_source (registry | cowork_claude | snovio | manual, nullable),
routing (auto_queue | rep_review, nullable),
enriched_at (nullable),
scraper_used (crawl4ai | cheerio | api, nullable),  // null for CSV / manual imports — enrichment-retry skips these
last_contacted_at (nullable),                        // updated by sender on each SES send
last_delivered_template_id (FK prompt_templates, nullable),  // the most recent template used for this lead
created_at, updated_at
// NOTE: lead↔campaign membership lives in campaign_leads (m:n) — no campaign_id on this table
// NOTE: per-campaign status (new | contacted | replied | converted | suppressed) lives on campaign_leads.status

// campaign_leads  — m:n junction between leads and campaigns
lead_id (FK), campaign_id (FK), added_at, source (nullable),
status (lead_status enum: new | contacted | replied | converted | suppressed, default 'new')
PRIMARY KEY (lead_id, campaign_id)
// Cascade delete: removing a lead or campaign drops the membership row

// campaign_lead_exclusions  — permanent per-campaign block list
lead_id (FK), campaign_id (FK), excluded_at, excluded_by, reason (nullable)
PRIMARY KEY (lead_id, campaign_id)
// Prevents automated scrape/CSV runs from re-adding a lead to a campaign after manual removal.
// Manual re-adds via the UI override this by deleting the exclusion row.

// prompt_templates
id, name, description (nullable), system_prompt, weight (int, default 1), active (bool, default true),
template_type (initial | followup_1 | followup_2 | breakup, default 'initial'),
parent_template_id (FK self, nullable),  // lineage when one template is derived from another
created_by ('user' | 'system' | 'ai'),   // 'ai' for mutation-runner generated variants
// Thompson Sampling performance counters (updated by sender on each send/reply):
generation_depth (int, default 0),        // how many AI mutation generations from the original
send_count (int, default 0),
positive_intent_count (int, default 0),
negative_reply_count (int, default 0),
spam_complaint_count (int, default 0),
// Mutation metadata — only populated for AI-generated variants:
mutation_mode (nullable), parent_persuasion_strategy (nullable), child_persuasion_strategy (nullable),
dimensions_changed (JSONB string[], nullable), mutation_distance (nullable),
mutation_reason (nullable), hypothesis_tested (nullable),
created_at, updated_at
// system_prompt is immutable at the application layer — to iterate, create a new row (or let mutation-runner do it)

// email_drafts
id, lead_id (FK), campaign_id (FK), template_id (FK prompt_templates), subject, body,
confidence_score, score_breakdown (JSONB: painPointFit, campaignAlignment, personalisationQuality, lengthCompliance),
status (draft_status: pending_review | approved | rejected | scheduled | sent), created_at,
approved_by (nullable), approved_at (nullable),
body_embedding vector(1536) with HNSW index
UNIQUE (lead_id, campaign_id)  // one draft per lead per campaign

// email_events
id, draft_id (FK), lead_id (FK),
ses_message_id (text, nullable),  // <MessageId@email.amazonses.com> — matched against In-Reply-To on inbound replies
sent_at, opened_at, replied_at, unsubscribed_at

// replies
id, email_event_id (FK), body, sentiment, category, received_at,
resolved_at (nullable)  // set when a rep resolves a flagged reply

// source_registry
id, name, vertical, geo, url (UNIQUE), scraper_type, legal_flag,
selectors (JSON), active, generated_by (FK campaigns.id, nullable), created_at, updated_at
// normalizeVertical() and normalizeGeo() helpers in tables.ts — apply at every write site

// directory_configs  — Tavily auto-discovery configs per (vertical, geo)
id, vertical, geo, query, domains (text[]), created_at, updated_at
UNIQUE (vertical, geo)
// Replaces the old static DIRECTORY_CONFIGS constant; admins can add/edit coverage without a deploy

// scrape_jobs
id, campaign_id (FK), status, leads_scraped, error_message,
retry_count, max_retries, started_at, completed_at, created_at, updated_at

// risk_flags
id, lead_id (FK), flag_type, flagged_at

// suppression_list
id, email, campaign_id (FK, NOT NULL), reason (unsubscribed | manual), added_at
UNIQUE (email, campaign_id)
// Suppression is scoped per campaign — the sender checks (email, campaign_id) before each send.
// The UI shows the suppression list per campaign under the campaign detail page.

// follow_ups
id, lead_id (FK), campaign_id (FK), attempt_number (1|2|3),
scheduled_at, sent_at,
draft_id (FK, nullable),    // points to original campaign draft for email_events lineage
subject (text, nullable),   // lazily generated by follow-up-sender cron on first processing
body (text, nullable),      // lazily generated by follow-up-sender cron on first processing
angle_tag (text, nullable), // short label for the angle used (e.g. "manual_workload"); subsequent attempts avoid repeating it
template_id (FK prompt_templates, nullable)  // the template used to generate this follow-up's content

// demos
id, lead_id (FK), campaign_id (FK), reply_id (FK), assigned_to (nullable),
status (pending | scheduled | completed | cancelled), created_at

// audit_log
id, timestamp, actor (user identifier or system), action, target_id, target_type, ip_address, metadata (JSONB)
// Already called by draft approve/reject/edit/send. Not yet called by admin erase (route not built).

// enrichment_records  — full structured enrichment output per lead; beyond the minimum spec
id, lead_id (FK), campaign_id (FK, nullable), enriched_at, enrichment_source,
market (SG | AU | US),
institution (JSON: name, type, registration_id, size, website, region),
contact (JSON: full_name, first_name, role, email, email_status),
pipeline_flags (JSON: is_duplicate, missing_critical_fields, missing_fields_detail, risk_flag, risk_flag_reason),
routing (auto_queue | rep_review), routing_reason, created_at
// index on (lead_id, enriched_at DESC)
```

## Key relationships

- `leads` → `companies`: many-to-one
- `leads` ↔ `campaigns`: **many-to-many** via `campaign_leads` (a lead can be in many campaigns; a campaign has many leads)
- `email_drafts` → `leads`, `campaigns`, `prompt_templates`: many-to-one each; UNIQUE on (lead_id, campaign_id)
- `prompt_templates` → `prompt_templates`: self-reference via `parent_template_id` for lineage
- `email_events` → `email_drafts`: one-to-one; also `lead_id` for queries
- `replies` → `email_events`: one-to-one
- `risk_flags` → `leads`: many-to-one
- `scrape_jobs` → `campaigns`: many-to-one
- `follow_ups` → `leads` + `campaigns`: many-to-one each
- `demos` → `replies`: one-to-one

## Scraping enforcement

- **Daily cap:** sum `leads_scraped` per `campaign_id` in last 24h; halt if ≥ 500
- **Retry:** increment `retry_count` on failure; stop at `max_retries`
- **CAPTCHA:** `status = blocked`; cron skips 24h
- **New vertical:** insert a `source_registry` row — no code change

## Template selection tracking

- Template selection uses **Thompson Sampling** at draft generation time — not a fixed split. See `email-system.md` § Template Selection for the full algorithm.
- Track via `GET /analytics/templates` (open_rate / reply_rate by `template_id`, computed live from `email_drafts → email_events`)
