import { pgTable, varchar, uuid, boolean, timestamp, numeric, text, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const companySizeEnum = pgEnum('company_size', ['SMB', 'Mid-Market', 'Enterprise']);
export const leadStatusEnum = pgEnum('lead_status', ['scraped', 'enriched', 'emailed', 'replied']);
export const campaignStatusEnum = pgEnum('campaign_status', ['active', 'paused', 'completed']);
export const personaEnum = pgEnum('persona', ['Technical', 'Executive', 'Ops']);
export const draftStatusEnum = pgEnum('draft_status', ['pending_review', 'approved', 'rejected', 'sent']);
export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'negative']);
export const flagTypeEnum = pgEnum('flag_type', ['duplicate', 'unverified_email', 'missing_fields', 'sensitive_keywords', 'hostile', 'regulated_entity']);
export const scrapeJobStatusEnum = pgEnum('scrape_job_status', ['pending', 'in_progress', 'completed', 'failed']);

// Tables
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  industry: varchar('industry', { length: 100 }),
  companySize: companySizeEnum('company_size'),
  location: varchar('location', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  role: varchar('role', { length: 100 }),
  isVerified: boolean('is_verified').default(false),
  status: leadStatusEnum('status').default('scraped'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  vertical: varchar('vertical', { length: 100 }),
  geography: varchar('geography', { length: 100 }),
  companySizeTarget: varchar('company_size_target', { length: 100 }),
  status: campaignStatusEnum('status').default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const emailDrafts = pgTable('email_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  persona: personaEnum('persona').notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  body: text('body').notNull(),
  confidenceScore: numeric('confidence_score', { precision: 3, scale: 1 }),
  status: draftStatusEnum('status').default('pending_review'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emailEvents = pgTable('email_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  draftId: uuid('draft_id').references(() => emailDrafts.id),
  leadId: uuid('lead_id').notNull().references(() => leads.id),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  repliedAt: timestamp('replied_at'),
  unsubscribedAt: timestamp('unsubscribed_at'),
});

export const replies = pgTable('replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailEventId: uuid('email_event_id').notNull().references(() => emailEvents.id),
  body: text('body').notNull(),
  sentiment: sentimentEnum('sentiment'),
  category: varchar('category', { length: 100 }),
  receivedAt: timestamp('received_at').notNull(),
});

export const riskFlags = pgTable('risk_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id),
  flagType: flagTypeEnum('flag_type').notNull(),
  flaggedAt: timestamp('flagged_at').defaultNow().notNull(),
});

export const templatePerformance = pgTable('template_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  persona: personaEnum('persona').notNull(),
  openRate: numeric('open_rate', { precision: 5, scale: 2 }),
  replyRate: numeric('reply_rate', { precision: 5, scale: 2 }),
  lastCalculatedAt: timestamp('last_calculated_at'),
});

export const scrapeJobs = pgTable('scrape_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
  status: scrapeJobStatusEnum('status').default('pending'),
  leadsScraped: numeric('leads_scraped', { precision: 10, scale: 0 }).default(0),
  errorMessage: text('error_message'),
  retryCount: numeric('retry_count', { precision: 3, scale: 0 }).default(0),
  maxRetries: numeric('max_retries', { precision: 3, scale: 0 }).default(3),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const companiesRelations = relations(companies, ({ many }) => ({
  leads: many(leads),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  company: one(companies, {
    fields: [leads.companyId],
    references: [companies.id],
  }),
  emailDrafts: many(emailDrafts),
  emailEvents: many(emailEvents),
  riskFlags: many(riskFlags),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  emailDrafts: many(emailDrafts),
  templatePerformance: many(templatePerformance),
  scrapeJobs: many(scrapeJobs),
}));

export const emailDraftsRelations = relations(emailDrafts, ({ one, many }) => ({
  lead: one(leads, {
    fields: [emailDrafts.leadId],
    references: [leads.id],
  }),
  campaign: one(campaigns, {
    fields: [emailDrafts.campaignId],
    references: [campaigns.id],
  }),
  emailEvents: many(emailEvents),
}));

export const emailEventsRelations = relations(emailEvents, ({ one, many }) => ({
  draft: one(emailDrafts, {
    fields: [emailEvents.draftId],
    references: [emailDrafts.id],
  }),
  lead: one(leads, {
    fields: [emailEvents.leadId],
    references: [leads.id],
  }),
  replies: many(replies),
}));

export const repliesRelations = relations(replies, ({ one }) => ({
  emailEvent: one(emailEvents, {
    fields: [replies.emailEventId],
    references: [emailEvents.id],
  }),
}));

export const riskFlagsRelations = relations(riskFlags, ({ one }) => ({
  lead: one(leads, {
    fields: [riskFlags.leadId],
    references: [leads.id],
  }),
}));

export const templatePerformanceRelations = relations(templatePerformance, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [templatePerformance.campaignId],
    references: [campaigns.id],
  }),
}));

export const scrapeJobsRelations = relations(scrapeJobs, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [scrapeJobs.campaignId],
    references: [campaigns.id],
  }),
}));
