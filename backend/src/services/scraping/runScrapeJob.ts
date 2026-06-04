import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, campaignLeads, campaignLeadExclusions, companies, leads, scrapeJobs, sourceRegistry, normalizeVertical, normalizeGeo } from "../../db/schema";
import { scrapeWithFallback } from "../scrapers/crawl4aiScraper";
import { scrapeWebsite } from "../scrapers/cheerioScraper";
import { isValidLeadEmail } from "../scrapers/emailFilter";
import { emitJobEvent } from "../events";
import { enrichLead } from "../enrichment/orchestrator";

function parseGeographies(geography: string): string[] {
  return geography
    .split(",")
    .map(normalizeGeo)
    .filter(Boolean);
}

async function scrapeSourceUrl(
  url: string,
  scraperType: string,
): Promise<{ leads: Awaited<ReturnType<typeof scrapeWebsite>>; scraper: "crawl4ai" | "cheerio" }> {
  if (scraperType === "crawl4ai") {
    return scrapeWithFallback(url);
  }
  const leads = await scrapeWebsite(url, "generic");
  return { leads, scraper: "cheerio" };
}

// Returns the new leadId if a brand-new lead was inserted, null otherwise
// (existing lead linked, skipped, or invalid email).
async function persistScrapedLead(
  campaignId: string,
  scraped: { company?: string; email?: string; website: string; firstName?: string; lastName?: string; role?: string },
  campaignGeo: string,
  campaignVertical: string,
  scraperUsed: "crawl4ai" | "cheerio"
): Promise<string | null> {
  if (!scraped.email) return null;

  const email = scraped.email.trim().toLowerCase();
  if (!isValidLeadEmail(email)) return null;

  // Reuse the existing lead row if we've seen this email before — m:n means
  // the same person can be in multiple campaigns. We add a campaign_leads
  // link rather than inserting a duplicate lead.
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
  if (existing) {
    const [excluded] = await db
      .select({ leadId: campaignLeadExclusions.leadId })
      .from(campaignLeadExclusions)
      .where(and(eq(campaignLeadExclusions.leadId, existing.id), eq(campaignLeadExclusions.campaignId, campaignId)))
      .limit(1);
    if (excluded) return null; // excluded from this campaign — do not re-add

    const [existingLink] = await db
      .select({ leadId: campaignLeads.leadId })
      .from(campaignLeads)
      .where(and(eq(campaignLeads.leadId, existing.id), eq(campaignLeads.campaignId, campaignId)))
      .limit(1);
    if (existingLink) return null; // already a member of this campaign

    await db.insert(campaignLeads).values({ leadId: existing.id, campaignId, source: "scrape" });
    // Existing lead — don't re-enrich, return null so we don't double-count.
    return null;
  }

  const companyName = scraped.company?.trim() || new URL(scraped.website).hostname;

  let [company] = await db.select().from(companies).where(eq(companies.name, companyName)).limit(1);
  if (!company) {
    const [inserted] = await db
      .insert(companies)
      .values({
        // industry seeds from the campaign vertical that surfaced this company —
        // the one signal we actually have at scrape time. size is left unknown
        // for enrichment to fill; we don't guess it here.
        name: companyName,
        industry: campaignVertical,
        companySize: "unknown",
        location: campaignGeo,
        // source holds the website URL — used by enrichment as the mandatory
        // navigation target for the Cowork browser agent.
        source: scraped.website,
      })
      .returning();
    company = inserted!;
  }

  // Scraped emails are presence-only — they haven't been verified by a
  // registry. Mark them pattern_guessed and let the orchestrator upgrade
  // the status if a downstream provider verifies them.
  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    email,
    firstName: scraped.firstName ?? null,
    lastName: scraped.lastName ?? null,
    role: scraped.role ?? null,
    isVerified: false,
    emailStatus: "pattern_guessed",
    scraperUsed,
    status: "new",
  }).returning();

  if (lead) {
    await db.insert(campaignLeads).values({ leadId: lead.id, campaignId, source: "scrape" });
    return lead.id;
  }

  return null;
}

export async function runScrapeJob(jobId: string, campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) {
    await db
      .update(scrapeJobs)
      .set({ status: "failed", errorMessage: "Campaign not found", completedAt: new Date() })
      .where(eq(scrapeJobs.id, jobId));
    await emitJobEvent({ kind: "scrape", campaignId, status: "failed" });
    return;
  }

  await db
    .update(scrapeJobs)
    .set({ status: "running", startedAt: new Date(), errorMessage: null })
    .where(eq(scrapeJobs.id, jobId));

  const geos = parseGeographies(campaign.geography);
  const sourceConditions = [
    eq(sourceRegistry.active, true),
    eq(sourceRegistry.vertical, normalizeVertical(campaign.vertical)),
  ];
  if (geos.length > 0) sourceConditions.push(inArray(sourceRegistry.geo, geos));

  const sources = await db
    .select()
    .from(sourceRegistry)
    .where(and(...sourceConditions));

  if (sources.length === 0) {
    await db
      .update(scrapeJobs)
      .set({
        status: "failed",
        errorMessage: `No active sources for vertical "${campaign.vertical}" in ${geos.join(", ") || "any geo"}`,
        completedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, jobId));
    await emitJobEvent({ kind: "scrape", campaignId, status: "failed" });
    return;
  }

  let leadsScraped = 0;
  const errors: string[] = [];
  const newLeadIds: string[] = [];

  for (const source of sources) {
    try {
      const result = await scrapeSourceUrl(source.url, source.scraperType);
      let savedForSource = 0;
      for (const lead of result.leads) {
        const newLeadId = await persistScrapedLead(campaignId, lead, source.geo, campaign.vertical, result.scraper);
        if (newLeadId !== null) {
          newLeadIds.push(newLeadId);
          savedForSource++;
          leadsScraped++;
          void emitJobEvent({ kind: "scrape_progress", campaignId, leadsScraped });
        }
      }
      console.log(`[scrape] ${source.name} → scraper=${result.scraper}, found=${result.leads.length}, saved=${savedForSource}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${source.name}: ${msg}`);
      if (msg.toLowerCase().includes("captcha")) {
        await db
          .update(scrapeJobs)
          .set({
            status: "blocked",
            errorMessage: msg,
            leadsScraped,
            completedAt: new Date(),
          })
          .where(eq(scrapeJobs.id, jobId));
        await emitJobEvent({ kind: "scrape", campaignId, status: "blocked", leadsScraped });
        return;
      }
    }
  }

  const status = leadsScraped > 0 || errors.length === 0 ? "complete" : "failed";
  await db
    .update(scrapeJobs)
    .set({
      status,
      leadsScraped,
      errorMessage: errors.length ? errors.join("; ") : null,
      completedAt: new Date(),
    })
    .where(eq(scrapeJobs.id, jobId));
  await emitJobEvent({ kind: "scrape", campaignId, status, leadsScraped });

  // Fire enrichment for every brand-new lead immediately after the scrape
  // completes. Each call is fire-and-forget; we track how many succeed to
  // emit a single enrichment_complete event the frontend toasts on.
  if (newLeadIds.length > 0) {
    console.log(`[scrape] queuing enrichment for ${newLeadIds.length} new lead(s)`);
    let enriched = 0;
    const enrichPromises = newLeadIds.map((leadId) =>
      enrichLead(leadId)
        .then(() => { enriched++; })
        .catch((err) => {
          console.error(`[scrape] enrichment failed for lead ${leadId}:`, err);
        })
    );
    // Wait for all enrichment to finish then emit a single SSE event.
    void Promise.all(enrichPromises).then(() => {
      console.log(`[scrape] enrichment complete: ${enriched}/${newLeadIds.length} succeeded`);
      void emitJobEvent({ kind: "enrichment_complete", campaignId, count: enriched });
    });
  }
}
