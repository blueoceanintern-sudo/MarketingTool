import { Hono } from "hono";
import { db } from "../db";
import { leads, companies, campaigns, campaignLeads, suppressionList, enrichmentRecords, emailDrafts, emailEvents, followUps } from "../db/schema";
import { eq, desc, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { enrichLead } from "../services/enrichment/orchestrator";
import { logAudit } from "../services/audit/log";

interface LeadRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string | null;
  isVerified: boolean;
  status: string;
  emailStatus: string | null;
  enrichmentSource: string | null;
  routing: string | null;
  enrichedAt: Date | null;
  scraperUsed: string | null;
  createdAt: Date;
  companyName: string;
}

function formatLead(row: LeadRow, campaignsForLead: { id: string; name: string }[]) {
  return {
    id: row.id,
    first_name: row.firstName ?? "",
    last_name: row.lastName ?? "",
    email: row.email,
    role: row.role ?? "",
    is_verified: row.isVerified,
    email_status: row.emailStatus,
    enrichment_source: row.enrichmentSource,
    routing: row.routing,
    enriched_at: row.enrichedAt?.toISOString() ?? null,
    scraper_used: row.scraperUsed,
    status: row.status,
    company_name: row.companyName,
    campaigns: campaignsForLead,
    created_at: row.createdAt.toISOString(),
  };
}

async function attachCampaignsToLeads(leadIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (leadIds.length === 0) return map;
  const rows = await db
    .select({
      leadId: campaignLeads.leadId,
      id: campaigns.id,
      name: campaigns.name,
    })
    .from(campaignLeads)
    .innerJoin(campaigns, eq(campaignLeads.campaignId, campaigns.id))
    .where(inArray(campaignLeads.leadId, leadIds));
  for (const row of rows) {
    const bucket = map.get(row.leadId) ?? [];
    bucket.push({ id: row.id, name: row.name });
    map.set(row.leadId, bucket);
  }
  return map;
}

// Mounted at /api/v1/leads — all leads, no campaign filter
export const allLeadsRouter = new Hono();

allLeadsRouter.get("/", async (c) => {
  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      role: leads.role,
      isVerified: leads.isVerified,
      status: leads.status,
      emailStatus: leads.emailStatus,
      enrichmentSource: leads.enrichmentSource,
      routing: leads.routing,
      enrichedAt: leads.enrichedAt,
      scraperUsed: leads.scraperUsed,
      createdAt: leads.createdAt,
      companyName: companies.name,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .orderBy(leads.createdAt);

  const campaignMap = await attachCampaignsToLeads(rows.map((r) => r.id));
  return c.json(rows.map((r) => formatLead(r, campaignMap.get(r.id) ?? [])));
});

// Mounted at /api/v1/campaigns — campaign-scoped lead endpoints
export const leadsRouter = new Hono();

leadsRouter.get("/:id/leads", async (c) => {
  const campaignId = c.req.param("id");

  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      role: leads.role,
      isVerified: leads.isVerified,
      status: leads.status,
      emailStatus: leads.emailStatus,
      enrichmentSource: leads.enrichmentSource,
      routing: leads.routing,
      enrichedAt: leads.enrichedAt,
      scraperUsed: leads.scraperUsed,
      createdAt: leads.createdAt,
      companyName: companies.name,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(campaignLeads.campaignId, campaignId))
    .orderBy(leads.createdAt);

  const campaignMap = await attachCampaignsToLeads(rows.map((r) => r.id));
  return c.json(rows.map((r) => formatLead(r, campaignMap.get(r.id) ?? [])));
});

leadsRouter.post("/:id/leads/import", async (c) => {
  const campaignId = c.req.param("id");
  const text = await c.req.text();

  const rows = text.trim().split("\n");
  if (rows.length < 2) {
    return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
  }

  const headers = (rows[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const required = ["contact_name", "role", "email", "company_name", "industry", "market"];
  const missing = required.filter((f) => !headers.includes(f));
  if (missing.length > 0) {
    return c.json({ error: `Missing required columns: ${missing.join(", ")}` }, 400);
  }

  const imported: string[] = [];
  const linkedExisting: string[] = [];
  const skipped: string[] = [];
  const enrichmentQueue: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = (rows[i] ?? "").split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });

    const email = row["email"] ?? "";
    if (!email) { skipped.push(`row ${i + 1}: missing email`); continue; }

    // Block suppressed emails — they opted out and must not be re-collected
    const [suppressed] = await db.select({ id: suppressionList.id }).from(suppressionList).where(eq(suppressionList.email, email)).limit(1);
    if (suppressed) { skipped.push(email); continue; }

    // If the lead already exists, link them to this campaign instead of
    // refusing the row. m:n means the same person can appear in many imports.
    const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
    if (existing) {
      const [link] = await db
        .select({ leadId: campaignLeads.leadId })
        .from(campaignLeads)
        .where(and(eq(campaignLeads.leadId, existing.id), eq(campaignLeads.campaignId, campaignId)))
        .limit(1);
      if (!link) {
        await db.insert(campaignLeads).values({ leadId: existing.id, campaignId, source: "csv" });
        linkedExisting.push(email);
      } else {
        skipped.push(email);
      }
      continue;
    }

    // Upsert company
    const companyName = row["company_name"] ?? "";
    let [company] = await db.select().from(companies).where(eq(companies.name, companyName)).limit(1);
    if (!company) {
      const size = (() => {
        const m = row["market"]?.toLowerCase() ?? "";
        if (m.includes("enterprise")) return "enterprise";
        if (m.includes("large")) return "large";
        if (m.includes("medium")) return "medium";
        return "small";
      })() as "small" | "medium" | "large" | "enterprise";

      const [inserted] = await db.insert(companies).values({
        name: companyName,
        industry: row["industry"] ?? "Unknown",
        companySize: size,
        location: row["market"] ?? "",
      }).returning();
      company = inserted!;
    }

    const nameParts = (row["contact_name"] ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const [lead] = await db.insert(leads).values({
      companyId: company.id,
      firstName,
      lastName,
      email,
      role: row["role"] ?? "",
      isVerified: false,
      emailStatus: "pattern_guessed",
      status: "new",
    }).returning();

    if (lead) {
      await db.insert(campaignLeads).values({ leadId: lead.id, campaignId, source: "csv" });
      imported.push(email);
      enrichmentQueue.push(lead.id);
    }
  }

  // Enrichment runs async — orchestrator owns pipeline_flags + routing.
  // Worker `enrichment-retry` catches any failures.
  for (const leadId of enrichmentQueue) {
    void enrichLead(leadId).catch((err) => {
      console.error(`[leads/import] enrichment failed for ${leadId}:`, err);
    });
  }

  return c.json(
    {
      imported: imported.length,
      linked_existing: linkedExisting.length,
      skipped: skipped.length,
      enrichment_queued: enrichmentQueue.length,
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// Membership endpoints — replaces the old PATCH /:id/campaign route. With m:n
// "move" is no longer a primitive; the rep adds and removes campaigns directly.
// ---------------------------------------------------------------------------

// Add a lead to a campaign
allLeadsRouter.post("/:id/campaigns", async (c) => {
  const leadId = c.req.param("id");
  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const body = await c.req.json<{ campaign_id?: string }>();
  if (!body.campaign_id) return c.json({ error: "campaign_id is required" }, 400);

  const [target] = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, body.campaign_id))
    .limit(1);
  if (!target) return c.json({ error: "Destination campaign not found" }, 400);
  if (target.status === "complete") {
    return c.json({ error: "Cannot add lead to a completed campaign" }, 400);
  }

  const [existing] = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(and(eq(campaignLeads.leadId, leadId), eq(campaignLeads.campaignId, body.campaign_id)))
    .limit(1);
  if (existing) {
    return c.json({ ok: true, message: "Already a member of this campaign", lead_id: leadId, campaign_id: body.campaign_id });
  }

  await db.insert(campaignLeads).values({ leadId, campaignId: body.campaign_id, source: "manual" });

  await logAudit({
    actor: "user",
    action: "lead.add_to_campaign",
    targetId: leadId,
    targetType: "lead",
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
    metadata: { campaign_id: body.campaign_id },
  });

  return c.json({ ok: true, lead_id: leadId, campaign_id: body.campaign_id }, 201);
});

// Remove a lead from a specific campaign. Cascades pending_review drafts and
// unsent follow_ups for that (lead, campaign) pair. Blocks if anything has
// already been sent or rep-approved.
allLeadsRouter.delete("/:id/campaigns/:campaignId", async (c) => {
  const leadId = c.req.param("id");
  const campaignId = c.req.param("campaignId");

  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const [membership] = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(and(eq(campaignLeads.leadId, leadId), eq(campaignLeads.campaignId, campaignId)))
    .limit(1);
  if (!membership) return c.json({ error: "Lead is not in this campaign" }, 404);

  const sentRows = await db
    .select({ id: emailEvents.id })
    .from(emailEvents)
    .innerJoin(emailDrafts, eq(emailEvents.draftId, emailDrafts.id))
    .where(and(
      eq(emailDrafts.leadId, leadId),
      eq(emailDrafts.campaignId, campaignId),
      isNotNull(emailEvents.sentAt),
    ));
  if (sentRows.length > 0) {
    return c.json({
      error: `Cannot remove: lead has ${sentRows.length} sent email(s) under this campaign. Sent contact is permanent history.`,
    }, 409);
  }

  const lockedDrafts = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(and(
      eq(emailDrafts.leadId, leadId),
      eq(emailDrafts.campaignId, campaignId),
      inArray(emailDrafts.status, ["approved", "scheduled"]),
    ));
  if (lockedDrafts.length > 0) {
    return c.json({
      error: `Cannot remove: ${lockedDrafts.length} approved/scheduled draft(s) exist for this lead. Reject them first.`,
    }, 409);
  }

  const pendingDrafts = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(and(
      eq(emailDrafts.leadId, leadId),
      eq(emailDrafts.campaignId, campaignId),
      eq(emailDrafts.status, "pending_review"),
    ));
  const pendingDraftIds = pendingDrafts.map((d) => d.id);

  const deletedFollowUps = await db
    .delete(followUps)
    .where(and(
      eq(followUps.leadId, leadId),
      eq(followUps.campaignId, campaignId),
      isNull(followUps.sentAt),
    ))
    .returning({ id: followUps.id });

  let cascadedDrafts = 0;
  if (pendingDraftIds.length > 0) {
    const deleted = await db
      .delete(emailDrafts)
      .where(inArray(emailDrafts.id, pendingDraftIds))
      .returning({ id: emailDrafts.id });
    cascadedDrafts = deleted.length;
  }

  await db
    .delete(campaignLeads)
    .where(and(eq(campaignLeads.leadId, leadId), eq(campaignLeads.campaignId, campaignId)));

  await logAudit({
    actor: "user",
    action: "lead.remove_from_campaign",
    targetId: leadId,
    targetType: "lead",
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
    metadata: {
      campaign_id: campaignId,
      cascaded_pending_drafts: cascadedDrafts,
      cascaded_unsent_follow_ups: deletedFollowUps.length,
    },
  });

  return c.json({
    ok: true,
    lead_id: leadId,
    campaign_id: campaignId,
    cascaded_pending_drafts: cascadedDrafts,
    cascaded_unsent_follow_ups: deletedFollowUps.length,
  });
});

allLeadsRouter.get("/:id/enrichment", async (c) => {
  const leadId = c.req.param("id");
  const [record] = await db
    .select()
    .from(enrichmentRecords)
    .where(eq(enrichmentRecords.leadId, leadId))
    .orderBy(desc(enrichmentRecords.enrichedAt))
    .limit(1);

  if (!record) return c.json({ error: "No enrichment record for this lead" }, 404);

  return c.json({
    lead_id: record.leadId,
    enriched_at: record.enrichedAt.toISOString(),
    enrichment_source: record.enrichmentSource,
    market: record.market,
    institution: record.institution,
    contact: record.contact,
    pipeline_flags: record.pipelineFlags,
    routing: record.routing,
    routing_reason: record.routingReason,
  });
});
