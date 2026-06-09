import { Hono } from "hono";
import { db } from "../db";
import { leads, companies, campaigns, campaignLeads, campaignLeadExclusions, suppressionList, enrichmentRecords, emailDrafts, emailEvents, followUps } from "../db/schema";
import { count, sql, eq, desc, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { logAudit } from "../services/audit/log";
import type { AuthUser } from "../middleware/auth";
import { enrichLead } from "../services/enrichment/orchestrator";
import { emitJobEvent } from "../services/events";
import { isValidLeadEmail } from "../services/scrapers/emailFilter";

interface LeadRow {
  id: string;
  name: string | null;
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
    name: row.name ?? "",
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

const LEAD_SELECT = {
  id: leads.id,
  name: leads.name,
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
} as const;

const SUMMARY_SELECT = {
  total: count(),
  verified: sql<number>`cast(sum(case when ${leads.emailStatus} = 'verified' then 1 else 0 end) as int)`,
  auto_queue: sql<number>`cast(sum(case when ${leads.routing} = 'auto_queue' then 1 else 0 end) as int)`,
  rep_review: sql<number>`cast(sum(case when ${leads.routing} = 'rep_review' then 1 else 0 end) as int)`,
} as const;

// Mounted at /api/v1/leads — all leads, no campaign filter
export const allLeadsRouter = new Hono<{ Variables: { user: AuthUser } }>();

allLeadsRouter.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  const statusParam = c.req.query("status") as string | undefined;
  const emailStatusParam = c.req.query("email_status") as string | undefined;
  const routingParam = c.req.query("routing") as string | undefined;
  const campaignIdParam = c.req.query("campaign_id");

  const filterConds = and(
    statusParam ? eq(leads.status, statusParam as "new" | "contacted" | "replied" | "converted" | "suppressed") : undefined,
    emailStatusParam ? eq(leads.emailStatus, emailStatusParam as "verified" | "pattern_guessed" | "not_found") : undefined,
    routingParam ? eq(leads.routing, routingParam as "auto_queue" | "rep_review") : undefined,
  );

  let rows: LeadRow[];
  let summaryRow: { total: number; verified: number; auto_queue: number; rep_review: number } | undefined;

  if (campaignIdParam) {
    const where = and(eq(campaignLeads.campaignId, campaignIdParam), filterConds);

    [summaryRow] = await db
      .select(SUMMARY_SELECT)
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .where(where);

    rows = await db
      .select(LEAD_SELECT)
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .where(where)
      .orderBy(campaignLeads.addedAt)
      .limit(limit)
      .offset(offset);
  } else {
    [summaryRow] = await db
      .select(SUMMARY_SELECT)
      .from(leads)
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .where(filterConds);

    rows = await db
      .select(LEAD_SELECT)
      .from(leads)
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .where(filterConds)
      .orderBy(leads.createdAt)
      .limit(limit)
      .offset(offset);
  }

  const total = Number(summaryRow?.total ?? 0);
  const summary = {
    verified: Number(summaryRow?.verified ?? 0),
    auto_queue: Number(summaryRow?.auto_queue ?? 0),
    rep_review: Number(summaryRow?.rep_review ?? 0),
  };

  const campaignMap = await attachCampaignsToLeads(rows.map((r) => r.id));

  return c.json({
    data: rows.map((r) => formatLead(r, campaignMap.get(r.id) ?? [])),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
    summary,
  });
});

// Mounted at /api/v1/campaigns — campaign-scoped lead endpoints
export const leadsRouter = new Hono<{ Variables: { user: AuthUser } }>();

leadsRouter.get("/:id/leads", async (c) => {
  const campaignId = c.req.param("id");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  const where = eq(campaignLeads.campaignId, campaignId);

  const [countRow] = await db
    .select({ total: count() })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select(LEAD_SELECT)
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(where)
    .orderBy(campaignLeads.addedAt)
    .limit(limit)
    .offset(offset);

  const campaignMap = await attachCampaignsToLeads(rows.map((r) => r.id));

  return c.json({
    data: rows.map((r) => formatLead(r, campaignMap.get(r.id) ?? [])),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
});

leadsRouter.get("/:id/leads/excluded", async (c) => {
  const campaignId = c.req.param("id");

  const rows = await db
    .select({
      leadId: campaignLeadExclusions.leadId,
      excludedAt: campaignLeadExclusions.excludedAt,
      excludedBy: campaignLeadExclusions.excludedBy,
      reason: campaignLeadExclusions.reason,
      email: leads.email,
      name: leads.name,
      role: leads.role,
      companyName: companies.name,
    })
    .from(campaignLeadExclusions)
    .innerJoin(leads, eq(campaignLeadExclusions.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(campaignLeadExclusions.campaignId, campaignId))
    .orderBy(campaignLeadExclusions.excludedAt);

  return c.json(rows.map((r) => ({
    lead_id: r.leadId,
    email: r.email,
    name: r.name ?? "",
    role: r.role ?? "",
    company_name: r.companyName,
    excluded_at: r.excludedAt.toISOString(),
    excluded_by: r.excludedBy,
    reason: r.reason ?? null,
  })));
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

  for (let i = 1; i < rows.length; i++) {
    const values = (rows[i] ?? "").split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });

    const email = row["email"] ?? "";
    if (!email) { skipped.push(`row ${i + 1}: missing email`); continue; }
    if (!isValidLeadEmail(email)) { skipped.push(`${email}: rejected by email filter`); continue; }

    // Block emails suppressed for this campaign — they opted out and must not be re-collected
    const [suppressed] = await db
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(and(eq(suppressionList.email, email), eq(suppressionList.campaignId, campaignId)))
      .limit(1);
    if (suppressed) { skipped.push(email); continue; }

    // If the lead already exists, link them to this campaign instead of
    // refusing the row. m:n means the same person can appear in many imports.
    const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
    if (existing) {
      const [excl] = await db
        .select({ leadId: campaignLeadExclusions.leadId })
        .from(campaignLeadExclusions)
        .where(and(eq(campaignLeadExclusions.leadId, existing.id), eq(campaignLeadExclusions.campaignId, campaignId)))
        .limit(1);
      if (excl) { skipped.push(`${email}: excluded from this campaign`); continue; }

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
        if (m.includes("small")) return "small";
        return "unknown";
      })() as "small" | "medium" | "large" | "enterprise" | "unknown";

      const [inserted] = await db.insert(companies).values({
        name: companyName,
        industry: row["industry"] ?? null,
        companySize: size,
        location: row["market"] ?? "",
        source: row["company_website"] || null,
      }).returning();
      company = inserted!;
    }

    const name = (row["contact_name"] ?? "").trim() || null;

    const [lead] = await db.insert(leads).values({
      companyId: company.id,
      name,
      email,
      role: row["role"] ?? "",
      isVerified: false,
      emailStatus: "pattern_guessed",
      status: "new",
    }).returning();

    if (lead) {
      await db.insert(campaignLeads).values({ leadId: lead.id, campaignId, source: "csv" });
      imported.push(email);
    }
  }

  return c.json(
    {
      imported: imported.length,
      linked_existing: linkedExisting.length,
      skipped: skipped.length,
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

  const [existingLink] = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(and(eq(campaignLeads.leadId, leadId), eq(campaignLeads.campaignId, body.campaign_id)))
    .limit(1);
  if (existingLink) {
    return c.json({ ok: true, message: "Already a member of this campaign", lead_id: leadId, campaign_id: body.campaign_id });
  }

  // If an exclusion exists, remove it — manual add is an intentional override.
  const [excl] = await db
    .select({ leadId: campaignLeadExclusions.leadId })
    .from(campaignLeadExclusions)
    .where(and(eq(campaignLeadExclusions.leadId, leadId), eq(campaignLeadExclusions.campaignId, body.campaign_id)))
    .limit(1);
  const overrodeExclusion = !!excl;
  if (excl) {
    await db
      .delete(campaignLeadExclusions)
      .where(and(eq(campaignLeadExclusions.leadId, leadId), eq(campaignLeadExclusions.campaignId, body.campaign_id)));
  }

  await db.insert(campaignLeads).values({ leadId, campaignId: body.campaign_id, source: "manual" });

  await logAudit({
    actor: c.get("user"),
    action: "lead.add_to_campaign",
    targetId: leadId,
    targetType: "lead",
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
    metadata: { campaign_id: body.campaign_id, overrode_exclusion: overrodeExclusion },
  });

  return c.json({ ok: true, lead_id: leadId, campaign_id: body.campaign_id, overrode_exclusion: overrodeExclusion }, 201);
});

// Remove a lead from a specific campaign. Writes a campaign_lead_exclusions row
// so automated scrape/CSV runs cannot re-add them. Cascades pending_review
// drafts and unsent follow_ups for that (lead, campaign) pair. Blocks if
// anything has already been sent or rep-approved.
// Optional query param: ?reason=<text>
allLeadsRouter.delete("/:id/campaigns/:campaignId", async (c) => {
  const leadId = c.req.param("id");
  const campaignId = c.req.param("campaignId");
  const reason = c.req.query("reason") ?? null;

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

  const { cascadedDrafts, deletedFollowUpsCount } = await db.transaction(async (tx) => {
    const pendingDrafts = await tx
      .select({ id: emailDrafts.id })
      .from(emailDrafts)
      .where(and(
        eq(emailDrafts.leadId, leadId),
        eq(emailDrafts.campaignId, campaignId),
        eq(emailDrafts.status, "pending_review"),
      ));
    const pendingDraftIds = pendingDrafts.map((d) => d.id);

    const deletedFU = await tx
      .delete(followUps)
      .where(and(
        eq(followUps.leadId, leadId),
        eq(followUps.campaignId, campaignId),
        isNull(followUps.sentAt),
      ))
      .returning({ id: followUps.id });

    let cascaded = 0;
    if (pendingDraftIds.length > 0) {
      const deleted = await tx
        .delete(emailDrafts)
        .where(inArray(emailDrafts.id, pendingDraftIds))
        .returning({ id: emailDrafts.id });
      cascaded = deleted.length;
    }

    await tx
      .delete(campaignLeads)
      .where(and(eq(campaignLeads.leadId, leadId), eq(campaignLeads.campaignId, campaignId)));

    await tx
      .insert(campaignLeadExclusions)
      .values({ leadId, campaignId, excludedBy: "user", reason })
      .onConflictDoNothing();

    return { cascadedDrafts: cascaded, deletedFollowUpsCount: deletedFU.length };
  });

  await logAudit({
    actor: c.get("user"),
    action: "lead.remove_from_campaign",
    targetId: leadId,
    targetType: "lead",
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
    metadata: {
      campaign_id: campaignId,
      reason,
      cascaded_pending_drafts: cascadedDrafts,
      cascaded_unsent_follow_ups: deletedFollowUpsCount,
    },
  });

  return c.json({
    ok: true,
    lead_id: leadId,
    campaign_id: campaignId,
    cascaded_pending_drafts: cascadedDrafts,
    cascaded_unsent_follow_ups: deletedFollowUpsCount,
  });
});

// Trigger enrichment for all scraped (non-CSV) leads that haven't been enriched yet.
// Returns immediately; enrichment runs async in the background.
allLeadsRouter.post("/enrich", async (c) => {
  const unenriched = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(isNotNull(leads.scraperUsed), isNull(leads.enrichedAt)));

  const queued = unenriched.length;
  console.log(`[leads/enrich] queuing ${queued} scraped lead(s) for enrichment`);

  void (async () => {
    let enriched = 0;
    for (const { id } of unenriched) {
      await enrichLead(id).then(({ fullyEnriched }) => { if (fullyEnriched) enriched++; }).catch((err) => {
        console.error(`[leads/enrich] enrichment failed for ${id}:`, err);
      });
    }
    await emitJobEvent({ kind: "enrichment_complete", campaignId: "", count: enriched });
  })();

  console.log(`[task:2] ✓ POST /api/v1/leads/enrich returned queued=${queued}`);
  return c.json({ queued });
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
