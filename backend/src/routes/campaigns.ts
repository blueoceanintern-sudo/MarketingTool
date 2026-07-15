import { Hono } from "hono";
import { db } from "../db";
import { campaigns, campaignGeos, campaignLeads, campaignLeadExclusions, geoPlaces, leads, companies, emailDrafts, emailEvents, scrapeJobs, normalizeVertical } from "../db/schema";
import { eq, and, or, isNotNull, count, inArray, sql } from "drizzle-orm";
import { runScrapeJob } from "../services/scraping/runScrapeJob";
import { generateDraftsForCampaign } from "../services/drafting/orchestrator";
import { enrichLead } from "../services/enrichment/orchestrator";
import { getGeoPlaces, type GeoPlace } from "../services/geoPlaces";
import { runAgentDiscovery } from "../services/discovery";
import { campaignPlannerAgent } from "../mastra/agents/campaign-planner.agent";
import { planSchema } from "../mastra/schemas/plan";
import { emitJobEvent } from "../services/events";

type CampaignStatus = "draft" | "active" | "paused" | "complete";

async function computeStats(campaignId: string) {
  const [leadsRow] = await db
    .select({ total: count() })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaignId));

  const [pendingRow] = await db
    .select({ total: count() })
    .from(emailDrafts)
    .where(and(eq(emailDrafts.campaignId, campaignId), eq(emailDrafts.status, "pending_review")));

  const [sentRow] = await db
    .select({ total: count() })
    .from(emailEvents)
    .innerJoin(emailDrafts, eq(emailEvents.draftId, emailDrafts.id))
    .where(and(eq(emailDrafts.campaignId, campaignId), isNotNull(emailEvents.sentAt)));

  const [openedRow] = await db
    .select({ total: count() })
    .from(emailEvents)
    .innerJoin(emailDrafts, eq(emailEvents.draftId, emailDrafts.id))
    .where(and(eq(emailDrafts.campaignId, campaignId), isNotNull(emailEvents.openedAt)));

  const sent = Number(sentRow?.total ?? 0);
  const opened = Number(openedRow?.total ?? 0);

  return {
    leads_count: Number(leadsRow?.total ?? 0),
    drafts_pending: Number(pendingRow?.total ?? 0),
    sent,
    open_rate: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
  };
}

// Fetches the GeoNames places targeted by one or more campaigns in a single
// query, keyed by campaignId — avoids an N+1 when formatting a list.
async function getCampaignGeoPlaces(campaignIds: string[]): Promise<Map<string, GeoPlace[]>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await db
    .select({ campaignId: campaignGeos.campaignId, place: geoPlaces })
    .from(campaignGeos)
    .innerJoin(geoPlaces, eq(campaignGeos.geonameId, geoPlaces.geonameId))
    .where(inArray(campaignGeos.campaignId, campaignIds));

  const byCampaign = new Map<string, GeoPlace[]>();
  for (const { campaignId, place } of rows) {
    const list = byCampaign.get(campaignId) ?? [];
    list.push(place);
    byCampaign.set(campaignId, list);
  }
  return byCampaign;
}

function formatCampaign(row: typeof campaigns.$inferSelect, stats: Awaited<ReturnType<typeof computeStats>>, places: GeoPlace[]) {
  return {
    id: row.id,
    name: row.name,
    vertical: row.vertical,
    geographies: places.map((p) => ({ geoname_id: p.geonameId, name: p.name, country_code: p.countryCode, admin1_name: p.admin1Name })),
    company_size_target: row.companySizeTarget,
    status: row.status,
    description: row.description,
    pain_points: row.painPoints ?? [],
    call_to_action: row.callToAction,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...stats,
  };
}

export const campaignsRouter = new Hono();

campaignsRouter.get("/", async (c) => {
  const rows = await db.select().from(campaigns).orderBy(campaigns.createdAt);
  const geosByCampaign = await getCampaignGeoPlaces(rows.map((r) => r.id));
  const result = await Promise.all(
    rows.map(async (row) => formatCampaign(row, await computeStats(row.id), geosByCampaign.get(row.id) ?? []))
  );
  return c.json(result);
});

campaignsRouter.get("/:id", async (c) => {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!row) return c.json({ error: "Campaign not found" }, 404);
  const geosByCampaign = await getCampaignGeoPlaces([row.id]);
  return c.json(formatCampaign(row, await computeStats(row.id), geosByCampaign.get(row.id) ?? []));
});

campaignsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    vertical?: string;
    geoname_ids?: number[];
    company_size_target?: string;
    status?: CampaignStatus;
    description?: string | null;
    pain_points?: string[] | null;
    call_to_action?: string | null;
  }>();

  if (!body.name || !body.vertical || !body.geoname_ids?.length || !body.company_size_target) {
    return c.json({ error: "name, vertical, geoname_ids, company_size_target are required" }, 400);
  }

  const geonameIds = Array.from(new Set(body.geoname_ids));
  const places = await getGeoPlaces(geonameIds);
  if (places.length !== geonameIds.length) {
    return c.json({ error: "One or more geoname_ids are unknown" }, 400);
  }

  const sizeTarget = body.company_size_target as "small" | "medium" | "large" | "enterprise";

  const description = body.description?.trim() || null;
  const callToAction = body.call_to_action?.trim() || null;
  const painPoints = Array.isArray(body.pain_points)
    ? body.pain_points.map((p) => p.trim()).filter(Boolean)
    : null;

  const [row] = await db
    .insert(campaigns)
    .values({
      name: body.name,
      vertical: normalizeVertical(body.vertical),
      companySizeTarget: sizeTarget,
      status: body.status ?? "draft",
      description,
      painPoints: painPoints && painPoints.length > 0 ? painPoints : null,
      callToAction,
    })
    .returning();

  await db.insert(campaignGeos).values(geonameIds.map((geonameId) => ({ campaignId: row!.id, geonameId })));

  const geoEntries = places.map((p) => ({ geonameId: p.geonameId, geoLabel: p.name }));
  maybeAutoDiscover(row!.id, row!.vertical, geoEntries);

  return c.json(
    { ...formatCampaign(row!, await computeStats(row!.id), places), discovery: { status: "triggered" } },
    201,
  );
});

// Triggers AI-driven source discovery for all geo targets of a campaign.
// Fire-and-forget: the agent runs in the background so campaign creation
// returns immediately. Discovery status is surfaced via job events.
function maybeAutoDiscover(
  campaignId: string,
  verticalNormalized: string,
  geoEntries: Array<{ geonameId: number; geoLabel: string }>,
): void {
  if (geoEntries.length === 0) return;
  void runAgentDiscovery(campaignId, verticalNormalized, geoEntries).catch((err) => {
    console.error(`[discovery] campaign ${campaignId} auto-discover failed:`, err);
  });
}

// Natural language campaign creation. Accepts a free-text brief, uses the
// campaign-planner Mastra agent to extract structured parameters, creates the
// campaign, and immediately kicks off AI source discovery in the background.
campaignsRouter.post("/plan", async (c) => {
  const body = await c.req.json<{ brief?: string }>();
  if (!body.brief?.trim()) {
    return c.json({ error: "brief is required" }, 400);
  }

  let planResult: Awaited<ReturnType<typeof campaignPlannerAgent.generate>>;
  try {
    planResult = await campaignPlannerAgent.generate(body.brief.trim(), {
      output: planSchema,
      maxSteps: 10,
    });
  } catch (err) {
    console.error("[plan] planner agent error:", err);
    return c.json({ error: "Failed to parse campaign brief" }, 422);
  }

  const plan = planResult.object;
  if (!plan) {
    return c.json({ error: "Could not parse campaign brief" }, 422);
  }

  if (plan.clarificationNeeded?.length) {
    return c.json({ clarification_needed: true, questions: plan.clarificationNeeded }, 422);
  }

  if (!plan.geonameIds.length) {
    return c.json({ error: "Could not resolve any geographic targets from the brief" }, 422);
  }

  const places = await getGeoPlaces(plan.geonameIds);
  if (places.length === 0) {
    return c.json({ error: "None of the resolved geonameIds exist in the database" }, 422);
  }

  const validGeonameIds = places.map((p) => p.geonameId);
  const vertical = normalizeVertical(plan.vertical);

  const [row] = await db
    .insert(campaigns)
    .values({
      name: plan.name,
      vertical,
      companySizeTarget: plan.companySizeTarget,
      status: "active",
      description: plan.description || null,
      painPoints: plan.painPoints.length > 0 ? plan.painPoints : null,
      callToAction: plan.callToAction || null,
    })
    .returning();

  await db.insert(campaignGeos).values(validGeonameIds.map((geonameId) => ({ campaignId: row!.id, geonameId })));

  const geoEntries = places.map((p) => ({ geonameId: p.geonameId, geoLabel: p.name }));
  maybeAutoDiscover(row!.id, vertical, geoEntries);

  return c.json(
    {
      ...formatCampaign(row!, await computeStats(row!.id), places),
      discovery: { status: "triggered", message: "AI source discovery running in background." },
    },
    201,
  );
});

campaignsRouter.patch("/:id", async (c) => {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!row) return c.json({ error: "Campaign not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    vertical?: string;
    geoname_ids?: number[];
    company_size_target?: string;
    description?: string | null;
    pain_points?: string[] | null;
    call_to_action?: string | null;
  }>();

  const updates: Partial<typeof campaigns.$inferInsert> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return c.json({ error: "name cannot be empty" }, 400);
    updates.name = trimmed;
  }
  if (body.vertical !== undefined) {
    const trimmed = body.vertical.trim();
    if (!trimmed) return c.json({ error: "vertical cannot be empty" }, 400);
    updates.vertical = normalizeVertical(trimmed);
  }
  let newGeonameIds: number[] | undefined;
  if (body.geoname_ids !== undefined) {
    if (!body.geoname_ids.length) return c.json({ error: "geoname_ids cannot be empty" }, 400);
    newGeonameIds = Array.from(new Set(body.geoname_ids));
    const places = await getGeoPlaces(newGeonameIds);
    if (places.length !== newGeonameIds.length) {
      return c.json({ error: "One or more geoname_ids are unknown" }, 400);
    }
  }
  if (body.company_size_target !== undefined) {
    const valid = ["small", "medium", "large", "enterprise"] as const;
    if (!valid.includes(body.company_size_target as (typeof valid)[number])) {
      return c.json({ error: `company_size_target must be one of: ${valid.join(", ")}` }, 400);
    }
    updates.companySizeTarget = body.company_size_target as (typeof valid)[number];
  }
  if (body.description !== undefined) {
    updates.description = body.description?.trim() || null;
  }
  if (body.pain_points !== undefined) {
    const cleaned = Array.isArray(body.pain_points)
      ? body.pain_points.map((p) => p.trim()).filter(Boolean)
      : null;
    updates.painPoints = cleaned && cleaned.length > 0 ? cleaned : null;
  }
  if (body.call_to_action !== undefined) {
    updates.callToAction = body.call_to_action?.trim() || null;
  }

  const [updated] = await db.update(campaigns).set(updates).where(eq(campaigns.id, row.id)).returning();

  if (newGeonameIds !== undefined) {
    await db.delete(campaignGeos).where(eq(campaignGeos.campaignId, row.id));
    await db.insert(campaignGeos).values(newGeonameIds.map((geonameId) => ({ campaignId: row.id, geonameId })));
  }

  const places = (await getCampaignGeoPlaces([updated!.id])).get(updated!.id) ?? [];
  return c.json(formatCampaign(updated!, await computeStats(updated!.id), places));
});

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft:    ["draft", "active"],
  active:   ["active", "paused", "complete"],
  paused:   ["paused", "active", "complete"],
  complete: ["complete"],
};

campaignsRouter.patch("/:id/status", async (c) => {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!row) return c.json({ error: "Campaign not found" }, 404);

  const body = await c.req.json<{ status: CampaignStatus }>();
  const validStatuses: CampaignStatus[] = ["draft", "active", "paused", "complete"];
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  const current = row.status as CampaignStatus;
  if (!ALLOWED_TRANSITIONS[current].includes(body.status)) {
    return c.json(
      { error: `Cannot transition campaign from "${current}" to "${body.status}"` },
      400,
    );
  }

  const [updated] = await db
    .update(campaigns)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(campaigns.id, row.id))
    .returning();

  const places = (await getCampaignGeoPlaces([updated!.id])).get(updated!.id) ?? [];
  return c.json(formatCampaign(updated!, await computeStats(updated!.id), places));
});

campaignsRouter.post("/:id/scrape", async (c) => {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  if (campaign.status === "complete") {
    return c.json({ error: "Cannot scrape a completed campaign" }, 400);
  }

  const [job] = await db
    .insert(scrapeJobs)
    .values({ campaignId: campaign.id, status: "queued" })
    .returning();

  const jobId = job!.id;
  const scrapeCampaignId = campaign.id;
  void runScrapeJob(jobId, scrapeCampaignId).catch((err) => {
    console.error(`[scrape] job ${jobId} failed:`, err);
    // runScrapeJob emits on its own terminal paths; this covers an unexpected throw.
    void emitJobEvent({ kind: "scrape", campaignId: scrapeCampaignId, status: "failed" });
  });

  return c.json({ scrape_job_id: jobId, status: "queued" }, 201);
});

campaignsRouter.post("/:id/fetch-leads", async (c) => {
  const campaignId = c.req.param("id");
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  if (campaign.status === "complete") {
    return c.json({ error: "Cannot fetch leads for a completed campaign" }, 400);
  }

  // Resolve this campaign's targeted places, then match a company's place
  // against each target at the target's own granularity — a country target
  // matches any company in that country, a region target matches only
  // companies in that region, a city target matches only that exact city.
  // Matching everything down to country code alone (the previous approach)
  // meant a region-level target like "New York, US" pulled in every US
  // company regardless of state. Companies whose location was never
  // resolved to a geoname_id (legacy free-text rows — see
  // backfill-company-geo.ts) are excluded by the inner join rather than
  // guessed at.
  const targetPlaces = await db
    .select({ geonameId: geoPlaces.geonameId, countryCode: geoPlaces.countryCode, admin1Code: geoPlaces.admin1Code, featureCode: geoPlaces.featureCode })
    .from(campaignGeos)
    .innerJoin(geoPlaces, eq(campaignGeos.geonameId, geoPlaces.geonameId))
    .where(eq(campaignGeos.campaignId, campaignId));

  const geoConds = targetPlaces.map((t) =>
    t.featureCode === "PCLI"
      ? eq(geoPlaces.countryCode, t.countryCode)
      : t.featureCode === "ADM1"
        ? and(eq(geoPlaces.countryCode, t.countryCode), eq(geoPlaces.admin1Code, t.admin1Code!))
        : eq(geoPlaces.geonameId, t.geonameId),
  );
  const vertical = normalizeVertical(campaign.vertical);

  // Match leads whose company was seeded with this campaign's vertical + geo
  // at scrape time. Exclude leads already in this campaign or manually removed.
  const matchingLeads = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .innerJoin(geoPlaces, eq(companies.geonameId, geoPlaces.geonameId))
    .where(
      and(
        eq(companies.industry, vertical),
        geoConds.length > 0 ? or(...geoConds) : undefined,
        eq(leads.routing, "auto_queue"),
        sql`NOT EXISTS (
          SELECT 1 FROM campaign_leads cl_sup
          WHERE cl_sup.lead_id = ${leads.id}
          AND cl_sup.status = 'suppressed'
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM campaign_leads
          WHERE campaign_leads.lead_id = ${leads.id}
          AND campaign_leads.campaign_id = ${campaignId}::uuid
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM campaign_lead_exclusions
          WHERE campaign_lead_exclusions.lead_id = ${leads.id}
          AND campaign_lead_exclusions.campaign_id = ${campaignId}::uuid
        )`,
      ),
    );

  if (matchingLeads.length === 0) return c.json({ added: 0 });

  await db.insert(campaignLeads).values(
    matchingLeads.map((l) => ({ leadId: l.id, campaignId, source: "fetch" })),
  );

  return c.json({ added: matchingLeads.length });
});

campaignsRouter.post("/:id/enrich", async (c) => {
  const campaignId = c.req.param("id");
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  if (campaign.status === "complete") return c.json({ error: "Cannot enrich a completed campaign" }, 400);

  const rows = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaignId));

  const leadIds = rows.map((r) => r.leadId);
  if (leadIds.length === 0) return c.json({ message: "No leads to enrich", count: 0 });

  void (async () => {
    const results = await Promise.allSettled(leadIds.map((id) => enrichLead(id)));
    const enriched = results.filter((r) => r.status === "fulfilled" && r.value.fullyEnriched).length;
    console.log(`[enrich] campaign ${campaignId}: ${enriched}/${leadIds.length} fully enriched`);
    await emitJobEvent({ kind: "enrichment_complete", campaignId, count: enriched });
  })();

  return c.json({ message: "Enrichment started", count: leadIds.length }, 202);
});

campaignsRouter.post("/:id/drafts/generate", async (c) => {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  // Match the cron's gate — drafting only runs for active campaigns. Keeps
  // the API in sync with the frontend button (which disables on draft/complete)
  // and stops direct API calls from bypassing it.
  if (campaign.status !== "active") {
    return c.json({ error: `Cannot generate drafts: campaign is ${campaign.status}. Activate it first.` }, 400);
  }

  // Fire-and-forget — Batch API jobs poll for several seconds. The campaign
  // pulls its description / pain_points / call_to_action straight from the
  // row inside the orchestrator, so emails are anchored on this campaign's
  // goal rather than a generic role-based message.
  const draftCampaignId = campaign.id;
  void generateDraftsForCampaign(draftCampaignId)
    .then((result) => {
      console.log(
        `[drafting] campaign ${draftCampaignId}: generated=${result.generated}` +
          (result.skipped_no_eligible ? " (no eligible leads)" : "") +
          (result.errors.length ? ` errors=${result.errors.join("; ")}` : ""),
      );
      void emitJobEvent({ kind: "drafts", campaignId: draftCampaignId, generated: result.generated });
    })
    .catch((err) => {
      console.error(`[drafting] campaign ${draftCampaignId} failed:`, err);
      void emitJobEvent({ kind: "drafts", campaignId: draftCampaignId, generated: 0 });
    });

  return c.json({ message: "Draft generation queued", campaign_id: campaign.id }, 202);
});
