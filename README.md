# Automated Marketing Solution

## Overview

### Problem Statement
BlueOcean's outreach pipeline is manual, slow, and inconsistent across Singapore, Australia, and the US, resulting in high cost-per-lead and missed revenue opportunities. Sales teams spend excessive time on repetitive tasks like lead research and email composition, limiting their capacity to focus on relationship building and closing deals.

### Solution
This internal tool automates the entire B2B outreach pipeline—from lead scraping and enrichment to AI-generated personalized emails and intelligent reply routing. Staff operate it with zero code changes needed when switching industries; simply update a config file to support new verticals and markets.

## Functional Requirements & Features

### Key Features
- **Lead Scraping** — Source leads from industry directories, government registries (ACRA, ASIC, SEC EDGAR), and public company data
- **Lead Enrichment** — Auto-enrich contact data with company size and decision-maker roles via Snov.io API
- **AI Email Drafting** — Generate 3 persona-tuned email variants per lead (Technical, Executive, Operations) with confidence scoring
- **Confidence Scoring** — Pre-generation hard gates (duplicates, unverified emails, missing fields, risk flags) and post-generation draft quality assessment
- **Human Review & Approval** — Rep-controlled approval queue for the first 500 emails; auto-send thereafter for high-confidence drafts
- **Reply Automation** — Intelligent routing based on sentiment: positive replies book demos, no replies trigger follow-ups, negative replies escalate or cool-off
- **Self-Improving Templates** — Track reply rates per template, surface top performers, and periodically compile insights for future generation
- **Analytics Dashboard** — Monitor open rates, reply rates, demo bookings, and CAC—filterable by market and vertical with CSV export

### Core Workflow
1. Rep triggers a scrape or imports CSV → leads auto-enriched
2. AI generates 3 email drafts per lead
3. Rep reviews flagged drafts → approves, edits, or rejects
4. Approved emails send via warmed domain (AWS SES)
5. Agent monitors replies via webhook → routes through decision tree
6. Follow-ups auto-send; self-improving engine tracks performance
7. Rep and management review dashboard for pipeline health

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | Next.js 15 + Server Components + shadcn/ui | Server-rendered dashboards without separate backend templating; reduced client-side JS overhead |
| **Backend** | TypeScript + Hono on Bun | Known by all team members; fast runtime |
| **Database** | PostgreSQL + pgvector | Relational campaign entities with semantic search via pgvector; single-database minimizes ops complexity |
| **ORM/Query** | Drizzle | Type-safe, stays close to raw SQL for complex joins and pgvector queries |
| **Email Send** | AWS SES | Lower cost than managed alternatives; equivalent deliverability |
| **Web Scraping** | Crawl4AI (Docker) + Cheerio fallback | Crawl4AI for JS-rendered sites; Cheerio for static HTML; minimizes recurring costs |
| **Lead Enrichment** | Snov.io API | Acceptable accuracy at lower cost than Apollo; optimized for SMB-scale campaigns |
| **Email Drafting** | Claude Haiku 4.5 (Batch API) | Cost-effective quality; Batch API reduces inference costs by ~50% |
| **Reply Classification** | Claude Haiku 4.5 + Prompt Caching | Predictable schemas reduce repeated token costs across high reply volumes |
| **Hosting** | Self-Hosted VPS | Database management control; easy scaling |
| **Background Jobs** | node-cron + lightweight workers | Sufficient for scheduled scrapes, enrichment, and follow-up sequencing; avoids Redis overhead |