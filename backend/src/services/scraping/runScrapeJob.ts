import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, campaignLeads, campaignLeadExclusions, companies, leads, scrapeJobs, sourceRegistry, normalizeVertical, normalizeGeo } from "../../db/schema";
import { scrapeWithFallback } from "../scrapers/crawl4aiScraper";
import { scrapeWebsite } from "../scrapers/cheerioScraper";
import { isValidLeadEmail } from "../scrapers/emailFilter";
import { emitJobEvent } from "../events";

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

async function persistScrapedLead(
  campaignId: string,
  scraped: { company?: string; email?: string; website: string },
  campaignGeo: string,
  scraperUsed: "crawl4ai" | "cheerio"
) {
  if (!scraped.email) return false;

  const email = scraped.email.trim().toLowerCase();
  if (!isValidLeadEmail(email)) return false;

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
    if (excluded) return false; // excluded from this campaign — do not re-add

    const [existingLink] = await db
      .select({ leadId: campaignLeads.leadId })
      .from(campaignLeads)
      .where(and(eq(campaignLeads.leadId, existing.id), eq(campaignLeads.campaignId, campaignId)))
      .limit(1);
    if (existingLink) return false; // already a member of this campaign
    await db.insert(campaignLeads).values({ leadId: existing.id, campaignId, source: "scrape" });
    return true;
  }

  const companyName = scraped.company?.trim() || new URL(scraped.website).hostname;

  let [company] = await db.select().from(companies).where(eq(companies.name, companyName)).limit(1);
  if (!company) {
    const [inserted] = await db
      .insert(companies)
      .values({
        name: companyName,
        industry: "Unknown",
        companySize: "small",
        location: campaignGeo,
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
    firstName: null,
    lastName: null,
    role: null,
    isVerified: false,
    emailStatus: "pattern_guessed",
    scraperUsed,
    status: "new",
  }).returning();

  if (lead) {
    await db.insert(campaignLeads).values({ leadId: lead.id, campaignId, source: "scrape" });
  }

  return true;
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

  for (const source of sources) {
    try {
      const result = await scrapeSourceUrl(source.url, source.scraperType);
      let savedForSource = 0;
      for (const lead of result.leads) {
        const saved = await persistScrapedLead(campaignId, lead, source.geo, result.scraper);
        if (saved) {
          savedForSource++;
          leadsScraped++;
          // Fire-and-forget per-insert progress so the frontend can grow the
          // leads table live; the client throttles the resulting refetches.
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
}
