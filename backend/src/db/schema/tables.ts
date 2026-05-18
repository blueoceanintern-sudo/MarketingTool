import { pgTable, uuid, text, boolean, integer, real, timestamp, json, vector, index, unique } from "drizzle-orm/pg-core";
import {
  companySizeEnum,
  leadStatusEnum,
  campaignStatusEnum,
  personaEnum,
  draftStatusEnum,
  sentimentEnum,
  flagTypeEnum,
  scrapeJobStatusEnum,
  scraperTypeEnum,
  suppressionReasonEnum,
} from "./enums";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  companySize: companySizeEnum("company_size").notNull(),
  location: text("location").notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").unique().notNull(),
  role: text("role"),
  isVerified: boolean("is_verified").default(false).notNull(),
  status: leadStatusEnum("status").default("new").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  persona: personaEnum("persona").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  status: draftStatusEnum("status").default("pending_review").notNull(),
  bodyEmbedding: vector("body_embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("email_drafts_body_embedding_idx").using("hnsw", t.bodyEmbedding.op("vector_cosine_ops")),
]);

export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").references(() => emailDrafts.id).notNull(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
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

export const templatePerformance = pgTable("template_performance", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  persona: personaEnum("persona").notNull(),
  openRate: real("open_rate").default(0).notNull(),
  replyRate: real("reply_rate").default(0).notNull(),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
}, (t) => [
  unique("tp_campaign_persona_unique").on(t.campaignId, t.persona),
]);

export const suppressionList = pgTable("suppression_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  reason: suppressionReasonEnum("reason").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const followUps = pgTable("follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id).notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  draftId: uuid("draft_id").references(() => emailDrafts.id),
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
