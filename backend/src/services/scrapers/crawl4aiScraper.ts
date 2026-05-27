import type { Lead } from "./cheerioScraper";
import { scrapeWebsite as cheerioFallback } from "./cheerioScraper";

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

function extractEmailFromText(text: string): string | undefined {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match?.[0];
}

// Light stealth — defeats basic UA / navigator fingerprint checks. Will NOT
// beat serious Cloudflare or PerimeterX; those sites should be handled by
// the Cowork enrichment agent instead.
const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function crawl4aiScrape(url: string): Promise<Lead> {
  const baseUrl = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:11235";

  const res = await fetch(`${baseUrl}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  return {
    company: first.metadata?.title?.trim() || undefined,
    email: extractEmailFromText(text),
    website: url,
  };
}

export async function scrapeWithFallback(url: string): Promise<Lead & { scraper: "crawl4ai" | "cheerio" }> {
  // enforce 1 req / 2s rate limit — callers should stagger but guard here too
  await new Promise((r) => setTimeout(r, 2000));

  try {
    const lead = await crawl4aiScrape(url);
    return { ...lead, scraper: "crawl4ai" };
  } catch (err) {
    console.warn(`[crawl4ai] failed for ${url} — falling back to Cheerio:`, err instanceof Error ? err.message : err);
    const lead = await cheerioFallback(url);
    return { ...lead, scraper: "cheerio" };
  }
}
