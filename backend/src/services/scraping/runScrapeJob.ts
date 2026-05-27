import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, companies, leads, scrapeJobs, sourceRegistry, normalizeVertical, normalizeGeo } from "../../db/schema";
import { scrapeWithFallback } from "../scrapers/crawl4aiScraper";
import { scrapeWebsite } from "../scrapers/cheerioScraper";
import { enrichLead } from "../enrichment/orchestrator";

function parseGeographies(geography: string): string[] {
  return geography
    .split(",")
    .map(normalizeGeo)
    .filter(Boolean);
}

async function scrapeSourceUrl(url: string, scraperType: string) {
  if (scraperType === "crawl4ai") {
    return scrapeWithFallback(url);
  }
  const lead = await scrapeWebsite(url, "generic");
  return { ...lead, scraper: "cheerio" as const };
}

async function persistScrapedLead(
  campaignId: string,
  scraped: { company?: string; email?: string; website: string },
  campaignGeo: string,
  scraperUsed: "crawl4ai" | "cheerio"
) {
  if (!scraped.email) return false;

  const email = scraped.email.trim().toLowerCase();
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
  if (existing) return false;

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
      })
      .returning();
    company = inserted!;
  }

  // Scraped emails are presence-only — they haven't been verified by a
  // registry. Mark them pattern_guessed and let the orchestrator upgrade
  // the status if a downstream provider verifies them.
  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    campaignId,
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
    void enrichLead(lead.id).catch((err) => {
      console.error(`[scrape] enrichment failed for ${lead.id}:`, err);
    });
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
    return;
  }

  let leadsScraped = 0;
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const result = await scrapeSourceUrl(source.url, source.scraperType);
      const saved = await persistScrapedLead(campaignId, result, source.geo, result.scraper);
    //   console.log(`[scrape] ${source.name} → scraper=${result.scraper}, email=${result.email ?? "none"}`);
      if (saved) leadsScraped++;
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
}
