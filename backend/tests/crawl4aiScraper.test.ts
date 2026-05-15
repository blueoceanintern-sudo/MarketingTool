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

// Cheerio fallback uses node-fetch — mock it
mock.module("node-fetch", () => ({
  default: mock(async () => ({
    ok: true,
    text: async () =>
      `<html><head><title>Fallback Corp</title></head><body><a href="mailto:fb@fallback.com">e</a></body></html>`,
  })),
}));

// crawl4aiScraper uses the global fetch (no import) — configure per test
let crawl4aiPayload: object | null = {
  success: true,
  result: {
    markdown: "Reach us at cto@techcorp.com for details.",
    metadata: { title: "TechCorp" },
  },
};

global.fetch = mock(async (_url: string) => {
  if (crawl4aiPayload === null) throw new Error("Crawl4AI unreachable");
  return { ok: true, json: async () => crawl4aiPayload };
}) as unknown as typeof fetch;

const { scrapeWithFallback } = await import("../src/services/scrapers/crawl4aiScraper");

describe("crawl4aiScraper — scrapeWithFallback", () => {
  beforeEach(() => {
    crawl4aiPayload = {
      success: true,
      result: {
        markdown: "Reach us at cto@techcorp.com for details.",
        metadata: { title: "TechCorp" },
      },
    };
  });

  it("returns crawl4ai result and marks scraper='crawl4ai'", async () => {
    const lead = await scrapeWithFallback("https://techcorp.com");
    expect(lead.scraper).toBe("crawl4ai");
    expect(lead.company).toBe("TechCorp");
    expect(lead.email).toBe("cto@techcorp.com");
    expect(lead.website).toBe("https://techcorp.com");
  }, 6000);

  it("falls back to cheerio when crawl4ai fetch throws", async () => {
    crawl4aiPayload = null; // makes mock throw
    const lead = await scrapeWithFallback("https://techcorp.com");
    expect(lead.scraper).toBe("cheerio");
    expect(lead.company).toBe("Fallback Corp");
    expect(lead.email).toBe("fb@fallback.com");
  }, 6000);

  it("falls back to cheerio when crawl4ai returns success=false", async () => {
    crawl4aiPayload = { success: false, error: "blocked by CAPTCHA" };
    const lead = await scrapeWithFallback("https://techcorp.com");
    expect(lead.scraper).toBe("cheerio");
  }, 6000);

  it("extracts email from markdown text in crawl4ai result", async () => {
    crawl4aiPayload = {
      success: true,
      result: {
        markdown: "Email our sales team: sales@example.io",
        metadata: { title: "Example Co" },
      },
    };
    const lead = await scrapeWithFallback("https://example.io");
    expect(lead.email).toBe("sales@example.io");
  }, 6000);

  it("returns website URL regardless of which scraper ran", async () => {
    const lead = await scrapeWithFallback("https://whatever.com");
    expect(lead.website).toBe("https://whatever.com");
  }, 6000);
});
