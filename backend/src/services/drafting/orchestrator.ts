import { and, eq, ne, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, companies, emailDrafts, leads } from "../../db/schema";
import { generateDraftsBatch, type CampaignContext } from "./index";

type Persona = "technical" | "executive" | "ops";

// Cheap role-based persona heuristic. The full PRD calls for all three personas
// per lead — that's a future change once we have variant-selection logic; for
// now one persona per lead keeps the Batch API call linear in lead count.
function pickPersona(role: string | null): Persona {
  const r = (role ?? "").toLowerCase();
  if (/\b(cto|cio|engineer|developer|tech|it|software|architect|devops)\b/.test(r)) return "technical";
  if (/\b(ops|operations|admin|coordinator|registrar|admissions)\b/.test(r)) return "ops";
  return "executive";
}

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

  // Eligible = in this campaign, enrichment routed it to auto_queue
  // (verified email + no risk flags + no missing fields), not suppressed,
  // no existing draft yet.
  //
  // rep_review leads are excluded: enrichment flagged something a human needs
  // to clear first. Once a rep resolves the flag and re-routes to auto_queue,
  // the next cron tick will pick them up.
  const draftedRows = await db
    .select({ leadId: emailDrafts.leadId })
    .from(emailDrafts)
    .where(eq(emailDrafts.campaignId, campaignId));
  const alreadyDrafted = draftedRows.map((r) => r.leadId);

  const eligibilityConditions = [
    eq(leads.campaignId, campaignId),
    eq(leads.routing, "auto_queue"),
    ne(leads.status, "suppressed"),
  ];
  if (alreadyDrafted.length > 0) {
    eligibilityConditions.push(notInArray(leads.id, alreadyDrafted));
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
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(and(...eligibilityConditions));

  if (eligible.length === 0) {
    return { generated: 0, skipped_no_eligible: true, errors: [] };
  }

  const campaignContext = toCampaignContext(campaign);
  const requests = eligible.map((lead) => ({
    leadId: lead.id,
    campaignId,
    persona: pickPersona(lead.role),
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

  // Persist every successfully generated draft. Errors from the batch already
  // landed in generateDraftsBatch's logs — we surface only the count delta.
  for (const draft of results) {
    await db.insert(emailDrafts).values({
      leadId: draft.leadId,
      campaignId: draft.campaignId,
      persona: draft.persona,
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
