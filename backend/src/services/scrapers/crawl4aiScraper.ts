import * as cheerio from "cheerio";
import type { Lead } from "./cheerioScraper";
import { scrapeWebsite as cheerioFallback, cleanCompanyName, extractLeadsFromPage, findStaffPageLinks } from "./cheerioScraper";
import { isValidLeadEmail } from "./emailFilter";

// Crawl4AI 0.4+ schema. POST /crawl accepts { urls: string[] } and returns
// a per-URL results array. Each result has its own `success` flag plus an
// `error_message` (anti-bot blocks land here, not at the HTTP layer).
interface Crawl4AIResultItem {
  success: boolean;
  error_message?: string;
  cleaned_html?: string;
  markdown?: {
    raw_markdown?: string;
    fit_markdown?: string;
  };
  extracted_content?: string | null;
  metadata?: {
    title?: string | null;
  };
}

interface Crawl4AIResponse {
  success: boolean;
  results?: Crawl4AIResultItem[];
  detail?: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Light stealth — defeats basic UA / navigator fingerprint checks. Will NOT
// beat serious Cloudflare or PerimeterX; those sites should be handled by
// the Cowork enrichment agent instead.
const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractAllEmails(text: string): string[] {
  const emails = new Set<string>();
  for (const match of text.matchAll(EMAIL_REGEX)) {
    const candidate = match[0].toLowerCase();
    if (isValidLeadEmail(candidate)) emails.add(candidate);
  }
  return Array.from(emails);
}

async function crawl4aiRequest(urls: string[]): Promise<Crawl4AIResultItem[]> {
  const baseUrl = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:11235";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        urls,
        browser_config: {
          type: "BrowserConfig",
          params: {
            user_agent: STEALTH_USER_AGENT,
            headless: true,
            viewport_width: 1920,
            viewport_height: 1080,
          },
        },
        crawler_config: {
          type: "CrawlerRunConfig",
          params: {
            simulate_user: true,
            override_navigator: true,
            magic: true,
            delay_before_return_html: 2.0,
          },
        },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Crawl4AI request failed: ${res.status}${body ? ` — ${body}` : ""}`);
  }

  const data = (await res.json()) as Crawl4AIResponse;
  if (!data.success || !data.results?.length) {
    throw new Error(data.detail ?? "Crawl4AI returned no results");
  }

  return data.results;
}

function extractFromResult(
  result: Crawl4AIResultItem,
  website: string,
  company: string | undefined,
): Map<string, Lead> {
  if (result.cleaned_html) {
    const $ = cheerio.load(result.cleaned_html);
    return extractLeadsFromPage($, website, company);
  }

  // Fallback: regex on markdown — loses name/role context
  const text = result.markdown?.raw_markdown ?? result.extracted_content ?? "";
  const fallback = new Map<string, Lead>();
  for (const email of extractAllEmails(text)) {
    fallback.set(email, { email, website, company });
  }
  return fallback;
}

async function crawl4aiScrape(url: string): Promise<Lead[]> {
  // Step 1: scrape the main page
  const mainResults = await crawl4aiRequest([url]);
  const mainResult = mainResults[0]!;
  if (!mainResult.success) {
    throw new Error(mainResult.error_message || "Crawl4AI per-result failure");
  }

  // Step 2: derive company name + discover staff/team sub-pages (up to 5)
  let company: string | undefined;
  let staffLinks: string[] = [];

  if (mainResult.cleaned_html) {
    const $ = cheerio.load(mainResult.cleaned_html);
    company = cleanCompanyName($);
    staffLinks = findStaffPageLinks($, url).slice(0, 5);
  } else {
    company = mainResult.metadata?.title?.trim() || undefined;
  }

  // Step 3: batch-crawl staff pages (if any) for richer contact pages
  const staffResults = staffLinks.length > 0 ? await crawl4aiRequest(staffLinks) : [];

  // Step 4: extract leads from all pages, deduplicating by email
  const allLeads = new Map<string, Lead>();

  for (const result of [mainResult, ...staffResults]) {
    if (!result.success) continue;
    for (const [email, lead] of extractFromResult(result, url, company)) {
      if (!allLeads.has(email)) allLeads.set(email, lead);
    }
  }

  return Array.from(allLeads.values());
}

export async function scrapeWithFallback(
  url: string,
): Promise<{ leads: Lead[]; scraper: "crawl4ai" | "cheerio" }> {
  // enforce 1 req / 2s rate limit — callers should stagger but guard here too
  await new Promise((r) => setTimeout(r, 2000));

  try {
    const leads = await crawl4aiScrape(url);
    return { leads, scraper: "crawl4ai" };
  } catch (err) {
    console.warn(`[crawl4ai] failed for ${url} — falling back to Cheerio:`, err instanceof Error ? err.message : err);
    const leads = await cheerioFallback(url);
    return { leads, scraper: "cheerio" };
  }
}
