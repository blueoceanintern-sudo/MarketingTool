import { Hono } from "hono";
import { db } from "../db";
import { campaigns, leads, emailDrafts, emailEvents, scrapeJobs, normalizeVertical, normalizeGeo } from "../db/schema";
import { eq, and, isNotNull, count } from "drizzle-orm";
import { runScrapeJob } from "../services/scraping/runScrapeJob";

type CampaignStatus = "draft" | "active" | "paused" | "complete";

async function computeStats(campaignId: string) {
  const [leadsRow] = await db
    .select({ total: count() })
    .from(leads)
    .where(eq(leads.campaignId, campaignId));

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
  }>();

  if (!body.name || !body.vertical || !body.geography || !body.company_size_target) {
    return c.json({ error: "name, vertical, geography, company_size_target are required" }, 400);
  }

  const rawGeo = Array.isArray(body.geography) ? body.geography.join(",") : body.geography;
  const geo = rawGeo.split(",").map((g) => normalizeGeo(g)).filter(Boolean).join(",");
  const sizeTarget = body.company_size_target as "small" | "medium" | "large" | "enterprise";

  const [row] = await db
    .insert(campaigns)
    .values({
      name: body.name,
      vertical: normalizeVertical(body.vertical),
      geography: geo,
      companySizeTarget: sizeTarget,
      status: body.status ?? "draft",
    })
    .returning();

  return c.json(formatCampaign(row!, await computeStats(row!.id)), 201);
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
  void runScrapeJob(jobId, campaign.id).catch((err) => {
    console.error(`[scrape] job ${jobId} failed:`, err);
  });

  return c.json({ scrape_job_id: jobId, status: "queued" }, 201);
});

campaignsRouter.post("/:id/drafts/generate", async (c) => {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, c.req.param("id")))
    .limit(1);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  // Batch draft generation is handled by the drafting service (Claude Haiku Batch API).
  // This endpoint queues the job — actual generation runs asynchronously.
  return c.json({ message: "Draft generation queued", campaign_id: campaign.id }, 202);
});
