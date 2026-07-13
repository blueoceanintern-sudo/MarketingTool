import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, campaignLeads, companies, emailDrafts, geoPlaces, leads, suppressionList } from "../../db/schema";
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
  // routed it to auto_queue, (3) not suppressed for this campaign, (4) no
  // existing draft yet for this (lead, campaign) pair.
  const [draftedRows, suppressedRows] = await Promise.all([
    db.select({ leadId: emailDrafts.leadId }).from(emailDrafts).where(and(
      eq(emailDrafts.campaignId, campaignId),
      inArray(emailDrafts.status, ["pending_review", "approved", "scheduled", "sent"]),
    )),
    db.select({ email: suppressionList.email }).from(suppressionList).where(eq(suppressionList.campaignId, campaignId)),
  ]);
  const alreadyDrafted = draftedRows.map((r) => r.leadId);
  const suppressedEmails = suppressedRows.map((r) => r.email);

  const conditions = [
    eq(campaignLeads.campaignId, campaignId),
  ];
  if (alreadyDrafted.length > 0) conditions.push(notInArray(leads.id, alreadyDrafted));
  if (suppressedEmails.length > 0) conditions.push(notInArray(leads.email, suppressedEmails));

  const eligible = await db
    .select({
      id: leads.id,
      name: leads.name,
      role: leads.role,
      companyName: companies.name,
      industry: companies.industry,
      companySize: companies.companySize,
      location: geoPlaces.name,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .leftJoin(geoPlaces, eq(companies.geonameId, geoPlaces.geonameId))
    .where(and(...conditions));

  if (eligible.length === 0) {
    return { generated: 0, skipped_no_eligible: true, errors: [] };
  }

  const incomplete = eligible.filter((l) => !l.role || !l.name);
  if (incomplete.length > 0) {
    console.warn(
      `[drafting] skipping ${incomplete.length} lead(s) with missing role or name: ${incomplete.map((l) => l.id).join(", ")}`,
    );
  }
  const complete = eligible.filter((l) => l.role && l.name);

  if (complete.length === 0) {
    return { generated: 0, skipped_no_eligible: true, errors: [] };
  }

  const campaignContext = toCampaignContext(campaign);
  const requests = complete.map((lead) => ({
    leadId: lead.id,
    campaignId,
    lead: {
      name: lead.name ?? undefined,
      role: lead.role ?? undefined,
      companyName: lead.companyName,
      industry: lead.industry ?? undefined,
      companySize: lead.companySize,
      location: lead.location ?? undefined,
    },
    campaign: campaignContext,
  }));

  const results = await generateDraftsBatch(requests);

  for (const draft of results) {
    await db.insert(emailDrafts)
      .values({
        leadId: draft.leadId,
        campaignId: draft.campaignId,
        templateId: draft.templateId,
        subject: draft.subject,
        body: draft.body,
        confidenceScore: draft.confidenceScore,
        scoreBreakdown: draft.scoreBreakdown,
        status: "pending_review",
      })
      .onConflictDoUpdate({
        target: [emailDrafts.leadId, emailDrafts.campaignId],
        set: {
          templateId: draft.templateId,
          subject: draft.subject,
          body: draft.body,
          confidenceScore: draft.confidenceScore,
          scoreBreakdown: draft.scoreBreakdown,
          status: "pending_review",
          approvedBy: null,
          approvedAt: null,
        },
      });
  }

  const errors: string[] = [];
  if (results.length < eligible.length) {
    errors.push(`${eligible.length - results.length} draft(s) failed to generate or parse — see server logs`);
  }

  return { generated: results.length, skipped_no_eligible: false, errors };
}
