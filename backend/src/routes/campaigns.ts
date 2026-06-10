import { Hono } from "hono";
import { db } from "../db";
import { campaigns, campaignLeads, emailDrafts, emailEvents, scrapeJobs, sourceRegistry, normalizeVertical, normalizeGeo } from "../db/schema";
import { eq, and, isNotNull, count } from "drizzle-orm";
import { runScrapeJob } from "../services/scraping/runScrapeJob";
import { generateDraftsForCampaign } from "../services/drafting/orchestrator";
import { enrichLead } from "../services/enrichment/orchestrator";
import { discoverSources, getDirectoryConfig } from "../services/sourceRegistry";
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

function formatCampaign(row: typeof campaigns.$inferSelect, stats: Awaited<ReturnType<typeof computeStats>>) {
  return {
    id: row.id,
    name: row.name,
    vertical: row.vertical,
    geography: row.geography.split(",").map((g) => g.trim()).filter(Boolean),
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
  const result = await Promise.all(
    rows.map(async (row) => formatCampaign(row, await computeStats(row.id)))
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
  return c.json(formatCampaign(row, await computeStats(row.id)));
});

campaignsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    vertical?: string;
    geography?: string | string[];
    company_size_target?: string;
    status?: CampaignStatus;
    description?: string | null;
    pain_points?: string[] | null;
    call_to_action?: string | null;
  }>();

  if (!body.name || !body.vertical || !body.geography || !body.company_size_target) {
    return c.json({ error: "name, vertical, geography, company_size_target are required" }, 400);
  }

  const rawGeo = Array.isArray(body.geography) ? body.geography.join(",") : body.geography;
  const geo = rawGeo.split(",").map((g) => normalizeGeo(g)).filter(Boolean).join(",");
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
      geography: geo,
      companySizeTarget: sizeTarget,
      status: body.status ?? "draft",
      description,
      painPoints: painPoints && painPoints.length > 0 ? painPoints : null,
      callToAction,
    })
    .returning();

  const discovery = await maybeAutoDiscover(row!.id, row!.vertical, row!.geography);

  return c.json({ ...formatCampaign(row!, await computeStats(row!.id)), discovery }, 201);
});

// Auto-discovery contract returned to the client on campaign create. The UI
// uses `status` to decide which toast (or none) to show.
type DiscoveryStatus =
  | { status: "already_seeded"; message: string }
  | { status: "triggered"; message: string; domains: string[] }
  | { status: "skipped_no_config"; message: string };

async function maybeAutoDiscover(
  campaignId: string,
  verticalNormalized: string,
  geographyRaw: string,
): Promise<DiscoveryStatus> {
  // Campaign geography is a comma-separated list — trigger discovery for
  // every geo independently so an SG+AU campaign auto-fills both pools.
  const geos = geographyRaw.split(",").map((g) => g.trim()).filter(Boolean);
  if (geos.length === 0) {
    return { status: "skipped_no_config", message: "Campaign has no geography to discover sources for." };
  }

  type PerGeoOutcome = {
    geo: string;
    status: "triggered" | "already_seeded" | "skipped_no_config";
    domains: string[];
  };
  const outcomes: PerGeoOutcome[] = [];

  for (const geo of geos) {
    const [existing] = await db
      .select({ id: sourceRegistry.id })
      .from(sourceRegistry)
      .where(and(eq(sourceRegistry.vertical, verticalNormalized), eq(sourceRegistry.geo, geo)))
      .limit(1);
    if (existing) {
      outcomes.push({ geo, status: "already_seeded", domains: [] });
      continue;
    }

    const config = await getDirectoryConfig(verticalNormalized, geo);
    if (!config) {
      outcomes.push({ geo, status: "skipped_no_config", domains: [] });
      continue;
    }

    // Fire-and-forget — Tavily + HEAD checks take ~10–30s per geo, run
    // independently so one slow domain doesn't block the others.
    void discoverSources(verticalNormalized, geo, campaignId).catch((err) => {
      console.error(`[discovery] ${verticalNormalized}:${geo} failed:`, err);
    });
    outcomes.push({ geo, status: "triggered", domains: config.domains });
  }

  // Aggregate to a single DiscoveryStatus. Priority: triggered > skipped > seeded.
  // The toast reads this; we mention skipped geos inside the triggered message
  // so the rep sees partial coverage without two competing toasts.
  const triggered = outcomes.filter((o) => o.status === "triggered");
  const skipped = outcomes.filter((o) => o.status === "skipped_no_config");

  if (triggered.length > 0) {
    const triggeredGeos = triggered.map((o) => o.geo).join(", ");
    const allDomains = Array.from(new Set(triggered.flatMap((o) => o.domains)));
    let message = `Discovering sources for ${verticalNormalized} in ${triggeredGeos}. New leads available shortly.`;
    if (skipped.length > 0) {
      message += ` Skipped ${skipped.map((o) => o.geo).join(", ")} (no directory config).`;
    }
    return { status: "triggered", message, domains: allDomains };
  }

  if (skipped.length > 0) {
    const skippedGeos = skipped.map((o) => o.geo).join(", ");
    return {
      status: "skipped_no_config",
      message: `No directory config for ${verticalNormalized} in ${skippedGeos}. Add sources manually from Source Registry.`,
    };
  }

  return {
    status: "already_seeded",
    message: `Source pool already exists for ${verticalNormalized} in ${geos.join(", ")}.`,
  };
}

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
    geography?: string | string[];
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
  if (body.geography !== undefined) {
    const rawGeo = Array.isArray(body.geography) ? body.geography.join(",") : body.geography;
    const geo = rawGeo.split(",").map((g) => normalizeGeo(g)).filter(Boolean).join(",");
    if (!geo) return c.json({ error: "geography cannot be empty" }, 400);
    updates.geography = geo;
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
  return c.json(formatCampaign(updated!, await computeStats(updated!.id)));
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

  return c.json(formatCampaign(updated!, await computeStats(updated!.id)));
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
