import type { Lead } from "./cheerioScraper";
import { scrapeWebsite as cheerioFallback } from "./cheerioScraper";

interface Crawl4AIResponse {
  success: boolean;
  result?: {
    markdown?: string;
    extracted_content?: string;
    metadata?: {
      title?: string;
    };
  };
  error?: string;
}

function extractEmailFromText(text: string): string | undefined {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match?.[0];
}

async function crawl4aiScrape(url: string): Promise<Lead> {
  const baseUrl = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:11235";

  const res = await fetch(`${baseUrl}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, extract_links: true }),
  });

  if (!res.ok) throw new Error(`Crawl4AI request failed: ${res.status}`);

  const data = (await res.json()) as Crawl4AIResponse;
  if (!data.success || !data.result) throw new Error(data.error ?? "Crawl4AI returned no result");

  const text = data.result.markdown ?? data.result.extracted_content ?? "";

  return {
    company: data.result.metadata?.title?.trim() || undefined,
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
  } catch {
    const lead = await cheerioFallback(url);
    return { ...lead, scraper: "cheerio" };
  }
}
