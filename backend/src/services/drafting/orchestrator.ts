import { and, eq, ne, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, campaignLeads, companies, emailDrafts, leads } from "../../db/schema";
import { generateDraftsBatch, type CampaignContext } from "./index";

function toCampaignContext(row: typeof campaigns.$inferSelect): CampaignContext {
  return {
    name: row.name,
    description: row.description,
    painPoints: row.painPoints,
    callToAction: row.callToAction,
  };
}

export interface GenerateResult {
  generated: number;
  skipped_no_eligible: boolean;
  errors: string[];
}

export async function generateDraftsForCampaign(campaignId: string): Promise<GenerateResult> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    return { generated: 0, skipped_no_eligible: false, errors: [`campaign ${campaignId} not found`] };
  }

  // Eligible = (1) member of this campaign via campaign_leads, (2) enrichment
  // routed it to auto_queue, (3) not suppressed, (4) no existing draft yet for
  // this (lead, campaign) pair (DB also enforces this via unique constraint).
  const draftedRows = await db
    .select({ leadId: emailDrafts.leadId })
    .from(emailDrafts)
    .where(eq(emailDrafts.campaignId, campaignId));
  const alreadyDrafted = draftedRows.map((r) => r.leadId);

  const conditions = [
    eq(campaignLeads.campaignId, campaignId),
    eq(leads.routing, "auto_queue"),
    ne(leads.status, "suppressed"),
  ];
  if (alreadyDrafted.length > 0) {
    conditions.push(notInArray(leads.id, alreadyDrafted));
  }

  const eligible = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      role: leads.role,
      companyName: companies.name,
      industry: companies.industry,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(and(...conditions));

  if (eligible.length === 0) {
    return { generated: 0, skipped_no_eligible: true, errors: [] };
  }

  const campaignContext = toCampaignContext(campaign);
  const requests = eligible.map((lead) => ({
    leadId: lead.id,
    campaignId,
    lead: {
      firstName: lead.firstName ?? undefined,
      lastName: lead.lastName ?? undefined,
      role: lead.role ?? undefined,
      companyName: lead.companyName,
      industry: lead.industry,
    },
    campaign: campaignContext,
  }));

  const results = await generateDraftsBatch(requests);

  for (const draft of results) {
    await db.insert(emailDrafts).values({
      leadId: draft.leadId,
      campaignId: draft.campaignId,
      templateId: draft.templateId,
      subject: draft.subject,
      body: draft.body,
      confidenceScore: draft.confidenceScore,
      status: "pending_review",
    });
  }

  const errors: string[] = [];
  if (results.length < eligible.length) {
    errors.push(`${eligible.length - results.length} draft(s) failed to generate or parse — see server logs`);
  }

  return { generated: results.length, skipped_no_eligible: false, errors };
}
