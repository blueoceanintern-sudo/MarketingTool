import { lookup } from "node:dns/promises";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, campaignGeos, discoveryRuns, geoPlaces, scrapeJobs, sourceRegistry, normalizeVertical } from "../../db/schema";
import { leadDiscoveryAgent } from "../../mastra/agents/lead-discovery.agent";
import { discoverySchema, type DiscoveryResult } from "../../mastra/schemas/discovery";
import { runScrapeJob } from "../scraping/runScrapeJob";

const MIN_SOURCES_PER_GEO = 8;
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|0\.0\.0\.0)/;
const BLOCKED_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpg|jpeg|gif|svg|mp4|mp3)$/i;

async function isSsrfSafe(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (PRIVATE_IP_RE.test(hostname) || hostname === "localhost") return false;
    const { address } = await lookup(hostname);
    return !PRIVATE_IP_RE.test(address);
  } catch {
    return false;
  }
}

async function validateUrl(urlStr: string): Promise<boolean> {
  if (!await isSsrfSafe(urlStr)) return false;
  if (BLOCKED_EXTENSIONS.test(new URL(urlStr).pathname)) return false;
  try {
    const res = await fetch(urlStr, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.includes("text/html") && res.status < 500;
  } catch {
    return false;
  }
}

// Run the discovery agent for a single (campaign, geo) pair.
async function discoverForGeo(
  campaignId: string,
  vertical: string,
  geonameId: number,
  geoLabel: string,
  campaign: { description: string | null; painPoints: string[] | null; name: string },
): Promise<{ inserted: number; sourceIds: string[] }> {
  const key = `${vertical}:${geoLabel}`;

  // How many active sources already cover this vertical+geo?
  const existingSources = await db
    .select({ id: sourceRegistry.id, name: sourceRegistry.name, url: sourceRegistry.url, qualityScore: sourceRegistry.qualityScore })
    .from(sourceRegistry)
    .where(and(eq(sourceRegistry.vertical, vertical), eq(sourceRegistry.geonameId, geonameId), eq(sourceRegistry.active, true)));

  if (existingSources.length >= MIN_SOURCES_PER_GEO) {
    console.log(`[discovery] ${key}: ${existingSources.length} sources already meet threshold — skipping`);
    return { inserted: 0, sourceIds: [] };
  }

  // Past queries for this campaign+geo — agent must not repeat them.
  const pastRuns = await db
    .select({ query: discoveryRuns.query })
    .from(discoveryRuns)
    .where(and(eq(discoveryRuns.campaignId, campaignId), eq(discoveryRuns.geonameId, geonameId)));

  const pastQueries = pastRuns.map((r) => r.query);

  // Top-performing sources for this vertical+geo (feed back into search strategy).
  const topSources = existingSources
    .filter((s) => s.qualityScore !== null)
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
    .slice(0, 3);

  const contextMessage = `Campaign: ${campaign.name}
Vertical: ${vertical}
Geography: ${geoLabel}
Description: ${campaign.description ?? "Not provided"}
Pain points: ${(campaign.painPoints ?? []).join("; ") || "Not provided"}
Current active source count: ${existingSources.length} (need at least ${MIN_SOURCES_PER_GEO})

${topSources.length > 0 ? `High-performing sources for this vertical+geo (find similar directory pages):\n${topSources.map((s) => `- ${s.name}: ${s.url}`).join("\n")}\n` : ""}${pastQueries.length > 0 ? `Queries already run for this campaign in this geography (do NOT repeat these):\n${pastQueries.map((q) => `- ${q}`).join("\n")}\n` : "No previous searches — start fresh.\n"}
Search for public directories and membership lists where ${vertical} organisations in ${geoLabel} can be found. Prioritise pages likely to list multiple companies with contact details. Run at least 4 diverse queries.`;

  let result: Awaited<ReturnType<typeof leadDiscoveryAgent.generate>>;
  try {
    result = await leadDiscoveryAgent.generate(contextMessage, {
      structuredOutput: { schema: discoverySchema, errorStrategy: "strict" },
      maxSteps: 20,
    });
  } catch (err) {
    console.error(`[discovery] ${key}: agent error:`, err);
    return { inserted: 0, sourceIds: [] };
  }

  const discovery = result.object as DiscoveryResult | undefined;
  if (!discovery) {
    console.warn(`[discovery] ${key}: agent returned no structured output`);
    return { inserted: 0, sourceIds: [] };
  }

  // Log every query the agent ran to prevent repetition in future runs.
  if (discovery.queriesRun.length > 0) {
    await db.insert(discoveryRuns).values(
      discovery.queriesRun.map((query) => ({
        campaignId,
        geonameId,
        query,
        resultsCount: 0,
        insertedCount: 0,
      })),
    );
  }

  if (discovery.sources.length === 0) {
    console.log(`[discovery] ${key}: agent returned 0 sources`);
    return { inserted: 0, sourceIds: [] };
  }

  // Filter URLs already in the registry.
  const candidateUrls = discovery.sources.map((s) => s.url);
  const existing = await db
    .select({ url: sourceRegistry.url })
    .from(sourceRegistry)
    .where(inArray(sourceRegistry.url, candidateUrls));
  const existingUrls = new Set(existing.map((r) => r.url));

  const novel = discovery.sources.filter((s) => !existingUrls.has(s.url));
  if (novel.length === 0) {
    console.log(`[discovery] ${key}: all ${discovery.sources.length} candidate(s) already in registry`);
    return { inserted: 0, sourceIds: [] };
  }

  // Validate (SSRF + HEAD check) in parallel.
  const validated = await Promise.allSettled(
    novel.map(async (s) => ({ ...s, ok: await validateUrl(s.url) })),
  );

  const sourceIds: string[] = [];
  for (const res of validated) {
    if (res.status !== "fulfilled" || !res.value.ok) continue;
    const { url, name, scraperType, legalFlag } = res.value;
    try {
      const [row] = await db
        .insert(sourceRegistry)
        .values({
          name: name.trim() || new URL(url).hostname,
          vertical,
          geonameId,
          url,
          scraperType,
          legalFlag,
          active: true,
          generatedBy: campaignId,
        })
        .onConflictDoNothing()
        .returning({ id: sourceRegistry.id });
      if (row) sourceIds.push(row.id);
    } catch (err) {
      console.error(`[discovery] ${key}: failed to insert ${url}:`, err);
    }
  }

  console.log(`[discovery] ${key}: inserted ${sourceIds.length}/${novel.length} new source(s)`);
  return { inserted: sourceIds.length, sourceIds };
}

// Entry point used by both the on-demand route (POST /campaigns/plan) and
// the autonomous discovery-runner cron. Iterates over every geo target for
// the campaign and runs one agent call per geo.
export async function runAgentDiscovery(
  campaignId: string,
  vertical: string,
  geoEntries: Array<{ geonameId: number; geoLabel: string }>,
): Promise<{ inserted: number; sourceIds: string[] }> {
  const [campaign] = await db
    .select({ name: campaigns.name, description: campaigns.description, painPoints: campaigns.painPoints })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    console.error(`[discovery] campaign ${campaignId} not found`);
    return { inserted: 0, sourceIds: [] };
  }

  const v = normalizeVertical(vertical);
  let totalInserted = 0;
  const allSourceIds: string[] = [];

  for (const { geonameId, geoLabel } of geoEntries) {
    const { inserted, sourceIds } = await discoverForGeo(campaignId, v, geonameId, geoLabel, campaign);
    totalInserted += inserted;
    allSourceIds.push(...sourceIds);
  }

  // If new sources were found, queue and immediately run a scrape job so
  // leads start flowing without waiting for the next cron window.
  if (allSourceIds.length > 0) {
    try {
      const [job] = await db
        .insert(scrapeJobs)
        .values({ campaignId, status: "queued" })
        .returning();

      if (job) {
        void runScrapeJob(job.id, campaignId).catch((err) =>
          console.error(`[discovery] scrape job ${job.id} failed:`, err),
        );
      }
    } catch (err) {
      console.error(`[discovery] failed to create scrape job for campaign ${campaignId}:`, err);
    }
  }

  return { inserted: totalInserted, sourceIds: allSourceIds };
}

// Called by the discovery-runner cron. Updates quality scores for all
// sources attached to a campaign based on recent scrape job outcomes,
// then returns the list of geo entries that still need more sources.
export async function getStarvedGeos(
  campaignId: string,
): Promise<Array<{ geonameId: number; geoLabel: string; sourceCount: number }>> {
  const rows = await db
    .select({
      geonameId: campaignGeos.geonameId,
      geoLabel: geoPlaces.name,
    })
    .from(campaignGeos)
    .innerJoin(geoPlaces, eq(campaignGeos.geonameId, geoPlaces.geonameId))
    .where(eq(campaignGeos.campaignId, campaignId));

  const starved: Array<{ geonameId: number; geoLabel: string; sourceCount: number }> = [];

  for (const { geonameId, geoLabel } of rows) {
    const [countRow] = await db
      .select({ n: count(sourceRegistry.id) })
      .from(sourceRegistry)
      .where(and(eq(sourceRegistry.geonameId, geonameId), eq(sourceRegistry.active, true)));
    const sourceCount = Number(countRow?.n ?? 0);
    if (sourceCount < MIN_SOURCES_PER_GEO) {
      starved.push({ geonameId, geoLabel, sourceCount });
    }
  }

  return starved;
}

// Updates quality_score on source_registry rows based on how many leads
// recent scrape jobs for the same campaign produced. Called by the
// discovery-runner before each discovery pass so the agent's context
// reflects current source performance.
export async function refreshSourceQualityScores(campaignId: string): Promise<void> {
  // For each active source for this campaign's vertical+geos, look at the
  // most recent completed scrape job and use leadsScraped as a proxy.
  const campaignRow = await db
    .select({ vertical: campaigns.vertical })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaignRow[0]) return;

  const vertical = normalizeVertical(campaignRow[0].vertical);

  const sources = await db
    .select({ id: sourceRegistry.id, geonameId: sourceRegistry.geonameId })
    .from(sourceRegistry)
    .where(and(eq(sourceRegistry.vertical, vertical), eq(sourceRegistry.active, true)));

  if (sources.length === 0) return;

  // Use the latest completed scrape job leadsScraped as a rough quality proxy.
  // A proper per-source metric requires schema changes to scrape_jobs; this
  // campaign-level approximation is sufficient for the initial discovery loop.
  const [latestJob] = await db
    .select({ leadsScraped: scrapeJobs.leadsScraped })
    .from(scrapeJobs)
    .where(and(eq(scrapeJobs.campaignId, campaignId), eq(scrapeJobs.status, "complete")))
    .orderBy(desc(scrapeJobs.completedAt))
    .limit(1);

  if (!latestJob) return;

  // Distribute the score evenly across sources — a per-source metric can
  // replace this once scrape_jobs tracks source-level yields.
  const score = Math.min(1.0, latestJob.leadsScraped / (sources.length * 10));

  await db
    .update(sourceRegistry)
    .set({ qualityScore: score, updatedAt: new Date() })
    .where(and(eq(sourceRegistry.vertical, vertical), eq(sourceRegistry.active, true)));
}
