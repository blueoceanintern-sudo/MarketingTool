import type { Lead } from "./cheerioScraper";
import { scrapeWebsite as cheerioFallback } from "./cheerioScraper";
import { isValidLeadEmail } from "./emailFilter";

// Crawl4AI 0.4+ schema. POST /crawl accepts { urls: string[] } and returns
// a per-URL results array. Each result has its own `success` flag plus an
// `error_message` (anti-bot blocks land here, not at the HTTP layer).
interface Crawl4AIResultItem {
  success: boolean;
  error_message?: string;
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

async function crawl4aiScrape(url: string): Promise<Lead[]> {
  const baseUrl = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:11235";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000); // 45s max per URL

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        urls: [url],
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

  const first = data.results[0]!;
  if (!first.success) {
    throw new Error(first.error_message || "Crawl4AI per-result failure");
  }

  const text = first.markdown?.raw_markdown
    ?? first.extracted_content
    ?? "";

  const company = first.metadata?.title?.trim() || undefined;
  return extractAllEmails(text).map((email) => ({ company, email, website: url }));
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
