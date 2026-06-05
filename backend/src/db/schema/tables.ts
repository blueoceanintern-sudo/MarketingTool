import { pgTable, uuid, text, boolean, integer, real, timestamp, json, jsonb, vector, index, unique, primaryKey } from "drizzle-orm/pg-core";
import {
  companySizeEnum,
  leadStatusEnum,
  campaignStatusEnum,
  draftStatusEnum,
  sentimentEnum,
  flagTypeEnum,
  scrapeJobStatusEnum,
  scraperTypeEnum,
  suppressionReasonEnum,
  emailStatusEnum,
  enrichmentRoutingEnum,
  enrichmentSourceEnum,
} from "./enums";

// Canonical forms for the free-form taxonomy columns. Apply at every write
// site so reads can use simple equality without LOWER()/UPPER() wrappers.
export const normalizeVertical = (s: string): string => s.trim().toLowerCase();
export const normalizeGeo = (s: string): string => s.trim().toUpperCase();

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry"),
  companySize: companySizeEnum("company_size").notNull(),
  location: text("location").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// campaigns defined before leads so leads can FK to it
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),
  geography: text("geography").notNull(),
  companySizeTarget: companySizeEnum("company_size_target").notNull(),
  status: campaignStatusEnum("status").default("draft").notNull(),
  // Optional drafting context — surfaced to the Haiku prompt so emails feel
  // campaign-specific rather than generic per-persona templates.
  description: text("description"),
  painPoints: text("pain_points").array(),
  callToAction: text("call_to_action"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id).notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").unique().notNull(),
  role: text("role"),
  isVerified: boolean("is_verified").default(false).notNull(),
  status: leadStatusEnum("status").default("new").notNull(),
  emailStatus: emailStatusEnum("email_status"),
  enrichmentSource: enrichmentSourceEnum("enrichment_source"),
  routing: enrichmentRoutingEnum("routing"),
  enrichedAt: timestamp("enriched_at"),
  scraperUsed: scraperTypeEnum("scraper_used"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Junction: a lead can belong to many campaigns; a campaign has many leads.
// Replaces the old leads.campaign_id FK so the same person can be approached
// from multiple angles (e.g. an admissions director in both "Admissions
// automation" and "Parent comms revamp" campaigns).
export const campaignLeads = pgTable("campaign_leads", {
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  source: text("source"),
}, (t) => [
  primaryKey({ columns: [t.leadId, t.campaignId] }),
  index("campaign_leads_campaign_id_idx").on(t.campaignId),
]);

// A prompt-style variant the drafting service can use. Each generated draft
// records which template produced it so engagement can be compared across
// styles. system_prompt is treated as immutable at the application layer
// (no PATCH endpoint touches it) — to iterate, the user creates a new row,
// optionally with parent_template_id pointing at the one it was derived from.
export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  templateType: text("template_type", { enum: ["initial", "followup_1", "followup_2", "breakup"] }).default("initial").notNull(),
  weight: integer("weight").default(1).notNull(),
  active: boolean("active").default(true).notNull(),
  parentTemplateId: uuid("parent_template_id"),
  createdBy: text("created_by").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  templateId: uuid("template_id").references(() => promptTemplates.id).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  status: draftStatusEnum("status").default("pending_review").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  bodyEmbedding: vector("body_embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // One draft per (lead, campaign) — replaces the old (lead, campaign, persona) shape
  unique("email_drafts_lead_campaign_unique").on(t.leadId, t.campaignId),
  index("email_drafts_body_embedding_idx").using("hnsw", t.bodyEmbedding.op("vector_cosine_ops")),
]);

export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").references(() => emailDrafts.id).notNull(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  // Full Message-ID header format: <id@email.amazonses.com>
  // Used to match In-Reply-To header on inbound replies.
  sesMessageId: text("ses_message_id"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  unsubscribedAt: timestamp("unsubscribed_at"),
});

export const replies = pgTable("replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailEventId: uuid("email_event_id").references(() => emailEvents.id).notNull(),
  body: text("body").notNull(),
  sentiment: sentimentEnum("sentiment").notNull(),
  category: text("category").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const sourceRegistry = pgTable("source_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),
  geo: text("geo").notNull(),
  url: text("url").unique().notNull(),
  scraperType: scraperTypeEnum("scraper_type").notNull(),
  legalFlag: boolean("legal_flag").default(false).notNull(),
  selectors: json("selectors").$type<Record<string, string>>(),
  active: boolean("active").default(true).notNull(),
  generatedBy: uuid("generated_by").references(() => campaigns.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scrapeJobs = pgTable("scrape_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  status: scrapeJobStatusEnum("status").default("queued").notNull(),
  leadsScraped: integer("leads_scraped").default(0).notNull(),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const riskFlags = pgTable("risk_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  flagType: flagTypeEnum("flag_type").notNull(),
  flaggedAt: timestamp("flagged_at").defaultNow().notNull(),
});

export const suppressionList = pgTable("suppression_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }).notNull(),
  reason: suppressionReasonEnum("reason").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (t) => [
  unique("suppression_list_email_campaign_unique").on(t.email, t.campaignId),
  index("suppression_list_campaign_id_idx").on(t.campaignId),
]);

export const followUps = pgTable("follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  // Points to the original campaign draft that triggered this outreach sequence.
  // Used as the email_events.draft_id FK so analytics retain lineage.
  draftId: uuid("draft_id").references(() => emailDrafts.id),
  // Lazily generated by the follow-up-sender cron when the row is first processed.
  subject: text("subject"),
  body: text("body"),
  // Operational angle tag returned by the AI (e.g. "manual_workload"). Stored so
  // subsequent follow-ups can read previous_angle_tags and avoid repeating angles.
  angleTag: text("angle_tag"),
});

export const demos = pgTable("demos", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  replyId: uuid("reply_id").references(() => replies.id).notNull(),
  assignedTo: text("assigned_to"),
  status: text("status", { enum: ["pending", "scheduled", "completed", "cancelled"] }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  targetType: text("target_type"),
  ipAddress: text("ip_address"),
  metadata: jsonb("metadata"),
});

export interface EnrichmentInstitution {
  name: string;
  type: string;
  registration_id: string | null;
  size: "small" | "medium" | "large" | "unknown";
  website: string | null;
  region: string;
}

export interface EnrichmentContact {
  full_name: string | null;
  first_name: string | null;
  role: string | null;
  email: string | null;
  email_status: "verified" | "pattern_guessed" | "not_found";
}

export interface EnrichmentPipelineFlags {
  is_duplicate: boolean;
  missing_critical_fields: boolean;
  missing_fields_detail: string[];
  risk_flag: boolean;
  risk_flag_reason: string | null;
}

// Permanent per-campaign exclusion list. Once a lead is manually removed from
// a campaign, this row prevents automated scrape/CSV runs from re-adding them.
// Manual adds via POST /leads/:id/campaigns can still override and will delete
// the exclusion row.
export const campaignLeadExclusions = pgTable("campaign_lead_exclusions", {
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }).notNull(),
  excludedAt: timestamp("excluded_at").defaultNow().notNull(),
  excludedBy: text("excluded_by").notNull(),
  reason: text("reason"),
}, (t) => [
  primaryKey({ columns: [t.leadId, t.campaignId] }),
  index("campaign_lead_exclusions_campaign_id_idx").on(t.campaignId),
]);

export const enrichmentRecords = pgTable("enrichment_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  enrichedAt: timestamp("enriched_at").notNull(),
  enrichmentSource: enrichmentSourceEnum("enrichment_source").notNull(),
  market: text("market").notNull(),
  institution: json("institution").$type<EnrichmentInstitution>().notNull(),
  contact: json("contact").$type<EnrichmentContact>().notNull(),
  pipelineFlags: json("pipeline_flags").$type<EnrichmentPipelineFlags>().notNull(),
  routing: enrichmentRoutingEnum("routing").notNull(),
  routingReason: text("routing_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("enrichment_records_lead_enriched_at_idx").on(t.leadId, t.enrichedAt.desc()),
]);
