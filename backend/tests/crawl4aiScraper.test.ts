import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Kill the 2-second rate-limit delay so tests run fast
const originalSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  (globalThis as any).setTimeout = (fn: Function, _delay?: number, ...args: any[]) =>
    originalSetTimeout(() => fn(...args), 0);
});
afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
});

// Cheerio fallback uses node-fetch — mock it. Page contains two unique emails
// so we exercise the multi-lead extraction path.
mock.module("node-fetch", () => ({
  default: mock(async () => ({
    ok: true,
    text: async () =>
      `<html><head><title>Fallback Corp</title></head><body>` +
      `<a href="mailto:fb@fallback.com">e</a>` +
      `<p>Contact: sales@fallback.com</p>` +
      `</body></html>`,
  })),
}));

// crawl4aiScraper uses the global fetch (no import) — configure per test
let crawl4aiPayload: object | null = {
  success: true,
  results: [{
    success: true,
    markdown: { raw_markdown: "Reach us at cto@techcorp.com or sales@techcorp.com for details." },
    metadata: { title: "TechCorp" },
  }],
};

global.fetch = mock(async (_url: string) => {
  if (crawl4aiPayload === null) throw new Error("Crawl4AI unreachable");
  return { ok: true, text: async () => "", json: async () => crawl4aiPayload };
}) as unknown as typeof fetch;

const { scrapeWithFallback } = await import("../src/services/scrapers/crawl4aiScraper");

describe("crawl4aiScraper — scrapeWithFallback", () => {
  beforeEach(() => {
    crawl4aiPayload = {
      success: true,
      results: [{
        success: true,
        markdown: { raw_markdown: "Reach us at cto@techcorp.com or sales@techcorp.com for details." },
        metadata: { title: "TechCorp" },
      }],
    };
  });

  it("returns crawl4ai result with all emails and marks scraper='crawl4ai'", async () => {
    const { leads, scraper } = await scrapeWithFallback("https://techcorp.com");
    expect(scraper).toBe("crawl4ai");
    expect(leads).toHaveLength(2);
    expect(leads.map((l) => l.email).sort()).toEqual(["cto@techcorp.com", "sales@techcorp.com"]);
    expect(leads[0]!.company).toBe("TechCorp");
    expect(leads[0]!.website).toBe("https://techcorp.com");
  }, 6000);

  it("dedupes repeated emails in crawl4ai markdown", async () => {
    crawl4aiPayload = {
      success: true,
      results: [{
        success: true,
        markdown: { raw_markdown: "Email cto@techcorp.com. Or just cto@techcorp.com again." },
        metadata: { title: "TechCorp" },
      }],
    };
    const { leads } = await scrapeWithFallback("https://techcorp.com");
    expect(leads).toHaveLength(1);
    expect(leads[0]!.email).toBe("cto@techcorp.com");
  }, 6000);

  it("returns empty leads array when crawl4ai markdown has no emails", async () => {
    crawl4aiPayload = {
      success: true,
      results: [{
        success: true,
        markdown: { raw_markdown: "No contact info on this page." },
        metadata: { title: "Empty Co" },
      }],
    };
    const { leads, scraper } = await scrapeWithFallback("https://empty.com");
    expect(scraper).toBe("crawl4ai");
    expect(leads).toEqual([]);
  }, 6000);

  it("falls back to cheerio when crawl4ai fetch throws", async () => {
    crawl4aiPayload = null; // makes mock throw
    const { leads, scraper } = await scrapeWithFallback("https://techcorp.com");
    expect(scraper).toBe("cheerio");
    expect(leads.length).toBeGreaterThanOrEqual(1);
    expect(leads[0]!.company).toBe("Fallback Corp");
    const emails = leads.map((l) => l.email);
    expect(emails).toContain("fb@fallback.com");
    expect(emails).toContain("sales@fallback.com");
  }, 6000);

  it("falls back to cheerio when crawl4ai returns success=false at top level", async () => {
    crawl4aiPayload = { success: false, detail: "blocked by CAPTCHA" };
    const { scraper } = await scrapeWithFallback("https://techcorp.com");
    expect(scraper).toBe("cheerio");
  }, 6000);

  it("falls back to cheerio when per-result success=false (e.g. anti-bot block)", async () => {
    crawl4aiPayload = {
      success: true,
      results: [{ success: false, error_message: "Blocked by anti-bot protection" }],
    };
    const { scraper } = await scrapeWithFallback("https://techcorp.com");
    expect(scraper).toBe("cheerio");
  }, 6000);

  it("returns website URL on each lead regardless of which scraper ran", async () => {
    const { leads } = await scrapeWithFallback("https://whatever.com");
    for (const lead of leads) {
      expect(lead.website).toBe("https://whatever.com");
    }
  }, 6000);
});
