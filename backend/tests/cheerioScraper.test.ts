import { describe, it, expect, mock, beforeEach } from "bun:test";

// Configurable mock response — changed per test
let mockHtml = `<html><head><title>Acme Corp</title></head><body><a href="mailto:ceo@acme.com">email</a></body></html>`;
let mockOk = true;

mock.module("node-fetch", () => ({
  default: mock(async (_url: string) => {
    if (!mockOk) return { ok: false, status: 503 };
    return { ok: true, text: async () => mockHtml };
  }),
}));

const { scrapeWebsite } = await import("../src/services/scrapers/cheerioScraper");

describe("cheerioScraper — scrapeWebsite", () => {
  beforeEach(() => {
    mockOk = true;
    mockHtml = `<html><head><title>Acme Corp</title></head><body><a href="mailto:ceo@acme.com">email</a></body></html>`;
  });

  it("extracts company name from <title>", async () => {
    const lead = await scrapeWebsite("https://acme.com");
    expect(lead.company).toBe("Acme Corp");
  });

  it("extracts email from mailto href", async () => {
    const lead = await scrapeWebsite("https://acme.com");
    expect(lead.email).toBe("ceo@acme.com");
  });

  it("always returns the scraped website URL", async () => {
    const lead = await scrapeWebsite("https://acme.com");
    expect(lead.website).toBe("https://acme.com");
  });

  it("returns undefined email when no mailto link found", async () => {
    mockHtml = `<html><head><title>No Email Co</title></head><body><p>no contact</p></body></html>`;
    const lead = await scrapeWebsite("https://noemail.com");
    expect(lead.email).toBeUndefined();
    expect(lead.company).toBe("No Email Co");
  });

  it("returns undefined company when <title> is empty", async () => {
    mockHtml = `<html><head><title></title></head><body><a href="mailto:hi@x.com">e</a></body></html>`;
    const lead = await scrapeWebsite("https://notitle.com");
    expect(lead.company).toBeUndefined();
    expect(lead.email).toBe("hi@x.com");
  });

  it("throws when fetch returns a non-ok status", async () => {
    mockOk = false;
    expect(scrapeWebsite("https://broken.com")).rejects.toThrow();
  });

  it("uses the generic source selector by default", async () => {
    // The generic selector uses 'title' for company — already confirmed above.
    // Explicitly pass no source arg and verify same result.
    const lead = await scrapeWebsite("https://acme.com");
    expect(lead.company).toBe("Acme Corp");
  });
});
