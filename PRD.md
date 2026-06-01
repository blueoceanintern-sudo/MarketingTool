# Automated Marketing Solution — Product Requirements Document (PRD)

## 1. Overview

BlueOcean needs more B2B clients in Singapore, Australia, and the US. This internal tool automates the outreach pipeline, including:

- Scraping leads
- Generating personalised emails
- Handling replies
- Improving templates over time

Staff operate the system, and switching industries only requires adding a row to the registry.

---

## 2. Problem Statement

| Context | Core Problem | Business Impact |
|---|---|---|
| BlueOcean needs to expand its client base across SG, AU, and US. | Outreach is manual, slow, and inconsistent across markets. | High cost-per-lead, slow pipeline, missed revenue. |

---

## 3. Goals & Objectives

### Goals (v1)

- Scrape leads from any industry
- A lead can belong to many campaigns (m:n via `campaign_leads`); each (lead, campaign) pair gets one personalised email draft tuned to the campaign's goal + the lead's role
- Drafts are generated using one of N admin-managed prompt templates (style variants), picked by weighted-random; engagement is tracked per template so reps can compare which styles land best
- Automatically route replies:
  - Positive → book demo
  - No reply → follow-up
  - Negative → objection handling
- Track email template performance and improve over time
- Dashboard for monitoring:
  - Positive / negative / no feedback
  - Lead counts
  - Campaign progress

### Non-Goals (v1)

- Not a customer-facing product
- Not replacing sales reps
- Not a full CRM
- No student or parent-facing functionality

---

## 4. Target Audience & User Personas

| User Role | Pain Points | Needs |
|---|---|---|
| Sales / BD Rep | Manual campaigns and missed follow-ups | Automated sequences and review queue |
| Management | No visibility into pipeline health | Simple dashboard with KPIs |

---

# 5. Key Features & Functionality

## 5.1 Full Pipeline Flow

```text
1. Scrape
   ↓
2. Enrich
   ↓
3. AI Drafts (1 per lead per campaign; prompt template picked by weight)
   ↓
3.1 Confidence Score
   ↓
3.2 Flagged Emails → Approve / Edit / Reject
   ↓
4. Send (AWS SES)
   ↓
5. Handle Reply → Auto-route
```

### Notes

- Teal = automated steps
- Purple = human-in-the-loop
- Snov.io is fallback-only when Cowork cannot resolve contacts

---

## 5.1.1 Confidence Score System

The confidence score determines whether a generated draft:

- Requires explicit review
- Can be auto-scheduled for sending

The system uses two stages.

### Stage 1 — Pre-Generation Hard Gates

If any condition below is triggered:

- Draft generation stops
- Lead is routed to rep review

#### Hard Gate Conditions

- Unverified email
- Missing critical fields
- Legal/compliance risk flags
- Prior hostile interaction
- Regulated entity detection
- Lead on suppression list

---

### Stage 2 — Draft Quality Score

Each draft is scored out of 100.

| Factor | Description | Weight |
|---|---|---|
| Lead Data Completeness | Role, company size, industry, etc. | 25% |
| Role Alignment | Email tone matches the lead's role (peer-to-peer for engineers, outcome-driven for execs, etc.) | 25% |
| Personalisation Quality | Specificity and relevance | 25% |
| Length Compliance | Under 125 words | 25% |

---

### Rollout Phases

#### Phase 1 — First 500 Emails

- All drafts require human approval
- Rejections are logged

#### Phase 2 — After 500 Emails

- Score ≥ 70 → Auto-send scheduled
- Score < 70 → Human review required

---

## 5.2 Functional Requirements

| ID | Feature | Description | Priority |
|---|---|---|---|
| FR1 | Lead scraping | Scrape directories and registries | P0 |
| FR2 | Lead enrichment | Cowork + Claude enrichment workflow | P0 |
| FR2b | Human review | Approval queue for first 500 emails | P0 |
| FR2c | Scheduled send | Auto-send after confidence scoring | P0 |
| FR4 | Lead pipeline DB | PostgreSQL database | P0 |
| FR5 | Reply decision tree | Automated routing logic | P0 |
| FR6 | Self-improving templates | Track performance and generate `skill.md` insights | P1 |
| FR7 | Analytics dashboard | Open rate, CAC, meetings booked | P1 |

---

## 5.3 Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR1 | Data privacy | PDPA, Privacy Act, CAN-SPAM compliance |
| NFR2 | Scalability | 1,000+ leads per market |
| NFR3 | Anti-hallucination | No fabricated claims |
| NFR4 | Uptime | 99.5% uptime |
| NFR5 | Cost | Infrastructure <15% CAC |
| NFR6 | Deliverability | Spam complaints <0.3% |
| NFR7 | Unsubscribe | One-click unsubscribe support |

---

## 5.4 Enrichment Data Schema

### Output Format

- NDJSON (`enriched_leads.ndjson`)
- Append-only writes
- Partial sessions preserved

### Schema

```json
{
  "lead_id": "uuid",
  "enriched_at": "ISO timestamp",
  "enrichment_source": "source name",
  "market": "SG | AU | US",
  "institution": {
    "name": "string",
    "type": "institution type",
    "registration_id": "string | null",
    "size": "small | medium | large | unknown",
    "website": "string | null",
    "region": "string"
  },
  "contact": {
    "full_name": "string | null",
    "first_name": "string | null",
    "role": "role enum",
    "email": "string | null",
    "email_status": "verified | pattern_guessed | not_found"
  },
  "pipeline_flags": {
    "is_duplicate": false,
    "missing_critical_fields": false,
    "missing_fields_detail": [],
    "risk_flag": false,
    "risk_flag_reason": null
  },
  "routing": "auto_queue | rep_review",
  "routing_reason": "string | null"
}
```

### Required Fields

- `lead_id`
- `enriched_at`
- `enrichment_source`
- `market`
- `institution.name`
- `institution.type`
- `contact.email_status`
- `pipeline_flags`
- `routing`

---

### Enrichment Source Priority

1. Public education registries
2. Open web queries via Claude in Chrome
3. Snov.io fallback

---

### Email Status Rules

| Status | Meaning |
|---|---|
| verified | Explicitly listed email |
| pattern_guessed | Inferred from existing patterns |
| not_found | No email resolved |

---

### Routing Rules

| Condition | Routing |
|---|---|
| Any pipeline flag true | `rep_review` |
| `pattern_guessed` or `not_found` | `rep_review` |
| All fields valid and verified | `auto_queue` |

---

## 6. User Flow

1. Rep triggers scrape or CSV import
2. Leads enriched automatically
3. AI generates 3 drafts per lead
4. Rep reviews flagged drafts
5. Emails sent through warmed domain
6. Reply webhook routes outcomes
7. Dashboard tracks results

---

## 7. Success Metrics

| Metric | Target |
|---|---|
| Email open rate | ~27% |
| Email reply rate | 7–8% |
| Sales cycle | 60–90 days |
| CAC | USD $700–$1,200 |
| Spam complaint rate | <0.3% |
| Demo bookings | 5+ / month |

---

# 8. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 + shadcn/ui |
| Backend | TypeScript + Hono on Bun |
| Database | PostgreSQL + pgvector |
| ORM | Drizzle |
| Email | AWS SES |
| Scraping | Crawl4AI + Cheerio |
| Drafting | Claude Haiku 4.5 |
| Reply Classification | Claude Haiku 4.5 |
| Enrichment | Cowork + Claude in Chrome |
| Hosting | AWS Lightsail |
| Background Jobs | node-cron |

### Estimated Monthly Cost

- ~175,000–265,000 VND/month

---

## 9. Constraints & Assumptions

| Type | Statement | Impact |
|---|---|---|
| Assumption | Contact info is publicly available | High |
| Assumption | Product converts via cold email | High |
| Risk | Emails land in spam | High |
| Risk | Scrapers blocked | Medium |
| Risk | Outdated contact information | Medium |
| Risk | Poor AI-generated emails | Critical |

---

# 10. Data Scraping Approach

## Core Rules

### Sources

Primary:

- MOE School Directory
- CPE Registry
- ACARA / TEQSA / ASQA
- NCES / IPEDS

Secondary:

- Institution websites
- Staff directories
- LinkedIn company pages
- Public contact pages

---

### Crawl4AI Setup

- Self-hosted Docker deployment
- Triggered per campaign
- Outputs markdown into drafting pipeline

---

### Rate Limiting

- 1 request every 2 seconds
- Backoff on HTTP 429
- Pause 24h on CAPTCHA

---

### robots.txt Policy

- Always respected by default
- Overrides require legal sign-off

---

### Scraping Limits

- Max 500 records/domain/day
- Reuse existing records under 30 days old

---

### Legal Compliance

- SG → PDPA
- AU → Privacy Act
- US → CAN-SPAM

---

### Enrichment Fallback Flow

1. Registry lookup
2. Open web queries
3. Snov.io fallback

Unresolved contacts are routed to the rep review queue.

---

# Appendix

## Suggested AI-Agent Friendly Improvements

This markdown version was normalized for:

- Hierarchical heading structure
- Clean tables
- Structured JSON examples
- Reduced duplicated prose
- Easier semantic chunking
- Better retrieval for RAG pipelines and coding agents
