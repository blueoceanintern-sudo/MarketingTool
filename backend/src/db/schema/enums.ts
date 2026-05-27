import { pgEnum } from "drizzle-orm/pg-core";

export const companySizeEnum = pgEnum("company_size", ["small", "medium", "large", "enterprise"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "replied", "converted", "suppressed"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "active", "paused", "complete"]);
export const personaEnum = pgEnum("persona", ["technical", "executive", "ops"]);
export const draftStatusEnum = pgEnum("draft_status", ["pending_review", "approved", "rejected", "scheduled", "sent"]);
export const sentimentEnum = pgEnum("sentiment", ["positive", "negative", "neutral"]);
export const flagTypeEnum = pgEnum("flag_type", ["duplicate", "unverified_email", "missing_field", "legal_keyword", "hostile_interaction", "regulated_entity"]);
export const scrapeJobStatusEnum = pgEnum("scrape_job_status", ["queued", "running", "complete", "failed", "blocked"]);
export const scraperTypeEnum = pgEnum("scraper_type", ["crawl4ai", "cheerio", "api"]);
export const suppressionReasonEnum = pgEnum("suppression_reason", ["unsubscribed", "spam_complaint", "hostile", "manual"]);
export const emailStatusEnum = pgEnum("email_status", ["verified", "pattern_guessed", "not_found"]);
export const enrichmentRoutingEnum = pgEnum("enrichment_routing", ["auto_queue", "rep_review"]);
export const enrichmentSourceEnum = pgEnum("enrichment_source", ["registry", "cowork_claude", "snovio", "manual"]);
